const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function b64urlEncode(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomString(byteLength = 32) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(input) {
  return crypto.subtle.digest('SHA-256', encoder.encode(input));
}

function decodePart(part) {
  return JSON.parse(decoder.decode(b64urlDecode(part)));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Sign a payload as an HS256 JWT. */
export async function signHS256(payload, secret) {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncode(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${b64urlEncode(sig)}`;
}

/** Verify an HS256 JWT; returns the payload or null when invalid/expired. */
export async function verifyHS256(token, secret) {
  try {
    const [header, body, sig] = (token || '').split('.');
    if (!header || !body || !sig || decodePart(header).alg !== 'HS256') return null;
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), encoder.encode(`${header}.${body}`));
    if (!ok) return null;
    const payload = decodePart(body);
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/** Verify an RS256 JWT against a JWKS key set; returns the payload or throws. */
export async function verifyRS256(token, jwks) {
  const [header, body, sig] = (token || '').split('.');
  if (!header || !body || !sig) throw new Error('malformed id_token');
  const { alg, kid } = decodePart(header);
  if (alg !== 'RS256') throw new Error(`unsupported id_token alg: ${alg}`);
  const jwk = (jwks.keys || []).find((k) => k.kid === kid);
  if (!jwk) throw new Error('id_token signing key not found');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(sig),
    encoder.encode(`${header}.${body}`),
  );
  if (!ok) throw new Error('invalid id_token signature');
  return decodePart(body);
}
