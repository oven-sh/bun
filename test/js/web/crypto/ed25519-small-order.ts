import { createHash } from "node:crypto";

// Small-order Ed25519 points, in the RFC 8032 encoding, as a public key A or
// as the R half of a signature. The multiples of such a point repeat after at
// most 8 steps. So the cofactorless verify equation [S]B = R + [h]A holds
// with no private key when h = SHA-512(R || A || M) mod L has the right value
// modulo 8, and a verifier that does not reject these points accepts a forged
// signature. Node rejects all of them (nodejs/node#64026).
//
// Each forgery below searches for its own message. So every entry proves
// that the unfiltered equation holds for it.

export const ED25519_IDENTITY = "0100000000000000000000000000000000000000000000000000000000000000";

// `canonical` is false for an encoding that only a lenient decoder accepts: y >= p (BoringSSL reduces it mod p),
// or x = 0 with the sign bit set. Such an encoding can be a public key. It cannot be R, because ED25519_verify
// encodes the R it computes canonically and compares the bytes.
export const ED25519_SMALL_ORDER_POINTS: { name: string; hex: string; canonical: boolean }[] = [
  { name: "identity", hex: ED25519_IDENTITY, canonical: true },
  { name: "order 2", hex: "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", canonical: true },
  { name: "order 4 (a)", hex: "0000000000000000000000000000000000000000000000000000000000000080", canonical: true },
  { name: "order 4 (b)", hex: "0000000000000000000000000000000000000000000000000000000000000000", canonical: true },
  { name: "order 8 (a)", hex: "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", canonical: true },
  { name: "order 8 (b)", hex: "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa", canonical: true },
  { name: "order 8 (c)", hex: "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", canonical: true },
  { name: "order 8 (d)", hex: "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85", canonical: true },
  {
    name: "identity (x = 0, sign bit set)",
    hex: "0100000000000000000000000000000000000000000000000000000000000080",
    canonical: false,
  },
  {
    name: "order 2 (x = 0, sign bit set)",
    hex: "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    canonical: false,
  },
  {
    name: "identity (y = p + 1)",
    hex: "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    canonical: false,
  },
  {
    name: "identity (y = p + 1, sign bit set)",
    hex: "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    canonical: false,
  },
  {
    name: "order 4 (y = p, sign bit set)",
    hex: "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    canonical: false,
  },
  {
    name: "order 4 (y = p)",
    hex: "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    canonical: false,
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

export type Ed25519Forgery = { message: Uint8Array; signature: Uint8Array };

// The first "msg N" whose h = SHA-512(R || A || M) mod L satisfies `holds`.
function forgedMessage(R: Uint8Array, A: Uint8Array, holds: (h: bigint) => boolean): Uint8Array {
  for (let i = 0; i < 256; i++) {
    const message = Uint8Array.from(Buffer.from(`msg ${i}`));
    if (holds(scalarFromLE(createHash("sha512").update(R).update(A).update(message).digest()) % L)) return message;
  }
  throw new Error("no message satisfies the verify equation");
}

// A forged signature under the small-order public key `hex` with R = identity
// and S = 0. [S]B = R + [h]A holds when [h]A is the identity, which is true
// for every small-order A when h is a multiple of 8.
export function forgeryWithIdentityR(hex: string): Ed25519Forgery {
  const message = forgedMessage(hexBytes(ED25519_IDENTITY), hexBytes(hex), h => h % 8n === 0n);
  return { message, signature: zeroSignatureWithR(ED25519_IDENTITY) };
}

// A forged signature under the small-order public key `hex` with R = A and
// S = 0. R + [h]A = [h + 1]A is the identity when h + 1 is a multiple of 8.
export function forgeryWithKeyAsR(hex: string): Ed25519Forgery {
  const A = hexBytes(hex);
  return { message: forgedMessage(A, A, h => (h + 1n) % 8n === 0n), signature: zeroSignatureWithR(hex) };
}

// RFC 8032, section 7.1, TEST 1: a seed and its public key [a]B, a point of prime order.
export const ED25519_HONEST_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const ED25519_HONEST_POINT = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

// A forged signature under the small-order public key `hex` whose R is not
// small-order, so that only the check on the public key can reject it.
// R = [a]B and S = a for the honest scalar a above, and h is a multiple of 8.
// Then [h]A is the identity, and [S]B = R + [h]A holds.
export function forgeryWithHonestR(hex: string): Ed25519Forgery {
  const R = hexBytes(ED25519_HONEST_POINT);
  const signature = new Uint8Array(64);
  signature.set(R, 0);
  signature.set(scalarToLE(scalarOfSeed(hexBytes(ED25519_HONEST_SEED)) % L), 32);
  return { message: forgedMessage(R, hexBytes(hex), h => h % 8n === 0n), signature };
}
