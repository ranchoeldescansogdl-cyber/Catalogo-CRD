/* Rancho El Descanso · conexión con la Agenda (Google Calendar vía Apps Script).
   El calendario "Rancho El Descanso · Agenda" es la fuente de verdad de sesiones y eventos.
   AGENDA_URL = URL del Apps Script publicado como aplicación web (termina en /exec). Vacío = agenda apagada:
   la página no muestra horarios y las sesiones se agendan por WhatsApp. */
const AGENDA_URL = process.env.AGENDA_URL || "";

const SLOTS = {"10-14": [10, 14], "14-18": [14, 18]};
/* Qué horarios ofrece cada paquete (0 = domingo … 6 = sábado) */
const HORARIOS = {
  manana:     d => (d >= 1 && d <= 5 ? ["10-14"] : []),
  tarde:      d => (d >= 1 && d <= 5 ? ["14-18"] : d === 6 ? ["10-14"] : []),
  produccion: d => (d >= 1 && d <= 5 ? ["10-14", "14-18"] : d === 6 ? ["10-14"] : [])
};
const MIN_HORAS = 24;       // se reserva con mínimo 24 h de anticipación
const TOTAL_SI_MENOS = 48;  // con menos de 48 h se paga el total al reservar

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
async function post(accion, session_id) {
  if (!AGENDA_URL) return {ok: true, apagada: true};
  const r = await fetch(AGENDA_URL, {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({accion, session_id}), redirect: "follow"});
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { throw new Error("Agenda respondió " + r.status + ": " + txt.slice(0, 200)); }
}
const apartar = id => post("apartar", id);
const confirmar = id => post("confirmar", id);

/* ¿El día/horario está libre? dias = respuesta de disponibilidad().dias */
function libre(dias, fecha, horario) {
  const x = (dias || {})[fecha] || {d: null, s: []};
  if (!horario) return !x.d && !x.x;             // evento: día completo sin nada
  return !x.d && !(x.s || []).includes(horario);  // sesión: sin evento ese día y horario libre
}

module.exports = {AGENDA_URL, SLOTS, HORARIOS, MIN_HORAS, TOTAL_SI_MENOS, inicioMX, diaSemana, disponibilidad, apartar, confirmar, libre};
