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
   Los POST exigen el header x-equipo: 1 (una página ajena no puede mandarlo sin permiso del navegador).

   2 oct 2026 (fase 2): tareas con fotos (asignan admin y contabilidad), bitácora y salud de caballos (campo, médicos),
   proveedores y contabilidad (admin y contabilidad), rol "medico", liga fija de celular para quien no usa correo,
   comisiones con % normal (pestaña COMISIONES) y % especial por pago (PAGOS WEB).
   GET  accion=tareas|reportes|conta|equipo_lista|cotizaciones|foto&id=
   POST hacer tipo: tarea_crear|tarea_estatus|tarea_editar|reporte|registro|liga_celular

   2 oct 2026 (reglamento): el texto vive en api/_reglamento.js (privado, solo se entrega con sesión). Su huella SHA-256
   identifica la versión exacta: quien no la ha aceptado ve el reglamento antes que el portal y aprieta "Leí y acepto".
   Cada aceptación queda en la pestaña REGLAMENTO de la Maestra (fecha y hora, persona, versión, huella, dispositivo, IP).
   GET  accion=reglamento → {version, huella, texto, aceptado, lista (solo quien asigna tareas)}
   POST hacer tipo: reglamento_aceptar {huella}

   3 oct 2026 (redes sociales): GET accion=redes · POST hacer tipo:"redes" op: subida|material|pedido|aprobar|cambios|descartar|material_estatus.
   Los videos suben directo del celular a Drive (sesión reanudable que abre el Apps Script); aquí solo pasan los datos.

   3 oct 2026 (cancelar y reagendar): solo quien asigna tareas (jefe: Nico, Mario y Judith).
   GET  accion=cambios → {filas (pestaña CANCELACIONES Y CAMBIOS), holds (reservas a medias con datos de Stripe)}
   POST hacer tipo:"cambio" objeto: cita|cotizacion|reprogramar (paso: fecha|reenviar|cancelar) · motivo: no_se_hara|reagendar_cliente|reagendar_rancho
        · modo: nosotros|cliente · fecha, horario, llegada, nota, correo, forzar. Una reserva a medias se cancela
        venciendo primero su pago en Stripe (si ya pagó, no se toca). Nunca se devuelve dinero desde aquí. */
const crypto = require("crypto");
const AG = require("./_agenda");
const REG = require("./_reglamento");
const REG_HUELLA = crypto.createHash("sha256").update(REG.texto, "utf8").digest("hex");

const SITIO = () => (process.env.SITE_URL || "https://rancho-el-descanso.vercel.app").replace(/\/$/, "");
const COOKIE = "crd_equipo";
const DIAS_SESION = 14;
const API = "https://api.stripe.com/v1/";
const VERSION = "2026-08-26.dahlia";

