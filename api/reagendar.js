/* Rancho El Descanso · el cliente elige su nueva fecha (3 oct 2026).
   Cuando el equipo reagenda una sesión o evento con "Que el cliente elija", la cita sale del calendario y al cliente
   le llega una liga /reagendar/?t=<token> (por correo o WhatsApp). El token vive solo en la pestaña
   CANCELACIONES Y CAMBIOS de la Maestra; sirve una vez. Lo pagado queda a su favor (no se cobra nada aquí).

   GET  /api/reagendar?t=<token>  → {ok, pendiente, tipo, paquete, horarios, original, hasta, dias, festivos, reglas}
   POST /api/reagendar {t, fecha, horario, llegada} → {ok, nueva} | {error}
   Mismas reglas que la página: días festivos sin apartado en línea, sesiones con 24 h de anticipación,
   horarios por paquete (entre semana / sábado), domingo sin sesiones, eventos con el día completo libre. */
const AG = require("./_agenda");
const F = require("./_festivos");

const intentos = new Map();
function frenar(ip, max) {
  const ahora = Date.now(), l = (intentos.get(ip) || []).filter(t => ahora - t < 10 * 60e3); l.push(ahora); intentos.set(ip, l);
  if (intentos.size > 3000) for (const [k, v] of intentos) if (!v.some(t => ahora - t < 10 * 60e3)) intentos.delete(k);
  return l.length > max;
}
const hoy = () => new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10);
const tokenOk = t => /^[a-f0-9]{40}$/.test(String(t || ""));
async function agenda(datos) {
  if (!AG.AGENDA_URL || !process.env.RANCHO_TOKEN) throw new Error("sin agenda");
  const r = await fetch(AG.AGENDA_URL, {method: "POST", headers: {"Content-Type": "application/json"}, redirect: "follow",
    body: JSON.stringify({...datos, accion: "panel_cambios", token: process.env.RANCHO_TOKEN})});
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { throw new Error("Agenda " + r.status); }
}
/* Horarios que puede elegir: los del paquete; sesiones puestas a mano (sin paquete) usan los de "producción" */
const horariosDe = paquete => AG.HORARIOS[paquete] || AG.HORARIOS.produccion;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  const ip = String(req.headers["x-real-ip"] || "").trim();
  try {
    if (req.method === "GET") {
      if (frenar(ip, 40)) return res.status(429).json({error: "Demasiados intentos. Espera unos minutos o escríbenos por WhatsApp."});
      const t = String((req.query && req.query.t) || "");
      if (!tokenOk(t)) return res.status(404).json({error: "Esta liga no es válida. Escríbenos por WhatsApp."});
      const info = await agenda({op: "liga_info", t});
      if (!info.ok) return res.status(404).json({error: "Esta liga no es válida. Escríbenos por WhatsApp."});
      const out = {ok: true, pendiente: info.pendiente, estatus: info.estatus, nombre: info.nombre, tipo: info.tipo, paquete: info.paquete, paqueteTxt: info.paqueteTxt,
        evento: info.evento, original: info.original, llegadaOriginal: info.llegada, nueva: info.nueva, conPago: info.conPago, motivo: info.motivo};
      if (!info.pendiente) return res.status(200).json(out);
      const ag = await AG.disponibilidad({fresco: true});
      const hasta = [info.hasta, ag.hasta].filter(Boolean).sort()[0] || ag.hasta;
      const dias = {};
      Object.keys(ag.dias || {}).forEach(k => { if (k >= hoy() && k <= hasta) dias[k] = ag.dias[k]; });
      const pq = info.tipo === "sesion" ? (AG.HORARIOS[info.paquete] ? info.paquete : "produccion") : "";
      // horarios por día de la semana (0 = domingo) para que la página no tenga que saber las reglas
      const semana = pq ? [0, 1, 2, 3, 4, 5, 6].map(d => horariosDe(pq)(d)) : [];
      return res.status(200).json({...out, hasta, dias, semana, festivos: F.festivosEntre(hoy(), hasta),
        reglas: {minHoras: AG.MIN_HORAS, llegadas: AG.LLEGADAS, sesionHoras: AG.SESION_HORAS}});
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({error: "Método no permitido."}); }
    if (frenar(ip, 15)) return res.status(429).json({error: "Demasiados intentos. Espera unos minutos o escríbenos por WhatsApp."});
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!tokenOk(b.t)) return res.status(400).json({error: "Esta liga no es válida."});
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha || "")) ? b.fecha : "";
    if (!fecha) return res.status(400).json({error: "Elige tu nueva fecha."});
    if (fecha <= hoy()) return res.status(400).json({error: "Elige una fecha a partir de mañana."});
    if (F.festivo(fecha)) return res.status(400).json({error: `Ese día es festivo (${F.festivo(fecha)}). Escríbenos por WhatsApp para saber si está habilitado.`});
    const info = await agenda({op: "liga_info", t: b.t});
    if (!info.ok) return res.status(400).json({error: "Esta liga no es válida."});
    if (!info.pendiente) return res.status(409).json({error: "Esta liga ya se usó. Tu nueva fecha es el " + info.nueva + ".", usado: true});
    let horario = "", llegada = "";
    if (info.tipo === "sesion") {
      horario = String(b.horario || ""); llegada = String(b.llegada || "");
      const pq = AG.HORARIOS[info.paquete] ? info.paquete : "produccion";
      if (!horariosDe(pq)(AG.diaSemana(fecha)).includes(horario)) return res.status(400).json({error: "Ese horario no está disponible ese día. Elige otro."});
      if (!(AG.LLEGADAS[horario] || []).includes(llegada)) return res.status(400).json({error: "Elige tu hora de llegada."});
      if ((AG.inicioMX(fecha, AG.SLOTS[horario][0]) - Date.now()) / 36e5 < AG.MIN_HORAS) return res.status(400).json({error: `Elige con al menos ${AG.MIN_HORAS} horas de anticipación.`});
    }
    const ag = await AG.disponibilidad({fresco: true});
    if (!AG.libre(ag.dias, fecha, horario || undefined)) return res.status(409).json({error: info.tipo === "sesion" ? "Ese horario ya está ocupado. Elige otro." : "Esa fecha ya está ocupada. Elige otra."});
    const r = await agenda({op: "liga_aplicar", t: b.t, fecha, horario, llegada});
    if (!r.ok) return res.status(r.usado ? 409 : 400).json({error: r.error || "No se pudo guardar. Escríbenos por WhatsApp."});
    return res.status(200).json({ok: true, nueva: r.nueva});
  } catch (e) {
    console.error(e);
    return res.status(500).json({error: "No pudimos abrir tu reserva en este momento. Intenta en unos minutos o escríbenos por WhatsApp."});
  }
};
