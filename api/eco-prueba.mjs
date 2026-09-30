/* TEMPORAL (solo rama de prueba): confirma que el handler Web recibe el cuerpo crudo. Se borra antes de pasar a main. */
import crypto from "node:crypto";
import AG from "./_agenda.js";
export default {
  async fetch(request) {
    const raw = Buffer.from(await request.arrayBuffer());
    return new Response(JSON.stringify({len: raw.length, sha: crypto.createHash("sha256").update(raw).digest("hex"), agenda: typeof AG.confirmar, secreto: !!process.env.STRIPE_WEBHOOK_SECRET}), {headers: {"Content-Type": "application/json"}});
  }
};
