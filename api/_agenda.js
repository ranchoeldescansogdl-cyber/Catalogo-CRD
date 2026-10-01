/* Rancho El Descanso · conexión con la Agenda (Google Calendar vía Apps Script).
   El calendario "Rancho El Descanso · Agenda" es la fuente de verdad de sesiones y eventos.
   AGENDA_URL = Apps Script "Agenda Rancho El Descanso" publicado como aplicación web.
   Con RANCHO_TOKEN en Vercel, apartar/confirmar llevan ese token (el Apps Script lo exige si lo tiene).
   Si la URL queda vacía, la página no muestra horarios y las sesiones se agendan por WhatsApp. */
const AGENDA_URL = process.env.AGENDA_URL || "https://script.google.com/macros/s/AKfycbzccWMScnT9y-jZXQzTsIza4bSk8pBUKE7a0SxZvqmlVfoJA5nC0tkvtr1EKBUwfsgV/exec";

const SLOTS = {"10-14": [10, 14], "14-18": [14, 18]};
/* Qué horarios ofrece cada paquete (0 = domingo … 6 = sábado) */
const HORARIOS = {
  manana:     d => (d >= 1 && d <= 5 ? ["10-14"] : []),
  tarde:      d => (d >= 1 && d <= 5 ? ["14-18"] : d === 6 ? ["10-14"] : []),
  produccion: d => (d >= 1 && d <= 5 ? ["10-14", "14-18"] : d === 6 ? ["10-14"] : [])
};
const MIN_HORAS = 24;       // se reserva con mínimo 24 h de anticipación
const TOTAL_SI_MENOS = 48;  // con menos de 48 h se paga el total al reservar

/* 1 oct 2026: la sesión dura 3 h desde que llegan. Dentro del bloque eligen llegar a la hora de inicio
   o hasta 1 h después (cada 30 min), para que les alcancen sus 3 h. Si llegan más tarde, no se extiende
   (o pagan hora extra). Máximo 8 personas en total contando al titular (fotógrafo, maquillista, familia). */
const SESION_HORAS = 3;
const LLEGADAS = {"10-14": ["10:00", "10:30", "11:00"], "14-18": ["14:00", "14:30", "15:00"]};
const MAX_PERSONAS = 8;

const inicioMX = (fecha, h) => new Date(`${fecha}T${String(h).padStart(2, "0")}:00:00-06:00`);
const diaSemana = fecha => new Date(fecha + "T12:00:00Z").getUTCDay();

let cache = {t: 0, v: null};
async function disponibilidad({fresco = false} = {}) {
  if (!AGENDA_URL) return null;
  if (!fresco && cache.v && Date.now() - cache.t < 30e3) return cache.v;
  const r = await fetch(AGENDA_URL + "?accion=disponibilidad", {redirect: "follow"});
  if (!r.ok) throw new Error("Agenda " + r.status);
  const j = await r.json();
  if (!j.ok) throw new Error("Agenda: " + (j.error || "sin datos"));
  cache = {t: Date.now(), v: j};
  return j;
}
async function post(accion, session_id, extra) {
  if (!AGENDA_URL) return {ok: true, apagada: true};
  const r = await fetch(AGENDA_URL, {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({...(extra || {}), accion, session_id, token: process.env.RANCHO_TOKEN || undefined}), redirect: "follow"});
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { throw new Error("Agenda respondió " + r.status + ": " + txt.slice(0, 200)); }
}
/* extra.ine = {nombre, tipo, datos(base64)}: identificación del titular de la sesión; el Apps Script la guarda en Drive */
const apartar = (id, extra) => post("apartar", id, extra);
const confirmar = id => post("confirmar", id);

/* ¿El día/horario está libre? dias = respuesta de disponibilidad().dias */
function libre(dias, fecha, horario) {
  const x = (dias || {})[fecha] || {d: null, s: []};
  if (!horario) return !x.d && !x.x;             // evento: día completo sin nada
  return !x.d && !(x.s || []).includes(horario);  // sesión: sin evento ese día y horario libre
}

module.exports = {AGENDA_URL, SLOTS, HORARIOS, MIN_HORAS, TOTAL_SI_MENOS, SESION_HORAS, LLEGADAS, MAX_PERSONAS, inicioMX, diaSemana, disponibilidad, apartar, confirmar, libre};
