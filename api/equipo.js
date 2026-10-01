/* Rancho El Descanso · portal del equipo (1 oct 2026).  Página: /equipo/
   Quién entra y con qué rol: pestaña EQUIPO de la Maestra (la entrega el Apps Script de la Agenda).
   Entrada: liga por correo (15 min) o, si hay GOOGLE_CLIENT_ID en Vercel, con el botón de Google.
   Sesión: cookie firmada (HttpOnly, 14 días). Cada respuesta se recorta según el rol:
     admin · direccion → todo        ventas → agenda, clientes, eventos, caballos; solo SUS ventas, pagos y comisiones
     contabilidad → pagos, saldos, ventas, comisiones, agenda (sin identificaciones)
     campo → agenda de acceso (titular, acompañantes, llegada, si ya pagó) e identificación; sin teléfonos ni montos

   GET  /api/equipo?entrar=<token>          (liga del correo) → cookie y vuelve a /equipo/
   GET  /api/equipo?accion=yo               → {usuario, permisos, google}
   GET  /api/equipo?accion=agenda|caballos|pagos
   GET  /api/equipo?accion=ine&evento=<id>  → identificación del titular (roles con permiso)
   POST /api/equipo {accion:"enlace", email} | {accion:"google", credential} | {accion:"salir"}
   POST /api/equipo {accion:"hacer", tipo:"saldo_pagado"|"confirmar_evento"|"bloquear"|"nota"|"liga", ...}
   Los POST exigen el header x-equipo: 1 (una página ajena no puede mandarlo sin permiso del navegador). */
const crypto = require("crypto");
const AG = require("./_agenda");

const SITIO = () => (process.env.SITE_URL || "https://rancho-el-descanso.vercel.app").replace(/\/$/, "");
const COOKIE = "crd_equipo";
const DIAS_SESION = 14;
const API = "https://api.stripe.com/v1/";
const VERSION = "2026-08-26.dahlia";

const PERMISOS = {
  admin:        {secciones: ["hoy", "agenda", "clientes", "eventos", "pagos", "caballos", "comisiones"], dinero: "todo", contacto: true, ine: true, acciones: ["saldo_pagado", "confirmar_evento", "bloquear", "nota", "liga"]},
  direccion:    {secciones: ["hoy", "agenda", "clientes", "eventos", "pagos", "caballos", "comisiones"], dinero: "todo", contacto: true, ine: true, acciones: ["saldo_pagado", "confirmar_evento", "bloquear", "nota", "liga"]},
  ventas:       {secciones: ["hoy", "agenda", "clientes", "eventos", "pagos", "caballos", "comisiones"], dinero: "propio", contacto: true, ine: true, acciones: ["nota", "liga"]},
  contabilidad: {secciones: ["hoy", "agenda", "pagos", "caballos", "comisiones"], dinero: "todo", contacto: true, ine: false, acciones: ["saldo_pagado", "nota"]},
  campo:        {secciones: ["hoy", "agenda"], dinero: "nada", contacto: false, ine: true, acciones: ["nota"]}
};
/* Respaldo si la pestaña EQUIPO no responde: solo Nico puede entrar */
const EQUIPO_RESPALDO = [{nombre: "Nicolás Campero", email: "nicolas@legaius.com", rol: "admin", vendedor: "nicolas"}];
/* Nombres que se usan en la columna Vendedor de la Maestra → clave del vendedor */
const ALIAS = {nico: "nicolas", nicolas: "nicolas", moni: "monica", monica: "monica", yuli: "yuliana", yuliana: "yuliana"};

/* ---------- firma y cookie ---------- */
const secreto = () => crypto.createHash("sha256").update("portal|" + (process.env.PORTAL_SECRET || process.env.RANCHO_TOKEN || "")).digest();
const firmar = o => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return p + "." + crypto.createHmac("sha256", secreto()).update(p).digest("base64url"); };
function leer(t) {
  const [p, f] = String(t || "").split(".");
  if (!p || !f) return null;
  const a = Buffer.from(f), b = Buffer.from(crypto.createHmac("sha256", secreto()).update(p).digest("base64url"));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.exp > Date.now() ? o : null; } catch (e) { return null; }
}
const cookieDe = req => (String(req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "=")) || "").slice(COOKIE.length + 1);
const ponerCookie = (res, valor, seg) => res.setHeader("Set-Cookie", `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seg}`);

