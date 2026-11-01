import { expectType } from "./utilities";

crypto.getRandomValues(new Uint8Array(1));

// TODO(@alii): Failing with @types/node@22.15.0
// crypto.subtle.deriveKey(
//   "HMAC",
//   await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), "HMAC", false, ["deriveKey"]),
//   { name: "HMAC", hash: "SHA-256" },
//   false,
//   ["sign", "verify"],
// );

await crypto.subtle.generateKey("HMAC", false, ["sign", "verify"]);
expectType<CryptoKeyPair>(
  await crypto.subtle.generateKey({ namedCurve: "Ed25519" } as import("node:crypto").webcrypto.EcKeyGenParams, false, [
    "sign",
    "verify",
  ]),
);

declare const key: CryptoKey;

crypto.subtle.digest("SHA-256", new TextEncoder().encode("secret"));
crypto.subtle.exportKey("jwk", key);
crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), "HMAC", false, ["sign", "verify"]);
crypto.subtle.encrypt("AES-CBC", key, new TextEncoder().encode("secret"));
crypto.subtle.decrypt("AES-CBC", key, new TextEncoder().encode("secret"));

expectType(crypto.getRandomValues(new Uint8Array(1))).is<Uint8Array<ArrayBuffer>>();
expectType(crypto.subtle.digest("SHA-256", new TextEncoder().encode("secret"))).is<Promise<ArrayBuffer>>();
expectType(crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), "HMAC", false, ["sign", "verify"])).is<
  Promise<CryptoKey>
>();
expectType(crypto.subtle.encrypt("AES-CBC", key, new TextEncoder().encode("secret"))).is<Promise<ArrayBuffer>>();
expectType(crypto.subtle.decrypt("AES-CBC", key, new TextEncoder().encode("secret"))).is<Promise<ArrayBuffer>>();

expectType(crypto.randomUUID()).is<`${string}-${string}-${string}-${string}-${string}`>();
expectType(
  crypto.timingSafeEqual(new TextEncoder().encode("secret"), new TextEncoder().encode("secret")),
).is<boolean>();

// SubtleCrypto.supports() is a static method. These calls have type errors when
// lib.dom.d.ts is present: its `declare var SubtleCrypto` wins, and it has no
// `supports` yet.
declare const hkdfParams: import("node:crypto").webcrypto.HkdfParams;
declare const operation: string;
declare const lengthOrAlgorithm: number | import("node:crypto").webcrypto.AlgorithmIdentifier | null;

expectType(SubtleCrypto.supports("digest", "SHA-256")).is<boolean>();
SubtleCrypto.supports("generateKey", { name: "HMAC", hash: "SHA-256" });
SubtleCrypto.supports("deriveBits", hkdfParams, 256);
SubtleCrypto.supports("deriveBits", hkdfParams, null);
SubtleCrypto.supports("deriveKey", hkdfParams, { name: "AES-GCM", length: 256 });
SubtleCrypto.supports(operation, hkdfParams, lengthOrAlgorithm);

// @ts-expect-error - an algorithm is required
SubtleCrypto.supports("digest");
// @ts-expect-error - an operation is a name
SubtleCrypto.supports(1, "SHA-256");
// @ts-expect-error - an algorithm is a name, or a dictionary
SubtleCrypto.supports("digest", 256);
// @ts-expect-error - a dictionary needs a name
SubtleCrypto.supports("digest", { hash: "SHA-256" });
// @ts-expect-error - the second algorithm needs a name too
SubtleCrypto.supports("deriveKey", hkdfParams, { length: 256 });
// @ts-expect-error - a bigint length throws a TypeError
SubtleCrypto.supports("deriveBits", hkdfParams, 256n);
// @ts-expect-error - supports() is not an instance method
crypto.subtle.supports("digest", "SHA-256");
