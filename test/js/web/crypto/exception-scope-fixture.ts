// Exercises every SubtleCrypto operation on both its success and its normalize-failure
// path. Run with BUN_JSC_validateExceptionChecks=1 on a debug build: any unchecked JSC
// throw scope kills the process, truncating the expected output.

const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
  "encrypt",
  "decrypt",
  "wrapKey",
  "unwrapKey",
]);
const kw = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, true, ["wrapKey", "unwrapKey"]);
const hm = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign", "verify"]);
const hmVerifyOnly = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
const hmNonExtractable = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const pb = await crypto.subtle.importKey("raw", new Uint8Array(16), "PBKDF2", false, ["deriveKey", "deriveBits"]);
// 16 bytes (AES-KW needs a multiple of 8) that are not valid JSON once unwrapped.
const raw16 = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode("definitely-not-a"),
  { name: "HMAC", hash: "SHA-256" },
  true,
  ["sign"],
);
const iv = new Uint8Array(12);
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new Uint8Array(8));
const sig = await crypto.subtle.sign("HMAC", hm, new Uint8Array(8));
const pbkdf2 = { name: "PBKDF2", salt: new Uint8Array(8), iterations: 1, hash: "SHA-256" };

const bad = { name: "bogus" };
const badHash = { name: "HMAC", hash: { name: "bogus" } };
const thrower = {
  get name(): string {
    throw new Error("boom");
  },
};

