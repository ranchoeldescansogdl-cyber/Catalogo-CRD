/* Rancho El Descanso · crea el pago en Stripe Checkout.
   La llave secreta vive SOLO en Vercel (Settings > Environment Variables > STRIPE_SECRET_KEY).
   El monto SIEMPRE se calcula aquí con los precios de la hoja; lo que mande el navegador no se usa como monto.

   POST /api/checkout
     {tipo:"caballo", id:"<id del caballo en la página>"}
     {tipo:"potro"}
     {tipo:"evento", evento:"boda|xv|social|corporativo", inv:120, hx:1, iva:true, fecha:"2026-11-14"}
   Responde {url} (página de pago de Stripe) o {error}. */

const HOJAS = {
  catalogo: "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6AirAw8dafLnUa6ND6FuI4VhqRGK-8MyJykM0Z3I1Z9jiOecwAN4VYyi9lGMZweuf3w-LLSx7KKC-/pub?gid=217518953&single=true&output=csv",
  tarifas: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRB8_wzp7c5W-OLs1YFFBOiRt_oZ2rF0aHFIOxfKPxHYnICNrDL6UW78rzFp49r-6L08MyMNiRSMq8h/pub?gid=1137766291&single=true&output=csv",
  fechas: "" // pestaña FECHAS WEB publicada como CSV (igual que en index.html). Vacío = no revisa disponibilidad
};

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
  ["apartado","caballo_en_venta","","",0,"","",0.1],["apartado","potro_2027","","",10000]
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
  const t = tarifaDe(T, "apartado", "caballo_en_venta"); const p = (t && t.anticipo) || 0.10;
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
  const fila = T.find(t => t.servicio === "evento" && t.tipo === tipo && inv >= t.min && inv <= t.max);
  if (!fila || !fila.precio) throw new UserError("Este evento requiere cotización personalizada. Escríbenos por WhatsApp.");
  if (HOJAS.fechas) {
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
    meta: {evento: tipo, fecha, invitados: String(inv), horas_extra: String(hx), factura: iva ? "si" : "no", estimado_total: String(total)}
  };
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
    locale: "es-419",
    client_reference_id: c.ref.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 200),
    success_url: `${origin}/?pago=${c.pago}&ref={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    phone_number_collection: {enabled: "true"},
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // la liga de pago vence en 30 min (mínimo de Stripe)
    line_items: {0: {quantity: 1, price_data: {currency: "mxn", unit_amount: c.monto * 100,
      product_data: {name: c.nombre.slice(0, 250), description: c.descripcion.slice(0, 500)}}}},
    metadata: {tipo: c.pago, ref: c.ref, ...c.meta},
    payment_intent_data: {description: c.nombre.slice(0, 250), metadata: {tipo: c.pago, ref: c.ref, ...c.meta}}
  };
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded"},
    body: form(params)
  });
  const j = await res.json();
  if (!res.ok) { console.error("Stripe:", j.error); throw new Error((j.error && j.error.message) || "Stripe " + res.status); }
  return j.url;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({error: "Método no permitido."}); }
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({error: "Pagos en línea aún no configurados.", sinLlave: true});
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const T = await loadTarifas();
    const tipo = norm(body.tipo);
    const c = tipo === "caballo" ? await cargoCaballo(body, T)
            : tipo === "potro" ? await cargoPotro(body, T)
            : tipo === "evento" ? await cargoEvento(body, T)
            : null;
    if (!c) throw new UserError("Tipo de pago no válido.");
    if (!(c.monto >= 10)) throw new UserError("El monto no es válido. Escríbenos por WhatsApp.");
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/$/, "") : `https://${host}`;
    const url = await crearSesion(c, origin);
    return res.status(200).json({url, monto: c.monto});
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({error: e.message});
    console.error(e);
    return res.status(500).json({error: "No pudimos abrir el pago. Escríbenos por WhatsApp y te ayudamos."});
  }
};
