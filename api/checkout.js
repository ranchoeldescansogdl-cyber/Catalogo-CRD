/* Rancho El Descanso · crea el pago en Stripe Checkout.
   La llave secreta vive SOLO en Vercel (Settings > Environment Variables > STRIPE_SECRET_KEY).
   El monto SIEMPRE se calcula aquí con los precios de la hoja; lo que mande el navegador no se usa como monto.

   POST /api/checkout
     {tipo:"caballo", id:"<id del caballo en la página>"}
     {tipo:"potro"}
     {tipo:"evento", evento:"boda|xv|social|corporativo", inv:120, hx:1, iva:true, fecha:"2026-11-14"}
     {tipo:"sesion", paquete:"manana|tarde|produccion", fecha:"2026-11-14", horario:"10-14|14-18", iva:false,
      llegada:"10:30", titular:"Nombre como en la identificación", acompanantes:["Nombre 1", …],
      ine:{nombre:"ine.jpg", tipo:"image/jpeg", datos:"<base64>"}, ine_ok:true}
   Sesiones y eventos revisan la Agenda (Google Calendar) y apartan el horario 35 min mientras se paga.
   1 oct 2026: días festivos (api/_festivos.js) sin sesiones ni apartado de eventos en línea (se pregunta por WhatsApp).
   Sesiones piden hora de llegada, acompañantes con nombre (máx. 8 personas en total) e identificación del titular;
   la identificación viaja al Apps Script de la Agenda, que la guarda en una carpeta privada de Drive.
   1 oct 2026: todo pago lleva atendio ("nicolas" | "nadie" | "otro:Nombre"): quién del Rancho atendió (comisiones);
   GET /api/checkout devuelve {modo, vendedores} para armar la lista en la página.
   1 oct 2026: sesiones con anticipo guardan la tarjeta (customer_creation + setup_future_usage) y el aviso en el botón
   de pago dice que el resto se cobra solo a esa tarjeta 2 días antes; el cobro lo hace api/saldo.js.
   Responde {url} (página de pago de Stripe) o {error}. */

const HOJAS = {
  catalogo: "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6AirAw8dafLnUa6ND6FuI4VhqRGK-8MyJykM0Z3I1Z9jiOecwAN4VYyi9lGMZweuf3w-LLSx7KKC-/pub?gid=217518953&single=true&output=csv",
  tarifas: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRB8_wzp7c5W-OLs1YFFBOiRt_oZ2rF0aHFIOxfKPxHYnICNrDL6UW78rzFp49r-6L08MyMNiRSMq8h/pub?gid=1137766291&single=true&output=csv",
  fechas: "" // pestaña FECHAS WEB publicada como CSV (igual que en index.html). Vacío = no revisa disponibilidad
};

/* ¿Quién te atendió? (1 oct 2026): obligatorio en todo pago, para comisiones. Respaldo si la Agenda no responde */
const VENDEDORES_FALLBACK = [{clave: "nicolas", nombre: "Nicolás Campero"}, {clave: "monica", nombre: "Mónica Valle"}, {clave: "yuliana", nombre: "Yuliana Garibay"}];

