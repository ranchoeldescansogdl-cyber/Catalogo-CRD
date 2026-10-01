/* Rancho El Descanso · confirma con Stripe un pago de la página.
   GET /api/verificar?id=cs_...  →  datos del pago tal como los tiene Stripe (no confía en nada de quien pregunta).
   Lo usan los Apps Script de la Maestra (Pagos web) y de la Agenda.
   Con RANCHO_TOKEN en Vercel exige el header x-rancho-token (trae datos del cliente: nombre, correo, teléfono). */
const crypto = require("crypto");
function tokenOk(req) {
  const t = process.env.RANCHO_TOKEN;
  if (!t) return true; // aún sin configurar
  const a = Buffer.from(String(req.headers["x-rancho-token"] || "")), b = Buffer.from(t);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!tokenOk(req)) return res.status(401).json({error: "no autorizado"});
  const id = String((req.query && req.query.id) || "");
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({error: "id no válido"});
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({error: "sin llave"});
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + id, {
    headers: {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY, "Stripe-Version": "2026-08-26.dahlia"}
  });
  const s = await r.json();
  if (!r.ok) return res.status(404).json({error: "no encontrado"});
  const m = s.metadata || {}, c = s.customer_details || {};
  return res.status(200).json({
    id: s.id,
    paid: s.payment_status === "paid",
    modo: s.livemode ? "real" : "prueba",
    tipo: m.tipo || "",
    ref: m.ref || s.client_reference_id || "",
    caballo: m.caballo || "",
    caballo_id: m.caballo_id || "",
    caballo_slug: m.caballo_slug || "",
    evento: m.evento || "", fecha: m.fecha || "", invitados: m.invitados || "",
    paquete: m.paquete || "", horario: m.horario || "",
    llegada: m.llegada || "", titular: m.titular || "", personas: m.personas || "", acompanantes: m.acompanantes || "",
    total: m.total || m.estimado_total || "", resta: m.resta || "",
    saldo_de: m.saldo_de || "", cobro_saldo: m.cobro_saldo || "",
    atendio: m.atendio || "", atendio_clave: m.atendio_clave || "",
    estado: s.status || "", vence: s.expires_at || null,
    monto: (s.amount_total || 0) / 100,
    moneda: String(s.currency || "").toUpperCase(),
    nombre: c.name || "", email: c.email || "", telefono: c.phone || "",
    creado: s.created,
    ip: m.ip || ""
  });
};
