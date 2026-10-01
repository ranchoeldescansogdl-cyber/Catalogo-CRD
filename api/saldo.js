/* Rancho El Descanso · cobro del resto de las sesiones de fotos (1 oct 2026).
   Al apartar, /api/checkout guarda la tarjeta en Stripe (setup_future_usage = off_session) con el aviso de que
   el resto se cobra a esa misma tarjeta 2 días antes de la sesión.

   POST /api/saldo  {accion:"cobrar", session_id:"cs_..."}   (header x-rancho-token; lo llama el Apps Script de la Agenda)
     → cobra el resto a la tarjeta guardada. Responde {ok:true, monto, pi} | {ok:true, yaPagado:true}
       | {ok:false, motivo, mensaje, liga}. Nunca cobra dos veces: marca el pago original (saldo_estado=pagado)
       y usa una llave de idempotencia por día.
   POST /api/saldo  {accion:"estado", session_id:"cs_..."} (con token) → {pagado} o {pagado:false, monto, liga} sin cobrar.
   POST /api/saldo  {accion:"liga", session_id:"cs_..."}   (con token) → {liga} para mandarla al cliente.
   GET  /api/saldo?s=cs_...&f=<firma>   (la liga que recibe el cliente; no caduca)
     → abre un pago de Stripe por el resto, o avisa que ya está pagado.

   El monto SIEMPRE sale de Stripe (metadata "resta" del pago original); nada de lo que manden se usa como monto. */
const crypto = require("crypto");

const API = "https://api.stripe.com/v1/";
const VERSION = "2026-08-26.dahlia";
const SITIO = () => (process.env.SITE_URL || "https://rancho-el-descanso.vercel.app").replace(/\/$/, "");
const money = n => "$" + Math.round(n).toLocaleString("es-MX");
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function tokenOk(req, body) {
  const t = process.env.RANCHO_TOKEN;
  if (!t) return false; // cobrar exige token siempre (falla cerrado)
  const a = Buffer.from(String(req.headers["x-rancho-token"] || (body && body.token) || "")), b = Buffer.from(t);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/* Firma de la liga del cliente: solo quien tiene la liga puede abrir el pago de ESA sesión */
const secreto = () => crypto.createHash("sha256").update("saldo|" + (process.env.RANCHO_TOKEN || process.env.STRIPE_SECRET_KEY || "")).digest();
const firma = id => crypto.createHmac("sha256", secreto()).update(id).digest("base64url").slice(0, 22);
function firmaOk(id, f) {
  const a = Buffer.from(String(f || "")), b = Buffer.from(firma(id));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const ligaDe = id => `${SITIO()}/api/saldo?s=${id}&f=${firma(id)}`;

function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
  }
  return out.join("&");
}
async function stripe(metodo, ruta, datos, idem) {
  const headers = {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Stripe-Version": VERSION};
  if (datos) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idem) headers["Idempotency-Key"] = idem;
  const r = await fetch(API + ruta, {method: metodo, headers, body: datos ? form(datos) : undefined});
  const j = await r.json();
  return {ok: r.ok, status: r.status, j};
}