const cases: Record<string, () => Promise<unknown>> = {
  "encrypt ok": () => crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new Uint8Array(8)),
  "encrypt bogus": () => crypto.subtle.encrypt(bad, aes, new Uint8Array(8)),
  "encrypt thrower": () => crypto.subtle.encrypt(thrower, aes, new Uint8Array(8)),

  "decrypt ok": () => crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, ct),
  "decrypt bogus": () => crypto.subtle.decrypt(bad, aes, ct),
  // Normalization succeeds; AES-GCM rejects 3 bytes (shorter than the auth tag) via the
  // synchronous exceptionCallback, with the caller's throw scope still live.
  "decrypt op failure": () => crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, new Uint8Array(3)),

  "sign ok": () => crypto.subtle.sign("HMAC", hm, new Uint8Array(8)),
  "sign bogus": () => crypto.subtle.sign(bad, hm, new Uint8Array(8)),
  "sign usage missing": () => crypto.subtle.sign("HMAC", hmVerifyOnly, new Uint8Array(8)),

  "verify ok": () => crypto.subtle.verify("HMAC", hm, sig, new Uint8Array(8)),
  "verify bogus": () => crypto.subtle.verify(bad, hm, sig, new Uint8Array(8)),

  "digest ok": () => crypto.subtle.digest("SHA-256", new Uint8Array(4)),
  "digest bogus": () => crypto.subtle.digest("bogus", new Uint8Array(4)),
  "digest thrower": () => crypto.subtle.digest(thrower, new Uint8Array(4)),

  "generateKey ok": () => crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  "generateKey bogus": () => crypto.subtle.generateKey(bad, false, ["sign"]),
  "generateKey nested bogus hash": () => crypto.subtle.generateKey(badHash, false, ["sign"]),
  "generateKey thrower": () => crypto.subtle.generateKey(thrower, false, ["sign"]),

  "deriveKey ok": () => crypto.subtle.deriveKey(pbkdf2, pb, { name: "AES-GCM", length: 256 }, false, ["encrypt"]),
  "deriveKey bogus algorithm": () =>
    crypto.subtle.deriveKey(bad, pb, { name: "AES-GCM", length: 256 }, false, ["encrypt"]),
  "deriveKey bogus derived type": () => crypto.subtle.deriveKey(pbkdf2, pb, bad, false, ["encrypt"]),
  "deriveKey importable but no key length": () =>
    crypto.subtle.deriveKey(pbkdf2, pb, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),

  "deriveBits ok": () => crypto.subtle.deriveBits(pbkdf2, pb, 64),
  "deriveBits bogus": () => crypto.subtle.deriveBits(bad, pb, 64),

  "importKey ok": () =>
    crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  "importKey bogus": () => crypto.subtle.importKey("raw", new Uint8Array(16), bad, false, ["sign"]),
  "importKey nested bogus hash": () => crypto.subtle.importKey("raw", new Uint8Array(16), badHash, false, ["sign"]),
  "importKey thrower": () => crypto.subtle.importKey("raw", new Uint8Array(16), thrower, false, ["sign"]),

  "exportKey raw": () => crypto.subtle.exportKey("raw", aes),
  "exportKey jwk": () => crypto.subtle.exportKey("jwk", aes),

  "wrapKey raw": () => crypto.subtle.wrapKey("raw", hm, kw, "AES-KW"),
  "wrapKey jwk": () => crypto.subtle.wrapKey("jwk", hm, kw, "AES-KW"),
  "wrapKey via encrypt": () => crypto.subtle.wrapKey("raw", hm, aes, { name: "AES-GCM", iv }),
  "wrapKey bogus": () => crypto.subtle.wrapKey("raw", hm, kw, bad),
  "wrapKey thrower": () => crypto.subtle.wrapKey("raw", hm, kw, thrower),
  "wrapKey non-extractable": () => crypto.subtle.wrapKey("raw", hmNonExtractable, kw, "AES-KW"),
  // wrapKey("jwk", ...) serializes the exported JWK with JSON.stringify, which invokes an
  // inherited Object.prototype.toJSON. That throw lands between the synchronous export
  // callback's toJS<IDLDictionary<JsonWebKey>> and the AES-KW wrap.
  "wrapKey jwk with throwing Object.prototype.toJSON": async () => {
    (Object.prototype as any).toJSON = () => {
      throw new Error("poisoned toJSON");
    };
    try {
      return await crypto.subtle.wrapKey("jwk", hm, kw, "AES-KW");
    } finally {
      delete (Object.prototype as any).toJSON;
    }
  },

  "unwrapKey raw": async () => {
    const wrapped = await crypto.subtle.wrapKey("raw", hm, kw, "AES-KW");
    return crypto.subtle.unwrapKey("raw", wrapped, kw, "AES-KW", { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  },
  "unwrapKey jwk": async () => {
    const wrapped = await crypto.subtle.wrapKey("jwk", hm, kw, "AES-KW");
    return crypto.subtle.unwrapKey("jwk", wrapped, kw, "AES-KW", { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  },
  "unwrapKey via decrypt": async () => {
    const wrapped = await crypto.subtle.wrapKey("raw", hm, aes, { name: "AES-GCM", iv });
    return crypto.subtle.unwrapKey(
      "raw",
      wrapped,
      aes,
      { name: "AES-GCM", iv },
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  },
  "unwrapKey jwk not json": async () => {
    const wrapped = await crypto.subtle.wrapKey("raw", raw16, kw, "AES-KW");
    return crypto.subtle.unwrapKey("jwk", wrapped, kw, "AES-KW", { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  },
  "unwrapKey bogus unwrap algorithm": () =>
    crypto.subtle.unwrapKey("raw", new Uint8Array(40), kw, bad, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  "unwrapKey bogus unwrapped type": () =>
    crypto.subtle.unwrapKey("raw", new Uint8Array(40), kw, "AES-KW", bad, false, ["sign"]),
  // AES-KW rejects an all-zero payload via the synchronous exceptionCallback: normalization
  // succeeded, so this reaches the post-normalize reject path.
  "unwrapKey bad integrity": () =>
    crypto.subtle.unwrapKey("raw", new Uint8Array(24), kw, "AES-KW", { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]),
};

for (const [name, run] of Object.entries(cases)) {
  try {
    await run();
    console.log(`${name} = RESOLVED`);
  } catch (e: any) {
    console.log(`${name} = REJECTED ${e?.name}: ${e?.message}`);
  }
}
