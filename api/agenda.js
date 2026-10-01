/* Rancho El Descanso · disponibilidad pública para la página.
   GET /api/agenda → {activa, dias:{"2026-11-14":{d:"ocupado"|"por_confirmar"|null, s:["10-14"], x:true}}, festivos:{"2026-11-16":"Revolución Mexicana"}, reglas}
   Solo días y horarios ocupados: nunca nombres ni datos de clientes.
   festivos (1 oct 2026): sin sesiones ni apartado de eventos en línea; se pregunta por WhatsApp. */
const A = require("./_agenda");
const F = require("./_festivos");
const hoy = () => new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  if (!A.AGENDA_URL) { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({activa: false, festivos: F.festivosEntre(hoy(), hoy().replace(/^\d{4}/, y => String(Number(y) + 2)))}); }
  try {
    const j = await A.disponibilidad();
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({activa: true, generado: j.generado, hasta: j.hasta, dias: j.dias,
      festivos: F.festivosEntre(hoy(), j.hasta || hoy().replace(/^\d{4}/, y => String(Number(y) + 2))),
      reglas: {minHoras: A.MIN_HORAS, totalSiMenos: A.TOTAL_SI_MENOS, slots: Object.keys(A.SLOTS), sesionHoras: A.SESION_HORAS, llegadas: A.LLEGADAS, maxPersonas: A.MAX_PERSONAS}});
  } catch (e) {
    console.error(e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({activa: false, error: "agenda no disponible", festivos: F.festivosEntre(hoy(), hoy().replace(/^\d{4}/, y => String(Number(y) + 2)))});
  }
};