/* ---------- Agenda (Apps Script) ---------- */
async function agendaPost(accion, extra) {
  if (!AG.AGENDA_URL || !process.env.RANCHO_TOKEN) throw new Error("Falta AGENDA_URL o RANCHO_TOKEN");
  const r = await fetch(AG.AGENDA_URL, {method: "POST", headers: {"Content-Type": "application/json"}, redirect: "follow",
    body: JSON.stringify({...(extra || {}), accion, token: process.env.RANCHO_TOKEN})});
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { throw new Error("Agenda respondió " + r.status + ": " + txt.slice(0, 150)); }
}
let cacheEquipo = {t: 0, v: null};
async function equipo() {
  if (cacheEquipo.v && Date.now() - cacheEquipo.t < 120e3) return cacheEquipo.v;
  try { const j = await agendaPost("panel_equipo"); if (j.ok && Array.isArray(j.equipo) && j.equipo.length) { cacheEquipo = {t: Date.now(), v: j.equipo}; return j.equipo; } }
  catch (e) { console.error("Equipo:", e.message); }
  return EQUIPO_RESPALDO;
}
async function usuarioDe(req) {
  const s = leer(cookieDe(req)); if (!s || s.k !== "sesion") return null;
  const u = (await equipo()).find(x => x.email && x.email === s.e); // si lo dan de baja en la hoja, deja de entrar
  return u && PERMISOS[u.rol] ? {...u, permisos: PERMISOS[u.rol]} : null;
}

