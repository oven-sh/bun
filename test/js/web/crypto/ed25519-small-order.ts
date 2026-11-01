import { createHash } from "node:crypto";

// Small-order Ed25519 points, in the RFC 8032 encoding, as a public key or as
// the R half of a signature. The cofactorless verify equation
// [S]B = R + [h]A holds for every message when A and R are small-order and
// S = 0 (with h chosen to be a multiple of the point order), so a verifier
// that does not reject these points accepts a forged signature for any
// message under such a key. Node rejects all of them (nodejs/node#64026).
//
// `message` is a message for which the unfiltered equation holds with
// R = identity and S = 0 (`messageAsR`: with R = A and S = 0).

export const ED25519_IDENTITY = "0100000000000000000000000000000000000000000000000000000000000000";

export const ED25519_SMALL_ORDER_POINTS: { name: string; hex: string; message: string; messageAsR?: string }[] = [
  { name: "identity", hex: ED25519_IDENTITY, message: "msg 0", messageAsR: "msg 0" },
  {
    name: "order 2",
    hex: "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    message: "msg 1",
    messageAsR: "msg 0",
  },
  {
    name: "order 4 (a)",
    hex: "0000000000000000000000000000000000000000000000000000000000000080",
    message: "msg 0",
    messageAsR: "msg 3",
  },
  {
    name: "order 4 (b)",
    hex: "0000000000000000000000000000000000000000000000000000000000000000",
    message: "msg 1",
    messageAsR: "msg 1",
  },
  {
    name: "order 8 (a)",
    hex: "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
    message: "msg 1",
    messageAsR: "msg 6",
  },
  {
    name: "order 8 (b)",
    hex: "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
    message: "msg 1",
    messageAsR: "msg 7",
  },
  {
    name: "order 8 (c)",
    hex: "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
    message: "msg 1",
    messageAsR: "msg 1",
  },
  {
    name: "order 8 (d)",
    hex: "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
    message: "msg 7",
    messageAsR: "msg 13",
  },
  // Non-canonical encodings of the same points. BoringSSL decodes y >= p
  // (reduced mod p) and x = 0 with the sign bit set, so each of these is
  // accepted as a public key. None of them can appear as R: ED25519_verify
  // re-encodes R canonically and compares the bytes.
  {
    name: "identity (x = 0, sign bit set)",
    hex: "0100000000000000000000000000000000000000000000000000000000000080",
    message: "msg 0",
  },
  {
    name: "order 2 (x = 0, sign bit set)",
    hex: "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    message: "msg 0",
  },
  {
    name: "identity (y = p + 1)",
    hex: "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    message: "msg 0",
  },
  {
    name: "identity (y = p + 1, sign bit set)",
    hex: "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    message: "msg 0",
  },
  {
    name: "order 4 (y = p, sign bit set)",
    hex: "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    message: "msg 8",
  },
  {
    name: "order 4 (y = p)",
    hex: "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    message: "msg 8",
  },
];

export function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

// Signature with the given R and S = 0.
export function zeroSignatureWithR(rHex: string): Uint8Array {
  const signature = new Uint8Array(64);
  signature.set(hexBytes(rHex), 0);
  return signature;
}

const L = 2n ** 252n + 27742317777372353535851937790883648493n;

function scalarFromLE(bytes: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(bytes).reverse().toString("hex"));
}

function scalarToLE(scalar: bigint): Uint8Array {
  return Uint8Array.from(Buffer.from(scalar.toString(16).padStart(64, "0"), "hex").reverse());
}

// The secret scalar a of a seed (RFC 8032, section 5.1.5). The public key of the seed is [a]B.
function scalarOfSeed(seed: Uint8Array): bigint {
  const aBytes = Uint8Array.from(createHash("sha512").update(seed).digest().subarray(0, 32));
  aBytes[0] &= 248;
  aBytes[31] &= 127;
  aBytes[31] |= 64;
  return scalarFromLE(aBytes);
}

// A signature under an honest key pair whose R is the identity point:
// R = [0]B, so S = h * a mod L with h = SHA-512(R || A || M) satisfies
// [S]B = R + [h]A. The cofactorless check alone accepts it. Only the key
// owner can build it, so it is not a forgery, but a strict verifier (Node,
// libsodium, ed25519-dalek verify_strict) rejects a small-order R.
// `privateJwk` is the jwk export of the private key (d = seed, x = A).
export function identityRSignature(privateJwk: { d?: string; x?: string }, message: Uint8Array): Uint8Array {
  const a = scalarOfSeed(Buffer.from(privateJwk.d!, "base64url"));
  const A = Buffer.from(privateJwk.x!, "base64url");
  const R = hexBytes(ED25519_IDENTITY);
  const h = scalarFromLE(createHash("sha512").update(R).update(A).update(message).digest()) % L;
  const signature = new Uint8Array(64);
  signature.set(R, 0);
  signature.set(scalarToLE((h * a) % L), 32);
  return signature;
}

// RFC 8032, section 7.1, TEST 1: a seed and its public key [a]B, a point of prime order.
export const ED25519_HONEST_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const ED25519_HONEST_POINT = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

// A forged signature under the small-order public key `hex` whose R is not
// small-order, so that only the check on the public key can reject it.
// R = [a]B and S = a for the honest scalar a above. The message is the first
// "msg N" for which h = SHA-512(R || A || M) mod L is a multiple of 8. Then
// [h]A is the identity for every small-order A, and the unfiltered equation
// [S]B = R + [h]A holds.
export function forgeryWithHonestR(hex: string): { message: Uint8Array; signature: Uint8Array } {
  const R = hexBytes(ED25519_HONEST_POINT);
  const A = hexBytes(hex);
  const signature = new Uint8Array(64);
  signature.set(R, 0);
  signature.set(scalarToLE(scalarOfSeed(hexBytes(ED25519_HONEST_SEED)) % L), 32);
  for (let i = 0; i < 256; i++) {
    const message = Uint8Array.from(Buffer.from(`msg ${i}`));
    const h = scalarFromLE(createHash("sha512").update(R).update(A).update(message).digest()) % L;
    if (h % 8n === 0n) return { message, signature };
  }
  throw new Error(`no message makes h a multiple of 8 for ${hex}`);
}
