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
  // Non-canonical encodings of the same points.
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
    name: "order 4 (a) (y >= p)",
    hex: "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    message: "msg 8",
  },
  {
    name: "order 4 (b) (y >= p)",
    hex: "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    message: "msg 1",
  },
  {
    name: "identity (y >= p, sign bit set)",
    hex: "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    message: "msg 0",
  },
  {
    name: "identity (y >= p)",
    hex: "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    message: "msg 0",
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