/* Respaldo si la pestaña TARIFAS no responde (mismos valores que index.html, 28 sep 2026) */
const TARIFAS_FALLBACK = [
  ["evento","boda",1,80,40000,5,3000,0.1],["evento","boda",81,150,50000,5,3000,0.1],["evento","boda",151,200,55000,5,3000,0.1],
  ["evento","boda",201,300,65000,5,3000,0.1],["evento","boda",301,500,75000,5,3000,0.1],
  ["evento","xv",1,80,35000,5,3000,0.1],["evento","xv",81,150,45000,5,3000,0.1],["evento","xv",151,200,50000,5,3000,0.1],
  ["evento","xv",201,300,60000,5,3000,0.1],["evento","xv",301,500,70000,5,3000,0.1],
  ["evento","social",1,80,35000,5,3000,0.1],["evento","social",81,150,45000,5,3000,0.1],["evento","social",151,200,50000,5,3000,0.1],
  ["evento","social",201,300,60000,5,3000,0.1],["evento","social",301,500,70000,5,3000,0.1],
  ["evento","corporativo",1,80,40000,5,3000,0.1],["evento","corporativo",81,150,50000,5,3000,0.1],["evento","corporativo",151,200,55000,5,3000,0.1],
  ["evento","corporativo",201,300,65000,5,3000,0.1],["evento","corporativo",301,500,75000,5,3000,0.1],
  ["factor","sabado","","",1.0],["factor","viernes","","",0.9],["factor","domingo","","",1.1],
  ["factor","entre_semana","","",0.8],["factor","temporada_alta","","",1.15],
  ["apartado","caballo_en_venta","","",0,"","",0.1],["apartado","potro_2027","","",10000],
  ["sesion","manana","","",4000,3,1500,2500],["sesion","tarde","","",5000,3,1500,2500],["sesion","produccion","","",10000,4,2500,0.5]
].map(r => ({servicio:r[0], tipo:r[1], min:r[2], max:r[3], precio:r[4], horas:r[5], hora_extra:r[6], anticipo:r[7]}));

const TIPO_LBL = {boda:"Boda", xv:"XV años", social:"Evento social", corporativo:"Evento corporativo"};
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

/* --- utilidades (las mismas que usa index.html) --- */
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = s => norm(s).replace(/ /g, "-");
const numv = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const pct = v => { const n = numv(v); if (/\$/.test(String(v)) || n > 100) return n; return n > 1 ? n / 100 : n; };
const parseMoney = s => { const n = String(s || "").replace(/[^0-9.]/g, ""); return n ? Math.round(parseFloat(n)) : null; };
const col = (r, name) => { for (const k in r) if (norm(k) === name) return r[k]; return ""; };
const si = v => norm(v) === "si";
const money = n => "$" + Number(n).toLocaleString("es-MX");

function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter(r => r.some(v => v.trim() !== "")).map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()])));
}
async function fetchCSV(url) {
  if (!url) return null;
  try {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), {cache: "no-store"});
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = parseCSV(await res.text());
    return rows.length ? rows : null;
  } catch (e) { console.warn("No se pudo leer " + url, e); return null; }
}
function isoDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}
async function loadTarifas() {
  const rows = await fetchCSV(HOJAS.tarifas);
  if (rows) {
    const list = rows.map(r => ({
      servicio: norm(col(r, "servicio")), tipo: norm(col(r, "tipo")), min: numv(col(r, "min invitados")), max: numv(col(r, "max invitados")),
      precio: numv(col(r, "precio base mxn") || col(r, "precio base")), horas: numv(col(r, "horas incluidas")),
      hora_extra: numv(col(r, "hora extra mxn") || col(r, "hora extra")), anticipo: pct(col(r, "anticipo")), publicar: col(r, "publicar")
    })).filter(t => t.servicio && (t.publicar === "" || si(t.publicar)));
    if (list.length) return list;
  }
  return TARIFAS_FALLBACK.map(t => ({...t, servicio: norm(t.servicio), tipo: norm(t.tipo)}));
}
const tarifaDe = (T, servicio, tipo) => T.find(t => t.servicio === servicio && t.tipo === norm(tipo));
const hoyMX = () => new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10); // fecha de hoy en Guadalajara (UTC-6)

class UserError extends Error {}

