export type StoredPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

export type WebPushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

const encoder = new TextEncoder();

function asArrayBuffer(value: Uint8Array) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function hmac(key: Uint8Array, value: Uint8Array) {
  const imported = await crypto.subtle.importKey("raw", asArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, asArrayBuffer(value)));
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number) {
  const output: number[] = [];
  let previous = new Uint8Array();
  let counter = 1;
  while (output.length < length) {
    previous = await hmac(prk, concat(previous, info, Uint8Array.of(counter)));
    output.push(...previous);
    counter += 1;
  }
  return new Uint8Array(output.slice(0, length));
}

async function vapidJwt(endpoint: string, config: WebPushConfig) {
  const publicBytes = decodeBase64Url(config.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error("WEB_PUSH_PUBLIC_KEY_INVALID");
  const privateBytes = decodeBase64Url(config.privateKey);
  if (privateBytes.length !== 32) throw new Error("WEB_PUSH_PRIVATE_KEY_INVALID");
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(publicBytes.slice(1, 33)),
    y: encodeBase64Url(publicBytes.slice(33, 65)),
    d: encodeBase64Url(privateBytes),
    ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: config.subject,
  })));
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned));
  return `${unsigned}.${encodeBase64Url(signature)}`;
}

async function encryptedPayload(subscription: StoredPushSubscription, payload: unknown) {
  const userPublic = decodeBase64Url(subscription.keys.p256dh);
  const auth = decodeBase64Url(subscription.keys.auth);
  if (userPublic.length !== 65 || auth.length < 16) throw new Error("WEB_PUSH_SUBSCRIPTION_KEYS_INVALID");
  const userKey = await crypto.subtle.importKey("raw", userPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userKey }, serverKeys.privateKey, 256));

  const authPrk = await hmac(auth, sharedSecret);
  const keyInfo = concat(encoder.encode("WebPush: info\0"), userPublic, serverPublic);
  const ikm = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const contentKey = await hkdfExpand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);
  const plaintext = concat(encoder.encode(JSON.stringify(payload)), Uint8Array.of(2));
  const aes = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, plaintext));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concat(salt, recordSize, Uint8Array.of(serverPublic.length), serverPublic, ciphertext);
}

export async function sendWebPush(
  subscription: StoredPushSubscription,
  payload: unknown,
  config: WebPushConfig,
) {
  const body = await encryptedPayload(subscription, payload);
  const token = await vapidJwt(subscription.endpoint, config);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${token}, k=${config.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "normal",
    },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  return { ok: response.ok, status: response.status, expired: response.status === 404 || response.status === 410 };
}
