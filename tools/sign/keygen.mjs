// Make the Chucksi Sign attestation key: an ECDSA P-256 private JWK for the SIGN_KEY secret.
//   node tools/sign/keygen.mjs | npx wrangler secret put SIGN_KEY
// Prints the private JWK on stdout and the public key ID on stderr. Keep the private key secret; the
// Worker serves only the public half at /api/sign/key.

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const pub = { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y };
const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pub))));
const kid = Buffer.from(digest).toString('base64url');
process.stdout.write(JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }));
process.stderr.write(`\nKey ID (kid): ${kid}\n`);