/* ---------- Stripe: pagos de la página ---------- */
async function stripeGet(ruta) {
  const r = await fetch(API + ruta, {headers: {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Stripe-Version": VERSION}});
  const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || "Stripe " + r.status); return j;
}
let cachePagos = {t: 0, v: null};
async function pagosStripe() {
  if (cachePagos.v && Date.now() - cachePagos.t < 60e3) return cachePagos.v;
  const desde = Math.floor(Date.now() / 1000) - 180 * 86400, lista = [];
  let after = "";
  for (let i = 0; i < 5; i++) { // hasta 500 pagos de los últimos 6 meses
    const j = await stripeGet(`checkout/sessions?limit=100&status=complete&created[gte]=${desde}${after ? "&starting_after=" + after : ""}`);
    j.data.filter(s => s.payment_status === "paid").forEach(s => {
      const m = s.metadata || {}, c = s.customer_details || {};
      lista.push({folio: s.id, fecha: new Date(s.created * 1000).toISOString(), tipo: m.tipo || "", ref: m.ref || s.client_reference_id || "",
        monto: (s.amount_total || 0) / 100, total: Number(m.total || m.estimado_total || 0), resta: Number(m.resta || 0),
        cliente: c.name || "", correo: c.email || "", telefono: c.phone || "", atendio: m.atendio || "", atendio_clave: m.atendio_clave || "",
        fechaServicio: m.fecha || "", caballo: m.caballo || "", saldo_de: m.saldo_de || "", via: "página"});
    });
    if (!j.has_more || !j.data.length) break; after = j.data[j.data.length - 1].id;
  }
  try { // restos cobrados automáticamente a la tarjeta (no pasan por Checkout)
    const j = await stripeGet("payment_intents/search?limit=100&query=" + encodeURIComponent("metadata['tipo']:'saldo_sesion' AND status:'succeeded'"));
    j.data.forEach(p => {
      if (lista.some(x => x.saldo_de && x.saldo_de === (p.metadata || {}).saldo_de && Math.abs(x.monto - p.amount / 100) < 1)) return;
      const m = p.metadata || {};
      lista.push({folio: p.id, fecha: new Date(p.created * 1000).toISOString(), tipo: "saldo_sesion", ref: m.ref || "", monto: p.amount / 100, total: 0, resta: 0,
        cliente: "", correo: "", telefono: "", atendio: m.atendio || "", atendio_clave: m.atendio_clave || "", fechaServicio: m.fecha || "", caballo: "",
        saldo_de: m.saldo_de || "", via: "tarjeta guardada"});
    });
  } catch (e) { console.error("Saldos Stripe:", e.message); }
  lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
  cachePagos = {t: Date.now(), v: lista};
  return lista;
}

/* ---------- recortes por rol ---------- */
const claveVendedor = n => ALIAS[String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/)[0]] || "";
function recortarEvento(ev, u) {
  const p = u.permisos;
  const base = {id: ev.id, titulo: ev.titulo, tipo: ev.tipo, estado: ev.estado, todoElDia: ev.todoElDia, inicio: ev.inicio, fin: ev.fin, fecha: ev.fecha,
    llegada: ev.llegada, titular: ev.titular, personas: ev.personas, ine: p.ine && ev.ine, prueba: ev.prueba,
    pagadoTodo: ev.saldo === "sin_saldo" || ev.saldo === "pagado", saldo: ev.saldo};
  if (!p.contacto) return base; // campo: nombres para la entrada, sin teléfonos, correos ni montos
  const propio = p.dinero === "todo" || (p.dinero === "propio" && claveVendedor(ev.atendio) === u.vendedor);
  return {...base, cliente: ev.cliente, telefono: ev.telefono, correo: ev.correo, atendio: ev.atendio, notas: ev.notas, folio: ev.folio,
    ...(propio ? {pagado: ev.pagado, total: ev.total, resta: ev.resta, liga: ev.liga} : {})};
}
function comisiones(pagos, maestra, u) {
  const filas = {};
  const add = (clave, nombre, origen, monto, comision, pagada) => {
    if (!clave) clave = "sin_asignar";
    if (u.permisos.dinero === "propio" && clave !== u.vendedor) return;
    const k = clave; filas[k] = filas[k] || {clave, nombre: nombre || clave, ventas: 0, comision: 0, porPagar: 0, detalle: []};
    filas[k].ventas += monto || 0; filas[k].comision += comision || 0; if (!pagada) filas[k].porPagar += comision || 0;
    filas[k].detalle.push({origen, monto, comision, pagada});
  };
  pagos.forEach(p => { if (p.atendio_clave === "nadie") return add("nadie", "Nadie (llegó por su cuenta)", `${p.tipo} · ${p.ref}`, p.monto, 0, true);
    add(p.atendio_clave === "otro" ? "otro" : p.atendio_clave, p.atendio, `Página · ${p.tipo} · ${p.ref}`, p.monto, 0, true); });
  (maestra.ventas || []).forEach(v => {
    const num = s => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
    add(claveVendedor(v["Vendedor"]), v["Vendedor"], `Maestra · ${v["Folio"]} · ${v["Concepto"]}`, num(v["Precio"]), num(v["Comisión $"]), !!String(v["Comisión pagada"] || "").trim());
  });
  return Object.values(filas).sort((a, b) => b.ventas - a.ventas);
}

/* ---------- entrada ---------- */
const intentos = new Map();
function frenar(ip) {
  const ahora = Date.now(), l = (intentos.get(ip) || []).filter(t => ahora - t < 15 * 60e3); l.push(ahora); intentos.set(ip, l); return l.length > 6;
}
async function verificarGoogle(credential) {
  const id = process.env.GOOGLE_CLIENT_ID; if (!id) return null;
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(String(credential || "")));
  if (!r.ok) return null;
  const t = await r.json();
  if (t.aud !== id || !(t.email_verified === true || t.email_verified === "true") || !/accounts\.google\.com$/.test(t.iss || "")) return null;
  return String(t.email || "").toLowerCase();
}
function abrirSesion(res, email) { ponerCookie(res, firmar({k: "sesion", e: email, exp: Date.now() + DIAS_SESION * 864e5}), DIAS_SESION * 86400); }

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    const q = req.query || {};
    if (req.method === "GET" && q.entrar) { // liga del correo
      const t = leer(q.entrar);
      const ok = t && t.k === "enlace" && (await equipo()).some(u => u.email === t.e);
      if (ok) abrirSesion(res, t.e);
      res.statusCode = 303; res.setHeader("Location", "/equipo/" + (ok ? "" : "?liga=vencida")); return res.end();
    }
    if (req.method === "POST") {
      if (req.headers["x-equipo"] !== "1") return res.status(403).json({error: "no permitido"});
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (body.accion === "salir") { ponerCookie(res, "", 0); return res.status(200).json({ok: true}); }
      if (body.accion === "enlace") {
        const ip = String(req.headers["x-real-ip"] || "").trim();
        if (frenar(ip)) return res.status(429).json({error: "Demasiados intentos. Espera unos minutos."});
        const email = String(body.email || "").trim().toLowerCase();
        const u = (await equipo()).find(x => x.email && x.email === email);
        if (u) {
          const liga = `${SITIO()}/api/equipo?entrar=${firmar({k: "enlace", e: email, exp: Date.now() + 15 * 60e3})}`;
          const r = await agendaPost("panel_acceso", {email, liga, nombre: u.nombre}).catch(e => ({ok: false, error: e.message}));
          if (!r.ok) console.error("No se mandó la liga de acceso:", r.error);
        }
        return res.status(200).json({ok: true}); // misma respuesta exista o no el correo
      }
      if (body.accion === "google") {
        const email = await verificarGoogle(body.credential);
        if (!email || !(await equipo()).some(u => u.email === email)) return res.status(401).json({error: "Esta cuenta de Google no tiene acceso al portal."});
        abrirSesion(res, email); return res.status(200).json({ok: true});
      }
      const u = await usuarioDe(req); if (!u) return res.status(401).json({error: "Tu sesión terminó. Vuelve a entrar."});
      if (body.accion !== "hacer") return res.status(400).json({error: "acción no válida"});
      if (!u.permisos.acciones.includes(body.tipo)) return res.status(403).json({error: "Tu rol no puede hacer esto."});
      if (body.tipo === "liga") { // liga de pago del resto de una sesión, para mandarla por WhatsApp
        if (!/^cs_live_[A-Za-z0-9]+$/.test(String(body.folio || ""))) return res.status(400).json({error: "folio"});
        const r = await fetch(SITIO() + "/api/saldo", {method: "POST", headers: {"Content-Type": "application/json", "x-rancho-token": process.env.RANCHO_TOKEN || ""},
          body: JSON.stringify({accion: "liga", session_id: body.folio})});
        return res.status(200).json(await r.json());
      }
      const r = await agendaPost("panel_accion", {tipo: body.tipo, evento: body.evento, fecha: body.fecha, motivo: body.motivo, nota: body.nota, como: body.como, quien: u.nombre});
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (req.method !== "GET") return res.status(405).json({error: "Método no permitido."});
    if (q.accion === "config") return res.status(200).json({google: process.env.GOOGLE_CLIENT_ID || ""});
    const u = await usuarioDe(req);
    if (!u) return res.status(401).json({error: "sin sesión", google: process.env.GOOGLE_CLIENT_ID || ""});
    const p = u.permisos;
    if (q.accion === "yo") return res.status(200).json({usuario: {nombre: u.nombre, email: u.email, rol: u.rol, vendedor: u.vendedor}, permisos: p});
    if (q.accion === "agenda") {
      const j = await agendaPost("panel_agenda", {desde: q.desde, hasta: q.hasta});
      if (!j.ok) throw new Error(j.error || "agenda");
      return res.status(200).json({generado: j.generado, eventos: j.eventos.map(e => recortarEvento(e, u))});
    }
    if (q.accion === "ine") {
      if (!p.ine) return res.status(403).json({error: "Tu rol no puede ver identificaciones."});
      const j = await agendaPost("panel_ine", {evento: String(q.evento || "")});
      return res.status(j.ok ? 200 : 404).json(j);
    }
    if (q.accion === "caballos") {
      if (!p.secciones.includes("caballos")) return res.status(403).json({error: "Sin acceso."});
      const m = await agendaPost("panel_maestra");
      if (!m.ok) throw new Error(m.error || "maestra");
      const propio = v => p.dinero === "todo" || claveVendedor(v["Vendedor"]) === u.vendedor;
      return res.status(200).json({generado: m.generado,
        ventas: m.ventas.filter(propio), pensiones: p.dinero === "todo" ? m.pensiones : [], maquilas: m.maquilas.filter(propio),
        caballos: m.caballos.map(c => p.dinero === "nada" ? {...c, Precio: ""} : c)});
    }
    if (q.accion === "pagos") {
      if (!p.secciones.includes("pagos")) return res.status(403).json({error: "Sin acceso."});
      const pagos = (await pagosStripe()).filter(x => p.dinero === "todo" || x.atendio_clave === u.vendedor);
      let maestra = {ventas: []};
      if (p.secciones.includes("comisiones")) { try { const m = await agendaPost("panel_maestra"); if (m.ok) maestra = m; } catch (e) { console.error(e); } }
      return res.status(200).json({pagos, comisiones: p.secciones.includes("comisiones") ? comisiones(pagos, maestra, u) : []});
    }
    return res.status(400).json({error: "acción no válida"});
  } catch (e) {
    console.error(e);
    return res.status(500).json({error: "No se pudo cargar. Intenta de nuevo en un momento."});
  }
};
