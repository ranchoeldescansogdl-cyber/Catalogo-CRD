/* Rancho El Descanso · Stripe avisa aquí cuando se completa un pago.
   1) Lee el cuerpo CRUDO (handler Web: request.arrayBuffer) y verifica la firma de Stripe con
      STRIPE_WEBHOOK_SECRET (whsec_...). Sin secreto no procesa nada (falla cerrado; Stripe reintenta solo).
   2) Pasa el folio del pago al Apps Script de la Maestra, que lo vuelve a confirmar con /api/verificar
      y marca el caballo como Apartado + anota el pago en la pestaña PAGOS WEB.
   Con RANCHO_TOKEN en Vercel, cada llamada a los Apps Script lleva ese token (ellos lo exigen si lo tienen).
   Eventos en Stripe: checkout.session.completed y checkout.session.async_payment_succeeded.
   1 oct 2026: tipo "saldo_sesion" (resto de una sesión pagado con la liga de api/saldo.js) marca el pago original;
   si la hoja no lo acepta no se reintenta.
   30 sep 2026: antes era stripe-webhook.js (req.body ya venía convertido en objeto y la firma no se podía verificar). */
import crypto from "node:crypto";
import AG from "./_agenda.js";
import SALDO from "./saldo.js";

const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbznKKk_OWX00_w2SF4_bitIeuE_YsSQ29eu3TnmzhcrR-w3qDMsMXdS2Q7UmSX_Zj-H/exec";
const TOLERANCIA_SEG = 300;
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}});

/* Firma de Stripe: header "t=...,v1=...,v1=..." ; v1 = HMAC-SHA256(secreto, "t.cuerpo") */
function firmaValida(raw, header, secreto) {
  if (!header) return false;
  let t = null; const v1 = [];
  for (const p of String(header).split(",")) {
    const i = p.indexOf("="); if (i < 0) continue;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (k === "t") t = v; else if (k === "v1" && v) v1.push(v);
  }
  if (!t || !v1.length || !(Math.abs(Date.now() / 1000 - Number(t)) <= TOLERANCIA_SEG)) return false;
  const esperado = Buffer.from(crypto.createHmac("sha256", secreto).update(t + "." + raw.toString("utf8")).digest("hex"));
  return v1.some(f => { const b = Buffer.from(f); return b.length === esperado.length && crypto.timingSafeEqual(b, esperado); });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") return json({error: "Método no permitido."}, 405);
    const raw = Buffer.from(await request.arrayBuffer());
    const secreto = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secreto) { console.error("Falta STRIPE_WEBHOOK_SECRET en Vercel: no se procesa el aviso"); return json({error: "webhook sin configurar"}, 500); }
    if (!firmaValida(raw, request.headers.get("stripe-signature"), secreto)) return json({error: "Firma de Stripe no válida"}, 400);
    let ev = {};
    try { ev = JSON.parse(raw.toString("utf8") || "{}"); } catch (e) { return json({error: "JSON no válido"}, 400); }
    const tipos = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
    const obj = ev.data && ev.data.object;
    if (!tipos.includes(ev.type) || !obj || !/^cs_/.test(obj.id || "")) return json({ignorado: ev.type || true});
    if (obj.payment_status && obj.payment_status === "unpaid") return json({pendiente: true}); // OXXO/transferencia: llega luego como async_payment_succeeded
    // Sesiones y eventos: la Agenda (Google Calendar) convierte el apartado en cita y avisa por correo.
    // Si falla no detiene lo demás: el Apps Script de la Agenda reintenta solo cada 15 min.
    const tipoPago = (obj.metadata && obj.metadata.tipo) || "";
    // 1 oct 2026: el cliente pagó el resto de su sesión con la liga → se marca el pago original en Stripe;
    // el Apps Script de la Agenda lo detecta en su siguiente revisión y marca la cita como "Saldo pagado"
    if (tipoPago === "saldo_sesion") {
      try { const r = await SALDO.registrarPagoLiga(obj.id); if (!r.ok) console.error("Saldo liga: no se pudo registrar", obj.id); }
      catch (e) { console.error("Saldo liga:", e); }
    }
    if (tipoPago === "sesion" || tipoPago === "evento") {
      try { const a = await AG.confirmar(obj.id); if (!a.ok) console.error("Agenda:", JSON.stringify(a)); }
      catch (e) { console.error("Agenda confirmar:", e); }
    }
    try {
      const r = await fetch(SHEETS_URL, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({session_id: obj.id, token: process.env.RANCHO_TOKEN || undefined}), redirect: "follow"});
      const txt = await r.text();
      let j = {}; try { j = JSON.parse(txt); } catch (e) {}
      if (!r.ok || j.ok === false) {
        console.error("Hoja:", r.status, txt.slice(0, 300));
        if (tipoPago === "saldo_sesion") return json({ok: true, hoja: false}); // el resto ya quedó en Stripe y en la Agenda
        return json({error: "hoja"}, 500);
      }
      return json({ok: true});
    } catch (e) {
      console.error(e);
      return json({error: "No se pudo avisar a la hoja"}, 500); // Stripe reintenta solo
    }
  }
};
