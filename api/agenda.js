/* Rancho El Descanso · disponibilidad pública para la página.
   GET /api/agenda → {activa, dias:{"2026-11-14":{d:"ocupado"|"por_confirmar"|null, s:["10-14"], x:true}}, reglas}
   Solo días y horarios ocupados: nunca nombres ni datos de clientes. */
const A = require("./_agenda");

module.exports = async (req, res) => {
  if (!A.AGENDA_URL) { res.setHeader("Cache-Control", "no-store"); return res.status(200).json({activa: false}); }
  try {
    const j = await A.disponibilidad();
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({activa: true, generado: j.generado, hasta: j.hasta, dias: j.dias,
      reglas: {minHoras: A.MIN_HORAS, totalSiMenos: A.TOTAL_SI_MENOS, slots: Object.keys(A.SLOTS)}});
  } catch (e) {
    console.error(e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({activa: false, error: "agenda no disponible"});
  }
};