let cacheVend = {t: 0, v: null};
async function loadVendedores() {
  // La lista vive en la pestaña EQUIPO de la Maestra (columna "Sale en ¿Quién te atendió?"); la entrega el Apps Script de la Agenda
  if (cacheVend.v && Date.now() - cacheVend.t < 5 * 60e3) return cacheVend.v;
  let list = [];
  try {
    if (AG.AGENDA_URL) {
      const r = await fetch(AG.AGENDA_URL + "?accion=vendedores", {redirect: "follow"});
      const j = await r.json();
      list = (j && j.ok && Array.isArray(j.vendedores) ? j.vendedores : [])
        .map(v => ({clave: String(v.clave || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30), nombre: String(v.nombre || "").trim().slice(0, 60)}))
        .filter(v => v.clave && v.nombre);
    }
  } catch (e) { console.warn("Vendedores:", e.message); }
  if (!list.length) list = VENDEDORES_FALLBACK;
  cacheVend = {t: Date.now(), v: list};
  return list;
}
/* "nicolas" | "nadie" | "otro:Nombre" → {atendio (nombre legible), atendio_clave} */
async function atendioDe(v) {
  v = String(v || "").trim();
  if (!v) throw new UserError("Dinos quién del Rancho te atendió para continuar.");
  if (v === "nadie") return {atendio: "Nadie (llegó por su cuenta)", atendio_clave: "nadie"};
  if (v.startsWith("otro:")) {
    const n = v.slice(5).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (n.length < 3) throw new UserError("Escribe el nombre de quien te atendió.");
    return {atendio: n + " (escrito por el cliente)", atendio_clave: "otro"};
  }
  const x = (await loadVendedores()).find(p => p.clave === v.toLowerCase());
  if (!x) throw new UserError("Elige de nuevo quién te atendió.");
  return {atendio: x.nombre, atendio_clave: x.clave};
}
const AG = require("./_agenda");
const FEST = require("./_festivos");
const crypto = require("crypto");

/* Freno contra abuso (30 sep 2026): máximo de intentos de pago por IP en 10 min, por instancia.
   Es una primera barrera; la Agenda además limita los apartados simultáneos por IP y en total. */
