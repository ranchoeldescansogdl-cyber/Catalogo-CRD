/* Rancho El Descanso · Stripe avisa aquí cuando se completa un pago.
   Pasa el folio del pago al Apps Script de la Maestra, que lo confirma con /api/verificar
   y marca el caballo como Apartado + anota el pago en la pestaña PAGOS WEB.
   Eventos en Stripe: checkout.session.completed y checkout.session.async_payment_succeeded. */
const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbznKKk_OWX00_w2SF4_bitIeuE_YsSQ29eu3TnmzhcrR-w3qDMsMXdS2Q7UmSX_Zj-H/exec";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({error: "Método no permitido."});
  const ev = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const tipos = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  const obj = ev.data && ev.data.object;
  if (!tipos.includes(ev.type) || !obj || !/^cs_/.test(obj.id || "")) return res.status(200).json({ignorado: ev.type || true});
  if (obj.payment_status && obj.payment_status !== "paid") return res.status(200).json({pendiente: true}); // OXXO/transferencia: llega luego como async_payment_succeeded
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
