/* Rancho El Descanso · días festivos (1 oct 2026).
   En estos días NO hay sesiones de fotos ni se aparta evento en línea: el cliente pregunta por WhatsApp
   si ese día está habilitado. Se calculan solos cada año (no hay que capturarlos).
   Lista elegida por Nico:
   - Oficiales (Ley Federal del Trabajo, art. 74): 1 ene, primer lunes de feb, tercer lunes de mar, 1 may,
     16 sep, 1 oct cada 6 años (cambio de presidente: 2030, 2036…), tercer lunes de nov, 25 dic
   - Semana Santa: Jueves y Viernes Santo
   - 24 y 31 de diciembre
   La misma lista vive en index.html (función festivoDe) y en el Apps Script de la Agenda. */

const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/* n-ésimo lunes del mes (m = 1..12) */
function lunes(y, m, n) {
  const wd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((8 - wd) % 7) + (n - 1) * 7;
}
/* Domingo de Pascua (algoritmo gregoriano anónimo) → Date UTC */
function pascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mes - 1, dia));
}
const menos = (fecha, dias) => new Date(fecha.getTime() - dias * 864e5).toISOString().slice(0, 10);

const cache = {};
function festivosDelAnio(y) {
  if (cache[y]) return cache[y];
  const p = pascua(y);
  const f = {
    [iso(y, 1, 1)]: "Año Nuevo",
    [iso(y, 2, lunes(y, 2, 1))]: "Día de la Constitución",
    [iso(y, 3, lunes(y, 3, 3))]: "Natalicio de Benito Juárez",
    [menos(p, 3)]: "Jueves Santo",
    [menos(p, 2)]: "Viernes Santo",
    [iso(y, 5, 1)]: "Día del Trabajo",
    [iso(y, 9, 16)]: "Día de la Independencia",
    [iso(y, 11, lunes(y, 11, 3))]: "Revolución Mexicana",
    [iso(y, 12, 24)]: "Nochebuena",
    [iso(y, 12, 25)]: "Navidad",
    [iso(y, 12, 31)]: "Fin de año"
  };
  if ((y - 2024) % 6 === 0) f[iso(y, 10, 1)] = "Transmisión del Poder Ejecutivo";
  return (cache[y] = f);
}

/* festivo("2026-11-16") → "Revolución Mexicana" | "" */
function festivo(fecha) {
  const m = String(fecha || "").match(/^(\d{4})-\d{2}-\d{2}$/);
  if (!m) return "";
  return festivosDelAnio(Number(m[1]))[fecha] || "";
}
/* Festivos entre dos fechas ISO (inclusive) → {"2026-11-16":"Revolución Mexicana", …} */
function festivosEntre(desde, hasta) {
  const out = {};
  const y0 = Number(String(desde).slice(0, 4)), y1 = Number(String(hasta).slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const [k, v] of Object.entries(festivosDelAnio(y))) if (k >= desde && k <= hasta) out[k] = v;
  }
  return out;
}

module.exports = {festivo, festivosEntre};