/* jefe = asigna, edita, revisa y cancela tareas (Nico, Mario y Judith) */
const PERMISOS = {
  admin:        {secciones: ["hoy", "tareas", "cotizaciones", "agenda", "clientes", "eventos", "cambios", "pagos", "caballos", "comisiones", "redes", "salud", "bitacora", "proveedores", "conta", "equipo"], dinero: "todo", contacto: true, ine: true, jefe: true,
                 acciones: ["saldo_pagado", "confirmar_evento", "bloquear", "nota", "liga", "tarea", "reporte", "registro", "liga_celular", "prospecto", "redes", "redes_aprobar"]},
  direccion:    {secciones: ["hoy", "tareas", "cotizaciones", "agenda", "clientes", "eventos", "pagos", "caballos", "comisiones", "redes", "salud", "bitacora"], dinero: "todo", contacto: true, ine: true, jefe: false,
                 acciones: ["saldo_pagado", "confirmar_evento", "bloquear", "nota", "liga", "tarea", "reporte", "prospecto", "redes"]},
  ventas:       {secciones: ["hoy", "tareas", "cotizaciones", "agenda", "clientes", "eventos", "pagos", "caballos", "comisiones", "redes"], dinero: "propio", contacto: true, ine: true, jefe: false, acciones: ["nota", "liga", "tarea", "prospecto", "redes"]},
  contabilidad: {secciones: ["hoy", "tareas", "agenda", "cambios", "pagos", "caballos", "comisiones", "proveedores", "conta", "bitacora", "redes"], dinero: "todo", contacto: true, ine: false, jefe: true,
                 acciones: ["saldo_pagado", "nota", "tarea", "reporte", "registro", "redes"]},
  campo:        {secciones: ["hoy", "tareas", "redes", "bitacora", "salud", "agenda"], dinero: "nada", contacto: false, ine: true, jefe: false, acciones: ["nota", "tarea", "reporte", "redes"]},
  medico:       {secciones: ["hoy", "tareas", "salud", "bitacora", "redes"], dinero: "nada", contacto: false, ine: false, jefe: false, acciones: ["tarea", "reporte", "redes"]}
};
/* Redes sociales (3 oct 2026): todos suben fotos/videos y piden publicaciones; solo admin (Nico y Mario) aprueba.
   Campo y médicos ven lo que ellos subieron y lo ya publicado; la oficina ve calendario y métricas. */
const OFICINA = ["admin", "direccion", "ventas", "contabilidad"];
Object.values(PERMISOS).forEach(p => p.secciones.push("reglamento")); // todos pueden releerlo
const DIAS_CELULAR = 400; // la liga fija del celular dura ~1 año; se invalida al generar otra o con Activo = NO
/* Respaldo si la pestaña EQUIPO no responde: solo Nico puede entrar */
const EQUIPO_RESPALDO = [{nombre: "Nicolás Campero", email: "nicolas@legaius.com", id: "nicolas@legaius.com", rol: "admin", vendedor: "nico", liga: 0}];
/* Claves oficiales (2 oct 2026): nico · moni · yuliana (las de la pestaña EQUIPO y las ligas ?v=).
   Nombres de la columna Vendedor de la Maestra y claves viejas de pagos (nicolas, monica) → clave oficial */
const ALIAS = {nico: "nico", nicolas: "nico", moni: "moni", monica: "moni", yuli: "yuliana", yuliana: "yuliana"};
const canon = k => { k = String(k || "").toLowerCase().trim(); return ALIAS[k] || k; };

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
let cacheEquipo = {t: 0, v: null}, cacheReg = {t: 0, v: null};
async function aceptaciones() {
  if (cacheReg.v && Date.now() - cacheReg.t < 60e3) return cacheReg.v;
  const j = await agendaPost("panel_reglamento"); if (!j.ok) throw new Error(j.error || "reglamento");
  cacheReg = {t: Date.now(), v: j.aceptaciones || []}; return cacheReg.v;
}
async function equipo() {
  if (cacheEquipo.v && Date.now() - cacheEquipo.t < 120e3) return cacheEquipo.v;
  try { const j = await agendaPost("panel_equipo");
    if (j.ok && Array.isArray(j.equipo) && j.equipo.length) { const v = j.equipo.map(x => ({...x, id: x.id || x.email})); cacheEquipo = {t: Date.now(), v}; return v; } }
  catch (e) { console.error("Equipo:", e.message); }
  return EQUIPO_RESPALDO;
}
async function usuarioDe(req) {
  const s = leer(cookieDe(req)); if (!s || s.k !== "sesion") return null;
  const u = (await equipo()).find(x => x.id && x.id === s.e); // si lo dan de baja en la hoja, deja de entrar
  if (!u || !PERMISOS[u.rol]) return null;
  if (s.v !== undefined && Number(s.v) !== Number(u.liga || 0)) return null; // liga de celular reemplazada
  return {...u, vendedor: canon(u.vendedor), permisos: PERMISOS[u.rol]};
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
        cliente: c.name || "", correo: c.email || "", telefono: c.phone || "", atendio: m.atendio || "", atendio_clave: canon(m.atendio_clave),
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
        cliente: "", correo: "", telefono: "", atendio: m.atendio || "", atendio_clave: canon(m.atendio_clave), fechaServicio: m.fecha || "", caballo: "",
        saldo_de: m.saldo_de || "", via: "tarjeta guardada"});
    });
  } catch (e) { console.error("Saldos Stripe:", e.message); }
  lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
  cachePagos = {t: Date.now(), v: lista};
  return lista;
}

