/* Avisos de la app: suscribir y dar de baja celulares.
   GET  → llave pública para que el navegador se suscriba.
   POST {accion:"suscribir"|"baja", subscription, dispositivo} → se guarda en la hoja Maestra
        (pestaña APP SUSCRIPTORES) a través del script "Avisos App CRD" (AVISOS_URL). */
const AVISOS_URL = process.env.AVISOS_URL || "";
const SECRETO = process.env.AVISOS_SECRET || "";

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const listo = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && AVISOS_URL && SECRETO);
  if (req.method === "GET") return res.status(200).json({activa: listo, publicKey: listo ? process.env.VAPID_PUBLIC_KEY : ""});
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({error: "Método no permitido."}); }
  if (!listo) return res.status(503).json({error: "Avisos aún no configurados."});
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const accion = body.accion === "baja" ? "baja" : "suscribir";
    const s = body.subscription || {}, k = s.keys || {};
    if (!/^https:\/\/[^\s]{10,900}$/.test(String(s.endpoint || ""))) return res.status(400).json({error: "Suscripción inválida."});
    if (accion === "suscribir" && !(/^[\w-]{80,100}$/.test(k.p256dh || "") && /^[\w-]{16,30}$/.test(k.auth || "")))
      return res.status(400).json({error: "Llaves inválidas."});
    const r = await fetch(AVISOS_URL, {method: "POST", headers: {"Content-Type": "application/json"}, redirect: "follow",
      body: JSON.stringify({secreto: SECRETO, accion, endpoint: s.endpoint, p256dh: k.p256dh || "", auth: k.auth || "",
        dispositivo: String(body.dispositivo || "").slice(0, 60)})});
    const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (e) { j = {ok: false, error: txt.slice(0, 200)}; }
    if (!j.ok) { console.error("Avisos:", j.error); return res.status(502).json({error: "No se pudo guardar."}); }
    return res.status(200).json({ok: true});
  } catch (e) { console.error(e); return res.status(500).json({error: "Error interno."}); }
};
