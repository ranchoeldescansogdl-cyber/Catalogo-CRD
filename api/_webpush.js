/* Envío de notificaciones Web Push sin dependencias (RFC 8291 aes128gcm + RFC 8292 VAPID).
   Variables en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...). */
const crypto = require("crypto");

const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

function vapidHeader(endpoint) {
  const pub = unb64u(process.env.VAPID_PUBLIC_KEY), priv = unb64u(process.env.VAPID_PRIVATE_KEY);
  const key = crypto.createPrivateKey({ format: "jwk", key: {
    kty: "EC", crv: "P-256", d: b64u(priv), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: process.env.VAPID_SUBJECT || "mailto:ranchoeldescansogdl@gmail.com" }));
  const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

function encrypt(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

/* sub = {endpoint, p256dh, auth}. Devuelve {ok, status, gone} — gone=true si la suscripción ya no existe. */
async function send(sub, data, ttl = 86400) {
  try {
    const r = await fetch(sub.endpoint, { method: "POST", headers: {
      Authorization: vapidHeader(sub.endpoint), "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: "normal" },
      body: encrypt(JSON.stringify(data), sub.p256dh, sub.auth) });
    return { ok: r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
  } catch (e) { return { ok: false, status: 0, gone: false, error: String(e.message || e) }; }
}

module.exports = { send, encrypt, vapidHeader, b64u, unb64u };