/* ---------- recortes por rol ---------- */
const claveVendedor = n => ALIAS[String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/)[0]] || "";
/* Corrección de "¿Quién te atendió?" (2 oct 2026): columna "Atendió (corrección)" en la pestaña PAGOS WEB de la Maestra.
   Se escribe Nico, Moni, Yuliana, Nadie u otro nombre en la fila del pago (se busca por "Folio Stripe").
   Gana sobre lo que eligió el cliente en la página; también aplica al resto cobrado después (saldo_de). */
const COL_CORRECCION = "Atendió (corrección)";
async function maestraSegura() { try { const m = await agendaPost("panel_maestra"); if (m && m.ok) return m; } catch (e) { console.error("Maestra:", e.message); } return {ventas: [], pagosWeb: []}; }
async function correcciones(m) {
  const eq = await equipo(), mapa = {};
  (m.pagosWeb || []).forEach(r => {
    const folio = String(r["Folio Stripe"] || "").trim(), txt = String(r[COL_CORRECCION] || "").trim();
    if (!folio || !txt) return;
    const sin = txt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/^(nadie|ninguno|n\/a)$/.test(sin)) { mapa[folio] = {atendio: "Nadie (llegó por su cuenta)", atendio_clave: "nadie"}; return; }
    const clave = claveVendedor(txt) || canon(sin.split(/\s+/)[0]);
    const quien = eq.find(x => canon(x.vendedor) === clave);
    mapa[folio] = quien ? {atendio: quien.nombre, atendio_clave: clave} : {atendio: txt + " (corregido)", atendio_clave: "otro"};
  });
  return mapa;
}
const corregir = (x, mapa) => { const c = mapa[x.folio] || (x.saldo_de && mapa[x.saldo_de]); return c ? {...x, ...c, corregido: true} : x; };
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
/* % de comisión: pestaña COMISIONES (% normal) y, por pago de la página, "Comisión % (especial)" en PAGOS WEB.
   Caballos y potros apartados en la página se comisionan en VENTAS (la venta completa), no aquí. */
