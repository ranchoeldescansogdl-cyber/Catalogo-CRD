/* Rancho El Descanso · confirma con Stripe un pago de la página.
   GET /api/verificar?id=cs_...  →  datos del pago tal como los tiene Stripe (no confía en nada de quien pregunta).
   Lo usa el Apps Script de la Maestra antes de marcar un caballo como Apartado. */
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = String((req.query && req.query.id) || "");
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({error: "id no válido"});
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({error: "sin llave"});
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + id, {
    headers: {Authorization: "Bearer " + process.env.STRIPE_SECRET_KEY}
  });
  const s = await r.json();
  if (!r.ok) return res.status(404).json({error: (s.error && s.error.message) || "no encontrado"});
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
    monto: (s.amount_total || 0) / 100,
    moneda: String(s.currency || "").toUpperCase(),
    nombre: c.name || "", email: c.email || "", telefono: c.phone || "",
    creado: s.created
  });
};
