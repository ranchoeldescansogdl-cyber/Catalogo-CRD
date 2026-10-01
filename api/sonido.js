/* Rancho El Descanso · sonidos de la experiencia (música y caballos).
   GET /api/sonido?s=musica              → el archivo completo (acepta Range, para <audio> en iPhone)
   GET /api/sonido?s=trote&desde=12&largo=14  → un pedazo de N segundos, listo para el navegador
   Los sonidos vienen de Freesound (licencias CC0 y CC BY, uso comercial permitido; créditos en la página).
   Se sirven desde el dominio del rancho para que el navegador pueda mezclarlos, y Vercel los guarda en caché. */
const SONIDOS = {
  // Música: "Calm Acoustic Guitar for Serene Moments" · Gustavo_Alivera · CC BY 4.0
  musica:    { url: "https://cdn.freesound.org/previews/761/761373_16024318-hq.mp3", seg: 240.1 },
  // Relinchos
  relincho1: { url: "https://cdn.freesound.org/previews/419/419231_5121236-hq.mp3", seg: 2.74 },  // InspectorJ · CC BY 4.0
  relincho2: { url: "https://cdn.freesound.org/previews/777/777763_15895934-hq.mp3", seg: 2.32 }, // TheKingOfGeeks360 · CC0
  relincho3: { url: "https://cdn.freesound.org/previews/839/839525_15895934-hq.mp3", seg: 5.36 }, // TheKingOfGeeks360 · CC0
  // Caballeriza: relinchos suaves y resoplidos con aves
  establo:   { url: "https://cdn.freesound.org/previews/322/322443_5033007-hq.mp3", seg: 46.2 },  // GoodListener · CC BY 4.0
  resoplido: { url: "https://cdn.freesound.org/previews/392/392307_8043-hq.mp3", seg: 2.19 },     // dobroide · CC BY 4.0
  // Cascos
  paso:      { url: "https://cdn.freesound.org/previews/369/369538_4415905-hq.mp3", seg: 90.4 },  // YleArkisto · CC BY 4.0
  trote:     { url: "https://cdn.freesound.org/previews/369/369533_4415905-hq.mp3", seg: 74.4 },  // YleArkisto · CC BY 4.0
  galope:    { url: "https://cdn.freesound.org/previews/321/321951_3554699-hq.mp3", seg: 4.09 }   // n_audioman · CC BY 4.0
};
const MAX = 2 * 1024 * 1024; // máximo por respuesta (Vercel limita el tamaño)
const tam = {};              // tamaño de cada archivo (se recuerda mientras la función siga viva)

async function tamano(url) {
  if (tam[url]) return tam[url];
  const r = await fetch(url, { method: "HEAD" });
  const n = +r.headers.get("content-length") || 0;
  if (n) tam[url] = n;
  return n;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const s = SONIDOS[String(q.s || "")];
  if (!s) return res.status(404).json({ error: "sonido no encontrado" });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "audio/mpeg");
  try {
    const total = await tamano(s.url);
    let a = 0, b = total ? total - 1 : 0, parcial = false;

    if (q.desde != null && total) {               // pedazo de N segundos
      const bps = total / s.seg;
      const desde = Math.max(0, Math.min(s.seg - 1, +q.desde || 0));
      const largo = Math.max(1, Math.min(30, +q.largo || 12));
      a = Math.floor(desde * bps); b = Math.min(total - 1, Math.floor((desde + largo) * bps));
    } else {
      const m = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range || ""));
      if (m && total) {
        a = m[1] === "" ? Math.max(0, total - (+m[2] || 0)) : +m[1];
        b = m[1] !== "" && m[2] !== "" ? Math.min(+m[2], total - 1) : total - 1;
        parcial = true;
      } else if (total > MAX) parcial = true;     // archivo grande: se entrega por partes
    }
    if (total && b - a + 1 > MAX) b = a + MAX - 1;

    const up = await fetch(s.url, total ? { headers: { Range: `bytes=${a}-${b}` } } : {});
    if (!up.ok) return res.status(502).json({ error: "no se pudo traer el sonido" });
    const buf = Buffer.from(await up.arrayBuffer());

    // los pedazos tienen URL propia y se guardan en la CDN; los rangos solo en el navegador
    res.setHeader("Cache-Control", parcial ? "public, max-age=604800" : "public, max-age=604800, s-maxage=31536000, immutable");
    res.setHeader("Content-Length", String(buf.length));
    if (parcial && total) {
      res.setHeader("Content-Range", `bytes ${a}-${a + buf.length - 1}/${total}`);
      return res.status(206).end(buf);
    }
    return res.status(200).end(buf);
  } catch (e) {
    return res.status(502).json({ error: "no se pudo traer el sonido" });
  }
};
