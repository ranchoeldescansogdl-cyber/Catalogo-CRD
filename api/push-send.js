/* Manda un aviso a una lista de celulares. Lo llama solo el script "Avisos App CRD" de la hoja Maestra.
   POST (header x-avisos-secreto) {aviso:{title, body, url, tag}, subs:[{endpoint, p256dh, auth}]}
   → {enviados, fallidos, bajas:[endpoints que ya no existen]} para que el script los borre. */
const W = require("./_webpush");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({error: "Método no permitido."}); }
  const secreto = process.env.AVISOS_SECRET || "";
  if (!secreto || req.headers["x-avisos-secreto"] !== secreto) return res.status(401).json({error: "No autorizado."});
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return res.status(503).json({error: "Faltan llaves VAPID."});
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const a = body.aviso || {}, subs = Array.isArray(body.subs) ? body.subs.slice(0, 500) : [];
    if (!a.title) return res.status(400).json({error: "Falta el título."});
    const data = {title: String(a.title).slice(0, 80), body: String(a.body || "").slice(0, 180),
      url: String(a.url || "/?app=1").slice(0, 300), tag: String(a.tag || "").slice(0, 60)};
    let enviados = 0, fallidos = 0; const bajas = [];
    for (let i = 0; i < subs.length; i += 25) {           // de 25 en 25 para no saturar
      const lote = await Promise.all(subs.slice(i, i + 25).map(s => W.send(s, data)));
      lote.forEach((r, j) => { if (r.ok) enviados++; else { fallidos++; if (r.gone) bajas.push(subs[i + j].endpoint); } });
    }
    return res.status(200).json({ok: true, enviados, fallidos, bajas});
  } catch (e) { console.error(e); return res.status(500).json({error: "Error interno."}); }
};
