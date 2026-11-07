// End-to-end passkey test against a running dev server, using a software authenticator
// (a real P-256 key pair, signing exactly what a phone's secure chip would sign).
// Usage (see Auth/README.md, "Testing passkeys"):
//   node Auth/scripts/passkey-e2e.mjs http://localhost:3102 dev.log you@example.com
import crypto from "node:crypto";
import fs from "node:fs";

const [BASE, LOG, EMAIL] = process.argv.slice(2);
const ORIGIN = new URL(BASE).origin;
const RP_ID = new URL(BASE).hostname;
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

// ---- a tiny cookie jar per "device" ----
function device() {
  const jar = new Map();
  return async function call(path, { method = "GET", body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { Origin: ORIGIN, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  };
}

// ---- minimal CBOR (just what WebAuthn needs) ----
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}
function cbor(v) {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: unsupported");
}

const b64u = (b) => Buffer.from(b).toString("base64url");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

// ---- the "authenticator" ----
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const credId = crypto.randomBytes(16);
const cose = cbor(
  new Map([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, Buffer.from(jwk.x, "base64url")],
    [-3, Buffer.from(jwk.y, "base64url")],
  ]),
);

function register(options) {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: ORIGIN, crossOrigin: false }));
  const credLen = Buffer.alloc(2);
  credLen.writeUInt16BE(credId.length);
  // flags: user present (0x01) + user verified (0x04) + attested credential data (0x40)
  const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x45]), u32(0), Buffer.alloc(16), credLen, credId, cose]);
  const attestation = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
  return {
    id: b64u(credId),
    rawId: b64u(credId),
    type: "public-key",
    response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestation), transports: ["internal"] },
    authenticatorAttachment: "platform",
  };
}

function authenticate(options, userHandle, counter, { tamper = false } = {}) {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), u32(counter)]);
  let signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
  if (tamper) signature = crypto.sign("sha256", Buffer.from("something else"), privateKey);
  return {
    id: b64u(credId),
    rawId: b64u(credId),
    type: "public-key",
    response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature), userHandle },
    clientExtensionResults: {},
    authenticatorAttachment: "platform",
  };
}

// ---- 1. every app is closed without an account ----
const stranger = device();
for (const p of ["/api/splitbill/groups", "/api/tallyback/bills?deviceId=x", "/api/reviewscout/searches?deviceId=x"]) {
  const r = await stranger(p);
  check(r.status === 401, `signed out: GET ${p} → ${r.status}`);
}

// ---- 2. register: email code → session ----
const laptop = device();
await laptop("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email: EMAIL, type: "sign-in" } });
await new Promise((r) => setTimeout(r, 800));
const otp = [...fs.readFileSync(LOG, "utf8").matchAll(new RegExp(`${EMAIL.replace(".", "\\.")}[\\s\\S]{0,300}?\\b(\\d{6})\\b`, "g"))].pop()?.[1];
const signedIn = await laptop("/api/auth/sign-in/email-otp", { method: "POST", body: { email: EMAIL, otp } });
check(signedIn.status === 200, `email code sign-in → ${signedIn.status}`);

// ---- 3. add a passkey (needs that session) ----
const regOpts = await laptop("/api/auth/passkey/generate-register-options?name=Test%20laptop");
check(regOpts.status === 200 && regOpts.json?.rp?.id === RP_ID, `registration options for rp "${regOpts.json?.rp?.id}"`);
check(regOpts.json?.authenticatorSelection?.residentKey === "required", `discoverable passkey requested (residentKey=${regOpts.json?.authenticatorSelection?.residentKey})`);
const reg = await laptop("/api/auth/passkey/verify-registration", { method: "POST", body: { response: register(regOpts.json), name: "Test laptop" } });
check(reg.status === 200, `passkey registered → ${reg.status} ${reg.status === 200 ? "" : reg.text.slice(0, 200)}`);
const list = await laptop("/api/auth/passkey/list-user-passkeys");
check(Array.isArray(list.json) && list.json.length === 1, `account now lists ${list.json?.length} passkey`);

// A stranger can't add a passkey to anyone.
const strangerReg = await stranger("/api/auth/passkey/generate-register-options");
check(strangerReg.status === 401, `signed out: registration options refused → ${strangerReg.status}`);

// ---- 4. next visit, new browser, no email: sign in with the passkey ----
const userHandle = regOpts.json.user.id;
const phone = device();
const authOpts = await phone("/api/auth/passkey/generate-authenticate-options");
check(authOpts.status === 200 && !!authOpts.json?.challenge, "authentication challenge issued");
const auth = await phone("/api/auth/passkey/verify-authentication", { method: "POST", body: { response: authenticate(authOpts.json, userHandle, 1) } });
check(auth.status === 200 && auth.json?.session, `passkey sign-in → ${auth.status} ${auth.status === 200 ? "" : auth.text.slice(0, 200)}`);
const apps = await phone("/api/splitbill/groups");
check(apps.status === 200 && apps.json?.me?.email === EMAIL, `then the apps open → ${apps.status} as ${apps.json?.me?.email}`);

// ---- 5. a forged signature gets nothing ----
const thief = device();
const opts2 = await thief("/api/auth/passkey/generate-authenticate-options");
const forged = await thief("/api/auth/passkey/verify-authentication", { method: "POST", body: { response: authenticate(opts2.json, userHandle, 2, { tamper: true }) } });
check(forged.status !== 200, `forged signature refused → ${forged.status}`);
check((await thief("/api/splitbill/groups")).status === 401, "and the forger still can't open the apps");

// ---- 6. a replayed sign-in (old challenge) is refused ----
const replay = await phone("/api/auth/passkey/verify-authentication", { method: "POST", body: { response: authenticate(authOpts.json, userHandle, 3) } });
check(replay.status !== 200, `replayed challenge refused → ${replay.status}`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
