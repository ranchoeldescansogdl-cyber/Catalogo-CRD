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

/* Un pedazo cortado por bytes empieza y termina a la mitad de un cuadro de MP3.
   Chrome lo tolera, pero Safari (iPhone) no lo decodifica ("EncodingError: Decoding failed").
   Por eso se recorta para que empiece en un cuadro completo y termine en el último cuadro entero. */
const BR1 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320], BR2 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
const SR = { 3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000] };
function cuadro(buf, i) {                       // largo del cuadro MP3 (Layer III) que empieza en i, o 0
  if (i + 4 > buf.length || buf[i] !== 0xFF || (buf[i + 1] & 0xE0) !== 0xE0) return 0;
  const ver = (buf[i + 1] >> 3) & 3, capa = (buf[i + 1] >> 1) & 3, bi = buf[i + 2] >> 4, si = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
  if (ver === 1 || capa !== 1 || bi === 0 || bi === 15 || si === 3) return 0;
  const kbps = (ver === 3 ? BR1 : BR2)[bi], hz = SR[ver][si];
  return Math.floor((ver === 3 ? 144000 : 72000) * kbps / hz) + pad;
}
function alinear(buf) {
  let ini = -1;
  for (let i = 0; i < buf.length - 4 && ini < 0; i++) {
    let j = i, n = 0, l;
    while (n < 4 && (l = cuadro(buf, j))) { j += l; n++; }   // 4 cuadros seguidos = inicio seguro
    if (n === 4) ini = i;
  }
  if (ini < 0) return buf;
  let fin = ini, l;
  while ((l = cuadro(buf, fin)) && fin + l <= buf.length) fin += l;
  return buf.subarray(ini, fin);
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
    let buf = Buffer.from(await up.arrayBuffer());
    if (q.desde != null && total) buf = alinear(buf);   // pedazo: empieza y termina en cuadros completos

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
