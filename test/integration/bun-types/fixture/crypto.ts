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
