/* Organigrama de Rancho El Descanso (4 oct 2026, decidido por Nico).
   Mario es dueño y director general: todos le reportan. Nico le reporta a Mario pero asigna y revisa todo igual que él.
   Judith asigna solo tareas de administración. Los médicos asignan tareas de salud directo a Chito.
   Los demás (Mónica: eventos, sesiones y clientes; Yuliana; Olga; Chito) no asignan: usan "Pedir tarea", que le llega a Mario y Nico.
   Una tarea terminada la da por buena Mario, Nico o quien la asignó (si podía asignársela a esa persona).

   Para cambiar el organigrama se edita esta lista. Cada persona se reconoce por su correo o por el primer nombre
   con el que está en la pestaña EQUIPO de la Maestra. Quien no aparezca aquí reporta a Mario y no asigna.
   asigna: "todos" o lista de claves · areas: áreas permitidas en sus tareas (vacío = cualquiera) · revisaTodo: revisa y aprueba todo
   caja: lleva la caja chica en el rancho (4 oct 2026: Olga). Judith la captura desde la oficina; Mario y Nico la ven completa. */
const ORG = [
  {clave: "mario",   busca: ["mcampero@ceica.com.mx", "mario"], puesto: "Dueño y director general", area: "Dirección", reportaA: null, asigna: "todos", revisaTodo: true},
  {clave: "nico",    busca: ["nicolas@legaius.com", "nicolas", "nico"], puesto: "Ventas y sistemas", area: "Dirección", reportaA: "mario", asigna: "todos", revisaTodo: true},
  {clave: "monica",  busca: ["mo730222@hotmail.com", "monica"], puesto: "Ventas, eventos y sesiones", area: "Eventos y sesiones", reportaA: "mario"},
  {clave: "yuliana", busca: ["yulgr2616@gmail.com", "yuliana"], puesto: "Ventas", area: "Ventas", reportaA: "mario"},
  {clave: "judith",  busca: ["contabilidad1@ceica.com.mx", "judith"], puesto: "Administración y contabilidad", area: "Administración", reportaA: "mario", asigna: "todos", areas: ["Administración"]},
  {clave: "joaquin", busca: ["joaquin"], puesto: "Médico de planta", area: "Salud", reportaA: "mario", asigna: ["chito"], areas: ["Salud", "Reproducción"]},
  {clave: "roberto", busca: ["rcmenaz@hotmail.com", "roberto"], puesto: "Reproducción y registros", area: "Reproducción", reportaA: "mario", asigna: ["chito"], areas: ["Salud", "Reproducción"]},
  {clave: "chito",   busca: ["chito"], puesto: "Caballos y caballerizas", area: "Caballos", reportaA: "mario"},
  {clave: "olga",    busca: ["olgaespinoza419@gmail.com", "olga"], puesto: "Jardinería, mantenimiento y caja chica", area: "Jardinería", reportaA: "mario", caja: true}
];
const CUENTAS_GENERALES = ["ranchoeldescansogdl@gmail.com"]; // no es una persona: fuera del organigrama, no asigna ni pide

const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const primerNombre = s => norm(s).split(/[\s(]+/)[0] || "";

function puestoDe(p) {
  if (!p) return null;
  const email = norm(p.email), pn = primerNombre(p.nombre);
  if (CUENTAS_GENERALES.includes(email)) return {clave: "cuenta", puesto: "Cuenta general", area: "", reportaA: null, asigna: [], general: true};
  const o = ORG.find(x => x.busca.some(b => b.includes("@") ? b === email : b === pn));
  return o ? {...o, asigna: o.asigna || []} : {clave: pn, puesto: "", area: p.area || "", reportaA: "mario", asigna: []};
}
const claveDe = p => (puestoDe(p) || {}).clave;
const revisaTodo = p => !!(puestoDe(p) || {}).revisaTodo;
const asignaAlguien = p => { const o = puestoDe(p); return !!o && (o.asigna === "todos" || (Array.isArray(o.asigna) && o.asigna.length > 0)); };
const puedePedir = p => { const o = puestoDe(p); return !!o && !o.general && !o.revisaTodo; };

/* ¿quien puede asignarle una tarea a destino? (personas del equipo, objetos de la pestaña EQUIPO) */
function puedeAsignarA(quien, destino) {
  const o = puestoDe(quien); if (!o || !destino) return false;
  if (o.asigna === "todos") return !puestoDe(destino).general;
  return Array.isArray(o.asigna) && o.asigna.includes(claveDe(destino));
}
const areasDe = p => (puestoDe(p) || {}).areas || [];
const llevaCaja = p => { const o = puestoDe(p); return !!o && !!o.caja; };

/* Tareas "Disponible": en la columna "Asignada a" se guarda "Disponible · Todos" o "Disponible · Olga, Chito"
   (primeros nombres). Pedidas: "Solicitud · <sugerencia>" hasta que Mario o Nico la aprueban y la asignan. */
const DISP = "Disponible · ", SOLI = "Solicitud · ";
const FOTO = "📷 Pide foto al terminar", APROBO = "✅ Aprobó: "; // primeras líneas del Detalle (se ven bien en la hoja)
const pideFoto = t => String(t["Detalle"] || "").split("\n").some(l => l.trim() === FOTO);
const esDisponible = t => String(t["Asignada a"] || "").startsWith(DISP);
const esSolicitud = t => String(t["Asignada a"] || "").startsWith(SOLI);
function candidatos(t) { const r = String(t["Asignada a"] || "").slice(DISP.length).trim(); return /^todos$/i.test(r) ? "todos" : r.split(/\s*,\s*/).map(norm).filter(Boolean); }
function puedeTomar(p, t) {
  if (!esDisponible(t) || t["Estatus"] !== "Pendiente") return false;
  const o = puestoDe(p); if (!o || o.general) return false;
  const c = candidatos(t); return c === "todos" || c.includes(primerNombre(p.nombre));
}
/* revisar / reabrir / cancelar / editar una tarea: Mario, Nico o quien la asignó (si podía asignársela a esa persona) */
function puedeRevisar(p, t, equipo) {
  if (revisaTodo(p)) return true;
  if (t["Asignó"] !== p.nombre || esSolicitud(t)) return false;
  if (esDisponible(t)) return true;
  const dest = (equipo || []).find(x => x.nombre === t["Asignada a"]);
  return !!dest && puedeAsignarA(p, dest);
}

module.exports = {ORG, puestoDe, claveDe, revisaTodo, asignaAlguien, puedePedir, puedeAsignarA, areasDe, llevaCaja, DISP, SOLI,
  esDisponible, esSolicitud, candidatos, FOTO, APROBO, pideFoto, puedeTomar, puedeRevisar, primerNombre, norm};
