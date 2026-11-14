import crypto from "node:crypto";

console.log(crypto.createHash("sha256").update("abc").digest("hex"));
console.log(crypto.createHmac("sha1", "key").update("abc").digest("base64"));
const secret = crypto.scryptSync("password", "salt", 32);
const initial = Buffer.alloc(12, 7);
const cipher = crypto.createCipheriv("aes-256-gcm", secret, initial);
const sealed = Buffer.concat([cipher.update("a secret"), cipher.final()]);
const decipher = crypto.createDecipheriv("aes-256-gcm", secret, initial).setAuthTag(cipher.getAuthTag());
console.log(sealed.toString("hex"), Buffer.concat([decipher.update(sealed), decipher.final()]).toString());
const pair = crypto.generateKeyPairSync("ed25519");
console.log(
  crypto.verify(null, Buffer.from("signed"), pair.publicKey, crypto.sign(null, Buffer.from("signed"), pair.privateKey)),
  pair.publicKey.asymmetricKeyType,
);
console.log(structuredClone(pair.publicKey).equals(pair.publicKey));
console.log(
  crypto.pbkdf2Sync("password", "salt", 10, 16, "sha512").toString("hex"),
  crypto.randomBytes(8).length,
  crypto.randomUUID().length,
);

const key = await globalThis.crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode("key"),
  { name: "HMAC", hash: "SHA-256" },
  true,
  ["sign"],
);
console.log(
  Buffer.from(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode("abc"))).toString("hex"),
);
console.log(
  Buffer.from(await globalThis.crypto.subtle.digest("SHA-384", new TextEncoder().encode("abc")))
    .toString("hex")
    .slice(0, 32),
);
console.log(structuredClone(key) instanceof CryptoKey, globalThis.crypto.getRandomValues(new Uint8Array(4)).length);

console.log(new Bun.CryptoHasher("blake2b256").update("abc").digest("hex"));
console.log(
  Bun.SHA1.hash("abc", "hex"),
  new Bun.MD5().update("abc").digest("hex"),
  Buffer.from(Bun.sha("abc") as Uint8Array)
    .toString("hex")
    .slice(0, 16),
);
console.log(
  Bun.password.verifySync("a password", Bun.password.hashSync("a password", { algorithm: "bcrypt", cost: 4 })),
);
console.log(
  await Bun.password.verify(
    "a password",
    await Bun.password.hash("a password", { algorithm: "argon2id", memoryCost: 8, timeCost: 1 }),
  ),
);
console.log(Bun.CSRF.verify(Bun.CSRF.generate("a secret"), { secret: "a secret" }));