const pct = s => { const t = String(s || "").trim(); if (!t) return null; const n = Number(t.replace(/[^0-9.]/g, "")); return isNaN(n) ? null : (/%/.test(t) || n > 1 ? n / 100 : n); };
function tasasDe(m) {
  const t = {}; (m.tasas || []).forEach(r => { t[String(r["Tipo"] || "").trim()] = pct(r["% normal"]); });
  const val = (k, def) => (t[k] === undefined ? def : t[k] || 0);
  return {sesion: val("Sesiones de fotos", 0.10), evento: val("Eventos", 0.10)};
}
function datosPagoWeb(m) {
  const d = {}; (m.pagosWeb || []).forEach(r => { const f = String(r["Folio Stripe"] || "").trim(); if (f) d[f] = {tasa: pct(r["Comisión % (especial)"]), pagada: !!String(r["Comisión pagada"] || "").trim()}; });
  return d;
}
function comisiones(pagos, maestra, u) {
  const filas = {}, tasas = tasasDe(maestra), web = datosPagoWeb(maestra);
  const add = (clave, nombre, origen, monto, comision, pagada) => {
    if (!clave) clave = "sin_asignar";
    if (u.permisos.dinero === "propio" && clave !== u.vendedor) return;
    const k = clave; filas[k] = filas[k] || {clave, nombre: nombre || clave, ventas: 0, comision: 0, porPagar: 0, detalle: []};
    filas[k].ventas += monto || 0; filas[k].comision += comision || 0; if (!pagada) filas[k].porPagar += comision || 0;
    filas[k].detalle.push({origen, monto, comision, pagada});
  };
  pagos.forEach(p => {
    const w = web[p.folio] || web[p.saldo_de] || {};
    const base = p.tipo === "evento" ? tasas.evento : (p.tipo === "sesion" || p.tipo === "saldo_sesion") ? tasas.sesion : 0;
    const tasa = w.tasa !== null && w.tasa !== undefined ? w.tasa : base, com = Math.round((p.monto || 0) * tasa * 100) / 100;
    const origen = `Página · ${p.tipo} · ${p.ref}${tasa ? ` · ${Math.round(tasa * 10000) / 100}%` : (p.tipo === "caballo" || p.tipo === "potro") ? " · se comisiona en VENTAS" : ""}`;
    if (p.atendio_clave === "nadie") return add("nadie", "Nadie (llegó por su cuenta)", origen, p.monto, 0, true);
    add(p.atendio_clave === "otro" ? "otro" : p.atendio_clave, p.atendio, origen, p.monto, com, !!w.pagada || !com); });
  (maestra.ventas || []).forEach(v => {
    const num = s => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
    add(claveVendedor(v["Vendedor"]), v["Vendedor"], `Maestra · ${v["Folio"]} · ${v["Concepto"]}`, num(v["Precio"]), num(v["Comisión $"]), !!String(v["Comisión pagada"] || "").trim());
  });
  return Object.values(filas).sort((a, b) => b.ventas - a.ventas);
}

