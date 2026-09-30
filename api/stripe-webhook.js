/* Rancho El Descanso · Stripe avisa aquí cuando se completa un pago.
   1) Verifica la firma de Stripe (STRIPE_WEBHOOK_SECRET en Vercel, empieza con whsec_).
   2) Pasa el folio del pago al Apps Script de la Maestra, que lo vuelve a confirmar con /api/verificar
      y marca el caballo como Apartado + anota el pago en la pestaña PAGOS WEB.
   Eventos en Stripe: checkout.session.completed y checkout.session.async_payment_succeeded. */
const crypto = require("crypto");
const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbznKKk_OWX00_w2SF4_bitIeuE_YsSQ29eu3TnmzhcrR-w3qDMsMXdS2Q7UmSX_Zj-H/exec";
const TOLERANCIA_SEG = 300;

async function cuerpoCrudo(req) {
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (Buffer.isBuffer(req.body)) return req.body;
  const partes = [];
  for await (const c of req) partes.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(partes);
}

/* Firma de Stripe: header "t=...,v1=...,v1=..." ; v1 = HMAC-SHA256(secreto, "t.cuerpo") */
function firmaValida(raw, header, secreto) {
  if (!header) return false;
  let t = null; const v1 = [];
  for (const p of String(header).split(",")) {
    const [k, v] = p.split("=");
    if (k === "t") t = v; else if (k === "v1" && v) v1.push(v);
  }
  if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCIA_SEG) return false;
  const esperado = Buffer.from(crypto.createHmac("sha256", secreto).update(t + "." + raw.toString("utf8")).digest("hex"));
  return v1.some(f => { const b = Buffer.from(f); return b.length === esperado.length && crypto.timingSafeEqual(b, esperado); });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({error: "Método no permitido."});
  const raw = await cuerpoCrudo(req);
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (secreto) {
    if (!firmaValida(raw, req.headers["stripe-signature"], secreto)) return res.status(400).json({error: "Firma de Stripe no válida"});
  } else {
    console.warn("STRIPE_WEBHOOK_SECRET no configurado: sin verificar firma (el pago igual se reconfirma con Stripe en /api/verificar)");
  }
  let ev = {};
  try { ev = JSON.parse(raw.toString("utf8") || "{}"); } catch (e) { return res.status(400).json({error: "JSON no válido"}); }
  const tipos = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  const obj = ev.data && ev.data.object;
  if (!tipos.includes(ev.type) || !obj || !/^cs_/.test(obj.id || "")) return res.status(200).json({ignorado: ev.type || true});
  if (obj.payment_status && obj.payment_status === "unpaid") return res.status(200).json({pendiente: true}); // OXXO/transferencia: llega luego como async_payment_succeeded
  // Sesiones y eventos: la Agenda (Google Calendar) convierte el apartado en cita y avisa por correo.
  // Si falla no detiene lo demás: el Apps Script de la Agenda reintenta solo cada 15 min.
  const tipoPago = (obj.metadata && obj.metadata.tipo) || "";
  if (tipoPago === "sesion" || tipoPago === "evento") {
    try { const a = await require("./_agenda").confirmar(obj.id); if (!a.ok) console.error("Agenda:", JSON.stringify(a)); }
    catch (e) { console.error("Agenda confirmar:", e); }
  }
  try {
    const r = await fetch(SHEETS_URL, {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({session_id: obj.id}), redirect: "follow"});
    const txt = await r.text();
    let j = {}; try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok || j.ok === false) { console.error("Hoja:", r.status, txt.slice(0, 300)); return res.status(500).json({error: "hoja", detalle: j.error || r.status}); }
    return res.status(200).json({ok: true, hoja: j});
  } catch (e) {
    console.error(e);
    return res.status(500).json({error: "No se pudo avisar a la hoja"}); // Stripe reintenta solo
  }
};