/* Lee la sesión de pago original (el anticipo) y lo que falta por pagar */
async function original(id) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return {error: "id no válido"};
  const r = await stripe("GET", `checkout/sessions/${id}?expand[]=payment_intent`);
  if (!r.ok) return {error: "no encontrado"};
  const s = r.j, m = s.metadata || {}, pi = s.payment_intent && typeof s.payment_intent === "object" ? s.payment_intent : null;
  if (m.tipo !== "sesion") return {error: "no es sesión"};
  if (s.payment_status !== "paid" || !pi) return {error: "anticipo sin pagar"};
  const resta = Math.round(Number(m.resta) || 0);
  const pm = pi.payment_method && (typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method.id);
  const customer = (typeof s.customer === "string" ? s.customer : s.customer && s.customer.id) ||
                   (typeof pi.customer === "string" ? pi.customer : pi.customer && pi.customer.id) || "";
  const c = s.customer_details || {};
  return {s, m, pi, resta, pm, customer, pagado: (pi.metadata || {}).saldo_estado === "pagado",
    nombre: c.name || "", email: c.email || "", telefono: c.phone || ""};
}
function txtSesion(m) {
  const d = new Date((m.fecha || "") + "T12:00:00Z");
  const f = isNaN(d) ? m.fecha : `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
  return `${f}${m.horario ? " · " + m.horario.replace("-", ":00 a ") + ":00" : ""}`;
}
/* Marca el pago original como liquidado: así nunca se vuelve a cobrar */
async function marcarPagado(o, piSaldo, via) {
  const r = await stripe("POST", `payment_intents/${o.pi.id}`,
    {metadata: {saldo_estado: "pagado", saldo_pi: piSaldo, saldo_via: via, saldo_fecha: new Date().toISOString().slice(0, 10)}});
  if (!r.ok) console.error("No se pudo marcar el saldo como pagado:", o.s.id, JSON.stringify(r.j.error || {}));
}
/* ¿Ya hay un pago del resto exitoso? (por si se pagó con la liga y el webhook aún no lo marca) */
async function saldoExistente(id) {
  const q = `metadata['saldo_de']:'${id}' AND status:'succeeded'`;
  const r = await stripe("GET", "payment_intents/search?query=" + encodeURIComponent(q) + "&limit=1");
  return r.ok && r.j.data && r.j.data[0] ? r.j.data[0] : null;
}

async function cobrar(id) {
  const o = await original(id);
  if (o.error) return {ok: false, motivo: "no_valido", mensaje: o.error};
  if (!(o.resta > 0)) return {ok: true, yaPagado: true, sinSaldo: true};
  if (o.pagado) return {ok: true, yaPagado: true, pi: (o.pi.metadata || {}).saldo_pi || ""};
  const previo = await saldoExistente(id);
  if (previo) { await marcarPagado(o, previo.id, "previo"); return {ok: true, yaPagado: true, pi: previo.id}; }
  const base = {monto: o.resta, cliente: o.nombre, email: o.email, telefono: o.telefono, sesion: txtSesion(o.m), liga: ligaDe(id)};
  if (!o.pm || !o.customer) return {ok: false, motivo: "sin_tarjeta", mensaje: "El cliente apartó sin tarjeta guardada.", ...base};
  const hoy = new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10);
  const r = await stripe("POST", "payment_intents", {
    amount: o.resta * 100, currency: "mxn", customer: o.customer, payment_method: o.pm,
    off_session: "true", confirm: "true", payment_method_types: {0: "card"},
    description: `Resto · Sesión ${txtSesion(o.m)}`.slice(0, 250),
    metadata: {tipo: "saldo_sesion", saldo_de: id, ref: o.m.ref || "", fecha: o.m.fecha || "", horario: o.m.horario || "", paquete: o.m.paquete || "", atendio: o.m.atendio || "", atendio_clave: o.m.atendio_clave || ""}
  }, `saldo-${id}-${hoy}`);
  const pi = r.ok ? r.j : (r.j.error && r.j.error.payment_intent) || null;
  if (r.ok && pi && pi.status === "succeeded") {
    await marcarPagado(o, pi.id, "automatico");
    return {ok: true, ...base, pi: pi.id};
  }
  const e = r.j.error || {};
  const motivo = e.code === "authentication_required" || (pi && pi.status === "requires_action") ? "requiere_autenticacion"
    : e.decline_code || e.code || (pi && pi.status) || "error";
  console.error("Cobro del saldo falló:", id, motivo, e.message || "");
  return {ok: false, motivo, mensaje: e.message || "El banco no aprobó el cargo.", ...base};
}

/* Liga del cliente: crea al momento un pago de Stripe por el resto */
async function abrirPago(id, res) {
  const o = await original(id);
  const volver = msg => { res.statusCode = 303; res.setHeader("Location", `${SITIO()}/?saldo=${msg}`); return res.end(); };
  if (o.error) return volver("no-valido");
  if (!(o.resta > 0) || o.pagado || await saldoExistente(id)) return volver("pagado");
  const params = {
    mode: "payment", locale: "es-419",
    client_reference_id: ("SALDO-" + (o.m.ref || id)).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 200),
    success_url: `${SITIO()}/?pago=saldo&ref={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITIO()}/`,
    customer: o.customer || undefined,
    customer_email: o.customer ? undefined : (o.email || undefined),
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    payment_method_types: {0: "card"},
    line_items: {0: {quantity: 1, price_data: {currency: "mxn", unit_amount: o.resta * 100,
      product_data: {name: `Resto · Sesión ${txtSesion(o.m)}`.slice(0, 250),
        description: `Total ${money(Number(o.m.total) || 0)} MXN. Anticipo ya pagado; este es el resto de tu sesión en Rancho El Descanso.`}}}},
    metadata: {tipo: "saldo_sesion", saldo_de: id, ref: o.m.ref || "", fecha: o.m.fecha || "", horario: o.m.horario || "", paquete: o.m.paquete || "", atendio: o.m.atendio || "", atendio_clave: o.m.atendio_clave || ""},
    payment_intent_data: {description: `Resto · Sesión ${txtSesion(o.m)}`.slice(0, 250),
      metadata: {tipo: "saldo_sesion", saldo_de: id, ref: o.m.ref || "", fecha: o.m.fecha || "", atendio: o.m.atendio || "", atendio_clave: o.m.atendio_clave || ""}}
  };
  const r = await stripe("POST", "checkout/sessions", params);
  if (!r.ok) { console.error("Stripe liga saldo:", JSON.stringify(r.j.error || {})); return volver("error"); }
  res.statusCode = 303; res.setHeader("Location", r.j.url); return res.end();
}

/* El webhook avisa que se pagó el resto con la liga: marca el pago original */
async function registrarPagoLiga(csSaldo) {
  const r = await stripe("GET", `checkout/sessions/${csSaldo}?expand[]=payment_intent`);
  if (!r.ok) return {ok: false};
  const s = r.j, m = s.metadata || {};
  if (m.tipo !== "saldo_sesion" || s.payment_status !== "paid" || !m.saldo_de) return {ok: false};
  const o = await original(m.saldo_de);
  if (o.error) return {ok: false};
  if (!o.pagado) await marcarPagado(o, typeof s.payment_intent === "object" ? s.payment_intent.id : String(s.payment_intent || ""), "liga");
  return {ok: true, saldo_de: m.saldo_de, monto: (s.amount_total || 0) / 100};
}

/* ¿Ya se pagó el resto? (sin cobrar nada). La Agenda lo pregunta cada hora mientras el resto siga pendiente */
async function estado(id) {
  const o = await original(id);
  if (o.error) return {ok: false, motivo: "no_valido", mensaje: o.error};
  if (!(o.resta > 0) || o.pagado) return {ok: true, pagado: true, pi: (o.pi.metadata || {}).saldo_pi || ""};
  const previo = await saldoExistente(id);
  if (previo) { await marcarPagado(o, previo.id, "liga"); return {ok: true, pagado: true, pi: previo.id}; }
  return {ok: true, pagado: false, monto: o.resta, liga: ligaDe(id), tarjeta: !!(o.pm && o.customer)};
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({error: "sin llave"});
  try {
    if (req.method === "GET") {
      const id = String((req.query && req.query.s) || "");
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id) || !firmaOk(id, req.query && req.query.f)) {
        res.statusCode = 303; res.setHeader("Location", `${SITIO()}/?saldo=no-valido`); return res.end();
      }
      return await abrirPago(id, res);
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({error: "Método no permitido."}); }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!tokenOk(req, body)) return res.status(401).json({error: "no autorizado"});
    const id = String(body.session_id || "");
    if (body.accion === "cobrar") return res.status(200).json(await cobrar(id));
    if (body.accion === "liga") {
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({error: "id no válido"});
      return res.status(200).json({ok: true, liga: ligaDe(id)});
    }
    if (body.accion === "estado") return res.status(200).json(await estado(id));
    return res.status(400).json({error: "acción no válida"});
  } catch (e) {
    console.error(e);
    return res.status(500).json({ok: false, motivo: "error", mensaje: "Error interno al cobrar el saldo."});
  }
};
module.exports.registrarPagoLiga = registrarPagoLiga;