/* ---------- cancelar y reagendar (3 oct 2026) ---------- */
const hoyMX = (n = 0) => new Date(Date.now() - 6 * 36e5 + n * 864e5).toISOString().slice(0, 10);
const MOTIVOS = ["no_se_hara", "reagendar_cliente", "reagendar_rancho"];
async function stripePost(ruta) {
  const r = await fetch(API + ruta, {method: "POST", headers: {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Stripe-Version": VERSION}});
  return {ok: r.ok, j: await r.json().catch(() => ({}))};
}
async function cambio(u, body, res) {
  if (!u.permisos.jefe) return res.status(403).json({error: "Solo Nico, Mario y Judith pueden cancelar o reagendar."});
  const objeto = String(body.objeto || ""), d = {quien: u.nombre, nota: String(body.nota || "").slice(0, 400), correo: !!body.correo, forzar: !!body.forzar};
  if (objeto === "reprogramar") {
    if (!["fecha", "reenviar", "cancelar"].includes(body.paso)) return res.status(400).json({error: "acción no válida"});
    Object.assign(d, {op: "reprogramar", id: String(body.id || ""), paso: body.paso});
  } else {
    if (!MOTIVOS.includes(body.motivo)) return res.status(400).json({error: "Elige el motivo."});
    d.motivo = body.motivo;
    if (objeto === "cotizacion") Object.assign(d, {op: "cotizacion", id: String(body.id || "")});
    else if (objeto === "cita") Object.assign(d, {op: "cita", evento: String(body.evento || ""), modo: body.modo === "cliente" ? "cliente" : "nosotros", folio: String(body.folio || "")});
    else return res.status(400).json({error: "acción no válida"});
  }
  if (objeto === "cita" && d.motivo !== "no_se_hara" && d.modo === "nosotros" || objeto === "reprogramar" && body.paso === "fecha") {
    d.fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || "")) ? body.fecha : "";
    if (!d.fecha) return res.status(400).json({error: "Elige la nueva fecha."});
    if (body.horario) {
      if (!AG.SLOTS[body.horario]) return res.status(400).json({error: "Horario no válido."});
      d.horario = body.horario;
      d.llegada = (AG.LLEGADAS[body.horario] || []).includes(body.llegada) ? body.llegada : "";
    }
  }
  if (objeto === "cotizacion" && d.motivo !== "no_se_hara") d.fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || "")) ? body.fecha : "";
  // Reserva a medias: primero se vence el pago en Stripe para que ya no lo puedan completar
  if (objeto === "cita" && d.motivo === "no_se_hara" && /^cs_(live|test)_[A-Za-z0-9]+$/.test(d.folio)) {
    const s = await stripeGet("checkout/sessions/" + d.folio).catch(() => null);
    if (s && s.status === "complete") return res.status(409).json({error: "Esta reserva ya se pagó: recarga, ya es una cita y solo se puede reagendar."});
    if (s && s.status === "open") { const x = await stripePost("checkout/sessions/" + d.folio + "/expire"); if (!x.ok) return res.status(409).json({error: "No se pudo cancelar el pago en proceso. Intenta de nuevo en un minuto."}); }
  }
  const r = await agendaPost("panel_cambios", d);
  return res.status(r.ok ? 200 : 400).json(r);
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
function abrirSesion(res, id, v) {
  const dias = v === undefined ? DIAS_SESION : DIAS_CELULAR;
  ponerCookie(res, firmar({k: "sesion", e: id, ...(v === undefined ? {} : {v}), exp: Date.now() + dias * 864e5}), dias * 86400);
}
const ROL_TXT = {admin: "Administración", direccion: "Dirección", ventas: "Ventas", contabilidad: "Contabilidad", campo: "Rancho", medico: "Médico"};
const puede = (u, s) => u.permisos.secciones.includes(s);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    const q = req.query || {};
    if (req.method === "GET" && q.entrar) { // liga del correo
      const t = leer(q.entrar), eq = await equipo();
      let ok = false;
      if (t && t.k === "enlace" && eq.some(u => u.id === t.e)) { ok = true; abrirSesion(res, t.e); }
      if (t && t.k === "celular") { const u = eq.find(x => x.id === t.e); if (u && Number(u.liga || 0) === Number(t.v)) { ok = true; abrirSesion(res, t.e, Number(t.v)); } }
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
          const liga = `${SITIO()}/api/equipo?entrar=${firmar({k: "enlace", e: u.id, exp: Date.now() + 15 * 60e3})}`;
          const r = await agendaPost("panel_acceso", {email, liga, nombre: u.nombre}).catch(e => ({ok: false, error: e.message}));
          if (!r.ok) console.error("No se mandó la liga de acceso:", r.error);
        }
        return res.status(200).json({ok: true}); // misma respuesta exista o no el correo
      }
      if (body.accion === "google") {
        const email = await verificarGoogle(body.credential);
        const g = email && (await equipo()).find(u => u.email === email);
        if (!g) return res.status(401).json({error: "Esta cuenta de Google no tiene acceso al portal."});
        abrirSesion(res, g.id); return res.status(200).json({ok: true});
      }
      const u = await usuarioDe(req); if (!u) return res.status(401).json({error: "Tu sesión terminó. Vuelve a entrar."});
      if (body.accion !== "hacer") return res.status(400).json({error: "acción no válida"});
      if (body.tipo === "reglamento_aceptar") {
        if (body.huella !== REG_HUELLA) return res.status(409).json({error: "El reglamento cambió mientras lo leías. Vuelve a abrir el portal."});
        const r = await agendaPost("panel_reglamento_aceptar", {id: u.id, quien: u.nombre, rol: u.rol, version: REG.version, huella: REG_HUELLA,
          dispositivo: String(req.headers["user-agent"] || "").slice(0, 200), ip: String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim()});
        cacheReg = {t: 0, v: null};
        return res.status(r.ok ? 200 : 400).json(r);
      }
      if (body.tipo === "redes") {
        if (!u.permisos.acciones.includes("redes")) return res.status(403).json({error: "Tu rol no puede hacer esto."});
        const op = String(body.op || "");
        if (["aprobar", "cambios", "descartar", "material_estatus"].includes(op) && !u.permisos.acciones.includes("redes_aprobar")) return res.status(403).json({error: "Solo Nico y Mario aprueban publicaciones."});
        const permitidas = {subida: ["mime", "tamano", "nombre", "tema"], material: ["fileId", "tema", "caballo", "nota"], pedido: ["tema", "nota", "caballo", "fecha"],
          aprobar: ["id", "texto", "hashtags"], cambios: ["id", "nota"], descartar: ["id", "nota"], material_estatus: ["id", "estatus"]};
        if (!permitidas[op]) return res.status(400).json({error: "acción no válida"});
        const datos = {op, quien: u.nombre}; permitidas[op].forEach(k => { if (body[k] !== undefined) datos[k] = body[k]; });
        if (op === "subida") { datos.origen = String(req.headers.origin || SITIO()); datos.tipo = String(body.mime || ""); delete datos.mime; }
        const r = await agendaPost("panel_redes", datos);
        return res.status(r.ok ? 200 : 400).json(r);
      }
      if (body.tipo === "cambio") return await cambio(u, body, res);
      const FASE2 = {tarea_crear: "tarea", tarea_estatus: "tarea", tarea_editar: "tarea", reporte: "reporte", registro: "registro", liga_celular: "liga_celular", prospecto: "prospecto"};
      if (FASE2[body.tipo]) {
        const p = u.permisos;
        if (!p.acciones.includes(FASE2[body.tipo])) return res.status(403).json({error: "Tu rol no puede hacer esto."});
        if ((body.tipo === "tarea_crear" || body.tipo === "tarea_editar") && !p.jefe) return res.status(403).json({error: "Solo Nico, Mario y Judith asignan tareas."});
        const archivos = Array.isArray(body.archivos) ? body.archivos.slice(0, 6) : [];
        if (archivos.reduce((a, x) => a + String(x && x.datos || "").length, 0) > 5.5e6) return res.status(413).json({error: "Las fotos pesan demasiado. Manda menos a la vez."});
        if (body.tipo === "reporte") {
          const area = String((body.reporte || {}).area || "");
          if (area === "Salud" && !puede(u, "salud")) return res.status(403).json({error: "Tu rol no puede registrar salud."});
        }
        const r = await agendaPost("panel_fase2", {tipo: body.tipo, quien: u.nombre, jefe: !!p.jefe, id: body.id, estatus: body.estatus, nota: body.nota,
          tarea: body.tarea, cambios: body.cambios, reporte: body.reporte, registro: body.registro, archivos});
        if (body.tipo === "liga_celular" && r.ok) {
          cacheEquipo = {t: 0, v: null};
          const per = (await equipo()).find(x => x.id === body.id);
          r.url = `${SITIO()}/api/equipo?entrar=${firmar({k: "celular", e: body.id, v: r.liga, exp: Date.now() + DIAS_CELULAR * 864e5})}`;
          r.nombre = per ? per.nombre : "";
        }
        return res.status(r.ok ? 200 : 400).json(r);
      }
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
    if (q.accion === "yo") return res.status(200).json({usuario: {nombre: u.nombre, email: u.email, rol: u.rol, rolTxt: ROL_TXT[u.rol] || u.rol, vendedor: u.vendedor, area: u.area || ""}, permisos: p});
    if (q.accion === "redes") {
      if (!puede(u, "redes")) return res.status(403).json({error: "Sin acceso."});
      const j = await agendaPost("panel_redes", {op: "lista"}); if (!j.ok) throw new Error(j.error || "redes");
      const ofi = OFICINA.includes(u.rol), aprueba = p.acciones.includes("redes_aprobar");
      const mio = x => String(x["Subió"] || "") === u.nombre || String(x["Origen"] || "").endsWith(" · " + u.nombre);
      return res.status(200).json({aprueba, oficina: ofi,
        material: j.material.filter(x => ofi || mio(x)),
        publicaciones: j.publicaciones.filter(x => aprueba || (ofi ? x["Estatus"] !== "Descartado" : (["Agendado", "Publicado"].includes(x["Estatus"]) || mio(x)))),
        plan: ofi ? j.plan : [], metricas: ofi ? j.metricas : [], caballos: j.caballos});
    }
    if (q.accion === "tareas") {
      if (!puede(u, "tareas")) return res.status(403).json({error: "Sin acceso."});
      const j = await agendaPost("panel_tareas"); if (!j.ok) throw new Error(j.error || "tareas");
      const eq = await equipo();
      const tareas = j.tareas.filter(t => p.jefe || t["Asignada a"] === u.nombre || t["Asignó"] === u.nombre).map(t => { const x = {...t}; delete x._fila; return x; });
      return res.status(200).json({tareas, personas: p.jefe ? eq.map(x => ({nombre: x.nombre, rol: ROL_TXT[x.rol] || x.rol, area: x.area || ""})) : []});
    }
    if (q.accion === "reportes") {
      if (!puede(u, "bitacora") && !puede(u, "salud")) return res.status(403).json({error: "Sin acceso."});
      const [j, m] = await Promise.all([agendaPost("panel_reportes"), maestraSegura()]); if (!j.ok) throw new Error(j.error || "reportes");
      const reportes = j.reportes.filter(r => r["Área"] === "Salud" ? puede(u, "salud") : puede(u, "bitacora")).map(r => { const x = {...r}; delete x._fila; return x; });
      return res.status(200).json({reportes, caballos: (m.caballos || []).map(c => ({ID: c["ID"], Nombre: c["Nombre"], Raza: c["Raza"], Sexo: c["Sexo"], Estatus: c["Estatus"], "Cargada de": c["Cargada de"], "Fecha pare": c["Fecha pare"]}))});
    }
    if (q.accion === "conta") {
      if (!puede(u, "conta") && !puede(u, "proveedores")) return res.status(403).json({error: "Sin acceso."});
      const j = await agendaPost("panel_conta"); if (!j.ok) throw new Error(j.error || "conta");
      return res.status(200).json(j);
    }
    if (q.accion === "cotizaciones") {
      if (!puede(u, "cotizaciones") && !p.jefe) return res.status(403).json({error: "Sin acceso."});
      const j = await agendaPost("panel_prospectos"); if (!j.ok) throw new Error(j.error || "cotizaciones");
      const eq = await equipo();
      return res.status(200).json({prospectos: j.prospectos.map(r => { const x = {...r}; delete x._fila; return x; }),
        personas: eq.filter(x => ["admin", "direccion", "ventas"].includes(x.rol)).map(x => x.nombre)});
    }
    if (q.accion === "cambios") {
      if (!p.jefe) return res.status(403).json({error: "Sin acceso."});
      const [j, ag] = await Promise.all([agendaPost("panel_cambios", {op: "lista"}), agendaPost("panel_agenda", {desde: hoyMX(-1), hasta: hoyMX(400)})]);
      if (!j.ok) throw new Error(j.error || "cambios");
      const holds = await Promise.all((ag.ok ? ag.eventos : []).filter(e => e.estado === "reservando" && !e.prueba).map(async e => {
        const x = {id: e.id, titulo: e.titulo, tipo: e.tipo, fecha: e.fecha, inicio: e.inicio, fin: e.fin, todoElDia: e.todoElDia, folio: e.folio};
        const vence = String(e.notas || "").match(/Vence: (\S+)/); if (vence) x.vence = vence[1];
        if (/^cs_(live|test)_/.test(e.folio || "")) try {
          const s = await stripeGet("checkout/sessions/" + e.folio), m = s.metadata || {};
          Object.assign(x, {titular: m.titular || "", paquete: m.paquete || "", horario: m.horario || "", llegada: m.llegada || "", evento: m.evento || "", invitados: m.invitados || "",
            monto: (s.amount_total || 0) / 100, total: Number(m.total || m.estimado_total || 0), atendio: m.atendio || "", estadoPago: s.status});
        } catch (err) { console.error("hold", e.folio, err.message); }
        return x;
      }));
      return res.status(200).json({filas: j.filas, holds});
    }
    if (q.accion === "reglamento") {
      const acs = await aceptaciones(), vale = a => a["Huella del texto (SHA-256)"] === REG_HUELLA;
      const mio = acs.filter(a => a["Correo / ID"] === u.id && vale(a)).pop();
      const out = {version: REG.version, huella: REG_HUELLA, texto: REG.texto, aceptado: mio ? mio["Fecha y hora"] : ""};
      if (p.jefe) out.lista = (await equipo()).map(x => {
        const suyas = acs.filter(a => a["Correo / ID"] === x.id), ok = suyas.filter(vale).pop(), ult = suyas[suyas.length - 1];
        return {nombre: x.nombre, rol: ROL_TXT[x.rol] || x.rol, aceptado: ok ? ok["Fecha y hora"] : "", anterior: !ok && ult ? `versión ${ult["Versión"]} (${ult["Fecha y hora"]})` : ""};
      });
      return res.status(200).json(out);
    }
    if (q.accion === "equipo_lista") {
      if (!puede(u, "equipo")) return res.status(403).json({error: "Sin acceso."});
      return res.status(200).json({equipo: (await equipo()).map(x => ({id: x.id, nombre: x.nombre, rol: ROL_TXT[x.rol] || x.rol, area: x.area || "", correo: x.email || "", liga: x.liga || 0}))});
    }
    if (q.accion === "foto") {
      if (!["tareas", "bitacora", "salud", "conta"].some(s => puede(u, s))) return res.status(403).json({error: "Sin acceso."});
      if (!/^[A-Za-z0-9_-]{20,}$/.test(String(q.id || ""))) return res.status(400).json({error: "archivo"});
      const j = await agendaPost("panel_foto", {id: String(q.id)});
      return res.status(j.ok ? 200 : 404).json(j);
    }
    if (q.accion === "agenda") {
      if (!puede(u, "agenda")) return res.status(403).json({error: "Sin acceso."});
      const [j, m] = await Promise.all([agendaPost("panel_agenda", {desde: q.desde, hasta: q.hasta}), maestraSegura()]);
      if (!j.ok) throw new Error(j.error || "agenda");
      const mapa = await correcciones(m);
      return res.status(200).json({generado: j.generado, eventos: j.eventos.map(e => recortarEvento(e.folio && mapa[e.folio] ? {...e, atendio: mapa[e.folio].atendio} : e, u))});
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
      const propio = v => p.dinero === "todo" || (p.dinero === "propio" && !!u.vendedor && claveVendedor(v["Vendedor"]) === u.vendedor);
      return res.status(200).json({generado: m.generado,
        ventas: m.ventas.filter(propio), pensiones: p.dinero === "todo" ? m.pensiones : [], maquilas: m.maquilas.filter(propio),
        caballos: m.caballos.map(c => p.dinero === "nada" ? {...c, Precio: ""} : c)});
    }
    if (q.accion === "pagos") {
      if (!p.secciones.includes("pagos")) return res.status(403).json({error: "Sin acceso."});
      const [todos, maestra] = await Promise.all([pagosStripe(), maestraSegura()]);
      const mapa = await correcciones(maestra);
      const pagos = todos.map(x => corregir(x, mapa)).filter(x => p.dinero === "todo" || x.atendio_clave === u.vendedor);
      return res.status(200).json({pagos, comisiones: p.secciones.includes("comisiones") ? comisiones(pagos, maestra, u) : []});
    }
    return res.status(400).json({error: "acción no válida"});
  } catch (e) {
    console.error(e);
    return res.status(500).json({error: "No se pudo cargar. Intenta de nuevo en un momento."});
  }
};
