/* Rancho El Descanso · cotizaciones de eventos de la página (2 oct 2026).
   POST /api/prospecto {nombre, telefono, correo, tipo, invitados, fecha, hx, iva, total, anticipo, paso, atendio, web}
   Guarda la cotización como "Borrador" en la pestaña PROSPECTOS de la Maestra (vía el Apps Script de la Agenda)
   para darle seguimiento en el portal del equipo (#cotizaciones). Mismo teléfono en 30 días = misma fila actualizada. */
const AG = require("./_agenda");
const intentos = new Map();
const corto = (x, n) => String(x == null ? "" : x).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({error: "Método no permitido."});
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (b.web) return res.status(200).json({ok: true}); // campo trampa: lo llenan los robots, no las personas
    const ip = String(req.headers["x-real-ip"] || "").trim(), ahora = Date.now();
    const l = (intentos.get(ip) || []).filter(t => ahora - t < 10 * 60e3); l.push(ahora); intentos.set(ip, l);
    if (l.length > 12) return res.status(429).json({error: "Demasiados intentos. Escríbenos por WhatsApp."});
    const tel = String(b.telefono || "").replace(/\D/g, "");
    const nombre = corto(b.nombre, 80);
    if (nombre.length < 2) return res.status(400).json({error: "Escribe tu nombre."});
    if (tel.length < 10 || tel.length > 13) return res.status(400).json({error: "Escribe tu WhatsApp a 10 dígitos."});
    const correo = corto(b.correo, 80);
    if (correo && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(correo)) return res.status(400).json({error: "Revisa tu correo (o déjalo vacío)."});
    const p = {nombre, telefono: tel, correo, tipo: corto(b.tipo, 40), invitados: Math.max(0, Math.min(5000, Number(b.invitados) || 0)),
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha || "")) ? b.fecha : "", hx: Math.max(0, Math.min(10, Number(b.hx) || 0)), iva: !!b.iva,
      total: Math.max(0, Number(b.total) || 0), anticipo: Math.max(0, Number(b.anticipo) || 0), paso: corto(b.paso, 60), atendio: corto(b.atendio, 60)};
    if (!AG.AGENDA_URL || !process.env.RANCHO_TOKEN) return res.status(200).json({ok: true, guardado: false});
    const r = await fetch(AG.AGENDA_URL, {method: "POST", headers: {"Content-Type": "application/json"}, redirect: "follow",
      body: JSON.stringify({accion: "panel_prospecto", token: process.env.RANCHO_TOKEN, p})});
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.error("Prospecto:", j.error || r.status);
    return res.status(200).json({ok: true, guardado: !!j.ok});
  } catch (e) {
    console.error(e);
    return res.status(200).json({ok: true, guardado: false}); // nunca le bloqueamos la cotización al cliente
  }
};