const LIMITE = {ventana: 10 * 60e3, max: 8};
const intentos = new Map();
function ipDe(req) { return String(req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim(); }
function demasiados(ip) {
  if (!ip) return false;
  const ahora = Date.now(), lista = (intentos.get(ip) || []).filter(t => ahora - t < LIMITE.ventana);
  lista.push(ahora); intentos.set(ip, lista);
  if (intentos.size > 5000) for (const [k, v] of intentos) if (!v.some(t => ahora - t < LIMITE.ventana)) intentos.delete(k);
  return lista.length > LIMITE.max;
}
const ipHash = ip => ip ? crypto.createHash("sha256").update("crd|" + ip).digest("hex").slice(0, 16) : "";
const maxFecha = () => new Date(Date.now() + 2 * 365 * 864e5).toISOString().slice(0, 10);

/* --- cada tipo de pago: devuelve {monto, nombre, descripcion, ref, pago} --- */
async function cargoCaballo(body, T) {
  const id = String(body.id || "").slice(0, 120);
  if (!id) throw new UserError("Falta el caballo.");
  const rows = await fetchCSV(HOJAS.catalogo);
  if (!rows) throw new UserError("No pudimos revisar el catálogo en este momento. Escríbenos por WhatsApp.");
  const nuevo = rows.some(r => col(r, "publicar") !== "");
  const r = rows.find(r => slug(col(r, "nombre")) === id && (!nuevo || si(col(r, "publicar"))));
  if (!r) throw new UserError("No encontramos ese caballo en el catálogo.");
  const est = norm(col(r, "estatus"));
  if (est === "apartado" || est === "vendido") throw new UserError("Este caballo ya está " + est + ". Escríbenos por WhatsApp para opciones parecidas.");
  const precio = parseMoney(col(r, "precio"));
  if (!precio) throw new UserError("Este caballo no tiene precio publicado. Escríbenos por WhatsApp.");
  if (precio < 20000) throw new UserError("El precio de este caballo no se pudo leer bien. Escríbenos por WhatsApp.");
  const t = tarifaDe(T, "apartado", "caballo_en_venta"); let p = (t && t.anticipo) || 0.10;
  if (!(p > 0 && p <= 0.5)) p = 0.10;
  const monto = Math.round(precio * p);
  const nombre = col(r, "nombre");
  return {
    monto, pago: "caballo", ref: `CAB-${id}`,
    nombre: `Apartado ${Math.round(p * 100)}% · ${nombre}`,
    descripcion: `${col(r, "raza") || "Caballo"} · precio publicado ${money(precio)} MXN. El apartado dura 15 días naturales.`,
    meta: {caballo: nombre, caballo_id: col(r, "id"), caballo_slug: id, precio_caballo: String(precio)}
  };
}
async function cargoPotro(body, T) {
  const t = tarifaDe(T, "apartado", "potro_2027"); const monto = (t && t.precio) || 10000;
  return {
    monto, pago: "potro", ref: "POTRO-2027",
    nombre: "Reserva lista de espera · Potros 2027",
    descripcion: "Se abona íntegra al precio del potro.", meta: {}
  };
}
async function cargoEvento(body, T) {
  const tipo = norm(body.evento);
  if (!TIPO_LBL[tipo]) throw new UserError("Tipo de evento no válido.");
  const inv = Math.max(0, Math.round(numv(body.inv)));
  const hx = Math.min(12, Math.max(0, Math.round(numv(body.hx))));
  const iva = body.iva === true || body.iva === "true";
  const fecha = isoDate(body.fecha);
  if (!fecha) throw new UserError("Elige la fecha de tu evento.");
  if (fecha < hoyMX()) throw new UserError("Esa fecha ya pasó.");
  if (fecha > maxFecha()) throw new UserError("Para fechas tan lejanas escríbenos por WhatsApp.");
  if (FEST.festivo(fecha)) throw new UserError(`Esa fecha es día festivo (${FEST.festivo(fecha)}). Escríbenos por WhatsApp para saber si ese día está habilitado.`);
  const fila = T.find(t => t.servicio === "evento" && t.tipo === tipo && inv >= t.min && inv <= t.max);
  if (!fila || !fila.precio) throw new UserError("Este evento requiere cotización personalizada. Escríbenos por WhatsApp.");
  if (AG.AGENDA_URL) {
    const ag = await AG.disponibilidad({fresco: true}).catch(e => { console.error(e); return null; });
    if (!ag) throw new UserError("No pudimos revisar la agenda en este momento. Escríbenos por WhatsApp para apartar tu fecha.");
    if (ag.hasta && fecha > ag.hasta) throw new UserError("Para esa fecha escríbenos por WhatsApp.");
    if (!AG.libre(ag.dias, fecha)) throw new UserError("Esa fecha ya está ocupada o en consulta. Escríbenos por WhatsApp para alternativas.");
  } else if (HOJAS.fechas) {
    const fr = await fetchCSV(HOJAS.fechas);
    const f = (fr || []).find(r => isoDate(col(r, "fecha")) === fecha);
    if (f && norm(col(f, "estatus"))) throw new UserError("Esa fecha ya tiene otra solicitud. Escríbenos por WhatsApp para alternativas.");
  }
  const d = new Date(fecha + "T12:00:00Z"); const wd = d.getUTCDay(), mo = d.getUTCMonth() + 1;
  const dia = wd === 6 ? "sabado" : wd === 5 ? "viernes" : wd === 0 ? "domingo" : "entre_semana";
  const temp = wd === 6 && [10, 11, 12, 3, 4, 5].includes(mo);
  const factor = k => { const t = tarifaDe(T, "factor", k); return t && t.precio ? t.precio : 1; };
  let total = Math.round((fila.precio * factor(dia) * (temp ? factor("temporada_alta") : 1) + hx * (fila.hora_extra || 0)) / 100) * 100;
  if (iva) total = Math.round(total * 1.16);
  const p = fila.anticipo || 0.10;
  const monto = Math.round(total * p);
  const txtFecha = `${d.getUTCDate()} de ${MESES[mo - 1]} de ${d.getUTCFullYear()}`;
  return {
    monto, pago: "evento", ref: `EVT-${fecha}-${tipo}-${inv}`,
    nombre: `Anticipo ${Math.round(p * 100)}% · ${TIPO_LBL[tipo]} · ${txtFecha}`,
    descripcion: `${inv} invitados${hx ? ` · ${hx} h extra` : ""} · estimado ${money(total)} MXN ${iva ? "con IVA" : "+ IVA"}. La fecha se confirma por WhatsApp.`,
    meta: {evento: tipo, fecha, invitados: String(inv), horas_extra: String(hx), factura: iva ? "si" : "no", estimado_total: String(total), total: String(total), resta: String(total - monto)},
    agenda: true
  };
}
const PAQ_LBL = {manana: "Sesión entre semana · mañana", tarde: "Sesión tarde o sábado", produccion: "Producción y marcas"};
async function cargoSesion(body, T) {
  const paquete = norm(body.paquete);
  if (!PAQ_LBL[paquete] || !AG.HORARIOS[paquete]) throw new UserError("Paquete no válido.");
  const fila = tarifaDe(T, "sesion", paquete);
  if (!fila || !fila.precio) throw new UserError("Este paquete se cotiza por WhatsApp.");
  const fecha = isoDate(body.fecha), horario = String(body.horario || "");
  if (!fecha) throw new UserError("Elige la fecha de tu sesión.");
  if (fecha > maxFecha()) throw new UserError("Para fechas tan lejanas escríbenos por WhatsApp.");
  if (FEST.festivo(fecha)) throw new UserError(`Ese día es festivo (${FEST.festivo(fecha)}) y no hay sesiones en línea. Escríbenos por WhatsApp para saber si está habilitado.`);
  if (!AG.HORARIOS[paquete](AG.diaSemana(fecha)).includes(horario)) throw new UserError("Ese horario no está disponible para este paquete.");
  const extra = datosSesion(body, horario);
  const inicio = AG.inicioMX(fecha, AG.SLOTS[horario][0]);
  const horas = (inicio - Date.now()) / 36e5;
  if (horas < AG.MIN_HORAS) throw new UserError(`Las sesiones se reservan con mínimo ${AG.MIN_HORAS} horas de anticipación. Escríbenos por WhatsApp.`);
  if (!AG.AGENDA_URL) throw new UserError("La agenda en línea no está activa. Escríbenos por WhatsApp.");
  const ag = await AG.disponibilidad({fresco: true}).catch(e => { console.error(e); return null; });
  if (!ag) throw new UserError("No pudimos revisar la agenda en este momento. Escríbenos por WhatsApp.");
  if (ag.hasta && fecha > ag.hasta) throw new UserError("Para esa fecha escríbenos por WhatsApp.");
  if (!AG.libre(ag.dias, fecha, horario)) throw new UserError("Ese horario ya está ocupado. Elige otro.");
  const iva = body.iva === true || body.iva === "true";
  let total = fila.precio; if (iva) total = Math.round(total * 1.16);
  const dep = fila.anticipo > 1 ? fila.anticipo : Math.round(total * (fila.anticipo || 0.5));
  const completo = horas < AG.TOTAL_SI_MENOS;
  const monto = completo ? total : Math.min(total, dep);
  const d = new Date(fecha + "T12:00:00Z");
  const txt = `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()} · ${horario.replace("-", ":00 a ")}:00`;
  return {
    monto, pago: "sesion", ref: `SES-${fecha}-${horario}-${paquete}`,
    nombre: `${completo ? "Pago total" : "Anticipo"} · ${PAQ_LBL[paquete]} · ${txt}`,
    descripcion: completo ? `Pago total por reservar con menos de ${AG.TOTAL_SI_MENOS} h. Total ${money(total)} MXN ${iva ? "con IVA" : "+ IVA"}.`
                          : `Total ${money(total)} MXN ${iva ? "con IVA" : "+ IVA"}. El resto (${money(total - monto)}) se paga 2 días antes de la sesión.`,
    meta: {paquete, fecha, horario, factura: iva ? "si" : "no", total: String(total), resta: String(total - monto),
      llegada: extra.llegada, titular: extra.titular, personas: String(extra.acompanantes.length + 1),
      acompanantes: extra.acompanantes.join(" · ").slice(0, 500), cobro_saldo: !completo && total - monto > 0 ? "auto" : ""},
    agenda: true, ine: extra.ine,
    // 1 oct 2026: con anticipo, la tarjeta queda guardada y el resto se cobra solo 2 días antes (api/saldo.js)
    guardarTarjeta: !completo && total - monto > 0,
    aviso: !completo && total - monto > 0 ? `Al pagar autorizas que el resto (${money(total - monto)} MXN) se cobre automáticamente a esta misma tarjeta 2 días antes de tu sesión.` : ""
  };
}

/* Datos de acceso de la sesión: hora de llegada, titular, acompañantes e identificación */
const limpiaNombre = v => String(v || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const nombreOk = n => n.length >= 3 && /\p{L}{2,}/u.test(n);
const INE_MAX = 3 * 1024 * 1024; // 3 MB (la página comprime las fotos; un PDF debe venir ya ligero)
function tipoArchivo(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return {tipo: "image/jpeg", ext: "jpg"};
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return {tipo: "image/png", ext: "png"};
  if (buf.length > 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return {tipo: "image/webp", ext: "webp"};
  if (buf.length > 5 && buf.slice(0, 5).toString("latin1") === "%PDF-") return {tipo: "application/pdf", ext: "pdf"};
  return null;
}
function datosSesion(body, horario) {
  const llegada = String(body.llegada || "");
  if (!(AG.LLEGADAS[horario] || []).includes(llegada)) throw new UserError("Elige tu hora de llegada.");
  const titular = limpiaNombre(body.titular);
  if (!nombreOk(titular)) throw new UserError("Escribe el nombre completo del titular, como aparece en su identificación.");
  const lista = Array.isArray(body.acompanantes) ? body.acompanantes : [];
  if (lista.length > AG.MAX_PERSONAS - 1) throw new UserError(`Máximo ${AG.MAX_PERSONAS} personas en total, contando al titular. Para grupos más grandes escríbenos por WhatsApp.`);
  const acompanantes = lista.map(limpiaNombre);
  if (acompanantes.some(n => !nombreOk(n))) throw new UserError("Escribe el nombre de cada acompañante.");
  if (!(body.ine_ok === true || body.ine_ok === "true")) throw new UserError("Acepta el uso de tu identificación para el control de acceso.");
  const ine = body.ine || {};
  const b64 = String(ine.datos || "").replace(/^data:[^,]*,/, "");
  if (!b64) throw new UserError("Sube la identificación oficial del titular (INE, pasaporte o licencia).");
  if (b64.length > Math.ceil(INE_MAX / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new UserError("La identificación pesa demasiado. Sube una foto o un PDF de menos de 3 MB.");
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 2000) throw new UserError("La identificación no se ve bien. Sube una foto clara o un PDF.");
  const t = tipoArchivo(buf);
  if (!t) throw new UserError("La identificación debe ser foto (JPG, PNG o WEBP) o PDF.");
  return {llegada, titular, acompanantes, ine: {nombre: `identificacion.${t.ext}`, tipo: t.tipo, datos: buf.toString("base64")}};
}
async function expirar(id) {
  try {
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}/expire`, {method: "POST",
      headers: {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Stripe-Version": "2026-08-26.dahlia"}});
  } catch (e) { console.error("No se pudo expirar", id, e); }
}

/* --- Stripe (API directa, sin librerías) --- */
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
  }
  return out.join("&");
}
async function crearSesion(c, origin) {
  const params = {
    mode: "payment",
    integration_identifier: "rancho_web_checkout_qhvnbtzk", // etiqueta para ver este flujo en el Dashboard de Stripe
    locale: "es-419",
    client_reference_id: c.ref.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 200),
    success_url: `${origin}/?pago=${c.pago}&ref={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    phone_number_collection: {enabled: "true"},
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // la liga de pago vence en 30 min (mínimo de Stripe)
    line_items: {0: {quantity: 1, price_data: {currency: "mxn", unit_amount: c.monto * 100,
      product_data: {name: c.nombre.slice(0, 250), description: c.descripcion.slice(0, 500)}}}},
    metadata: {tipo: c.pago, ref: c.ref, ...c.meta},
    // Sesiones y eventos solo con tarjeta: un pago diferido (OXXO) llegaría después de que venza el apartado del horario
    payment_method_types: c.agenda ? {0: "card"} : undefined,
    payment_intent_data: {description: c.nombre.slice(0, 250), metadata: {tipo: c.pago, ref: c.ref, ...c.meta},
      setup_future_usage: c.guardarTarjeta ? "off_session" : undefined},
    // Sesión con anticipo: se crea el cliente en Stripe para guardar la tarjeta y cobrar el resto 2 días antes
    customer_creation: c.guardarTarjeta ? "always" : undefined,
    custom_text: c.aviso ? {submit: {message: c.aviso.slice(0, 1200)}} : undefined
  };
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2026-08-26.dahlia"},
    body: form(params)
  });
  const j = await res.json();
  if (!res.ok) { console.error("Stripe:", j.error); throw new Error((j.error && j.error.message) || "Stripe " + res.status); }
  return {url: j.url, id: j.id};
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  /* Modo de cobro según la llave en Vercel: sk_live_ = cobros reales, sk_test_ = solo pruebas (?prueba en la URL), sin llave = WhatsApp */
  const key = process.env.STRIPE_SECRET_KEY || "";
  const modo = key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : key ? "test" : "off";
  if (req.method === "GET") return res.status(200).json({modo, vendedores: await loadVendedores().catch(() => VENDEDORES_FALLBACK)});
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({error: "Método no permitido."}); }
  if (modo === "off") return res.status(503).json({error: "Pagos en línea aún no configurados.", sinLlave: true});
  const ip = ipDe(req);
  if (demasiados(ip)) return res.status(429).json({error: "Demasiados intentos seguidos. Espera unos minutos o escríbenos por WhatsApp."});
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    // Con llave de prueba nunca mandamos a un cliente real a un cobro de prueba
    if (modo === "test" && body.prueba !== true) return res.status(503).json({error: "Pagos en línea en modo de prueba.", sinLlave: true});
    const T = await loadTarifas();
    const tipo = norm(body.tipo);
    const c = tipo === "caballo" ? await cargoCaballo(body, T)
            : tipo === "potro" ? await cargoPotro(body, T)
            : tipo === "evento" ? await cargoEvento(body, T)
            : tipo === "sesion" ? await cargoSesion(body, T)
            : null;
    if (!c) throw new UserError("Tipo de pago no válido.");
    if (!(c.monto >= 10)) throw new UserError("El monto no es válido. Escríbenos por WhatsApp.");
    c.meta = {...c.meta, ...(await atendioDe(body.atendio)), ip: ipHash(ip)};
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    const origin = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "")
      : /^[a-z0-9-]+\.vercel\.app$/i.test(host) ? `https://${host}` : "https://rancho-el-descanso.vercel.app";
    const {url, id} = await crearSesion(c, origin);
    if (c.agenda && AG.AGENDA_URL) {
      // Aparta el horario en la Agenda mientras paga; si alguien lo ganó en ese instante, cancela la liga
      // Falla cerrado: si la Agenda no responde, no se cobra (se evita apartar dos veces el mismo horario)
      const h = await AG.apartar(id, c.ine ? {ine: c.ine} : undefined).catch(e => { console.error("Agenda apartar:", e); return {ok: false}; });
      // Si mandamos identificación, la Agenda debe confirmar que la guardó (h.ine); si no, no se cobra
      if (!h.ok && h.error === "ine") h.sinIne = true;
      if (h.ok && c.ine && h.ine !== true && !h.repetido) { console.error("Agenda no guardó la identificación:", JSON.stringify(h)); h.ok = false; h.sinIne = true; }
      if (!h.ok) { await expirar(id); throw new UserError(h.conflicto ? "Ese horario se acaba de ocupar. Elige otro."
        : h.festivo ? `Ese día es festivo (${h.festivo}). Escríbenos por WhatsApp para saber si está habilitado.`
        : h.sinIne ? "No pudimos guardar tu identificación. Intenta de nuevo en unos minutos o escríbenos por WhatsApp."
        : h.limite ? "Hay muchas reservas en proceso en este momento. Intenta en unos minutos o escríbenos por WhatsApp."
        : "No pudimos apartar el horario. Escríbenos por WhatsApp."); }
    }
    return res.status(200).json({url, monto: c.monto});
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({error: e.message});
    console.error(e);
    return res.status(500).json({error: "No pudimos abrir el pago. Escríbenos por WhatsApp y te ayudamos."});
  }
};
