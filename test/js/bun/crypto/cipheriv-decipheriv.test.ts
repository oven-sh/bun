import { expect, it } from "bun:test";
import { BinaryLike, CipherGCM, createCipheriv, createDecipheriv, DecipherGCM, randomBytes } from "crypto";

/**
 * Perform a sample encryption and decryption
 * @param algo Algorithm to use
 * @param key Encryption key
 * @param iv Initialization vector if applicable
 */
const sampleEncryptDecrypt = (algo: string, key: BinaryLike, iv: BinaryLike | null): boolean => {
  const plaintext = "Out of the mountain of despair, a stone of hope.";

  const cipher = createCipheriv(algo, key, iv);
  let ciph = cipher.update(plaintext, "utf8", "hex");
  ciph += cipher.final("hex");

  const decipher = createDecipheriv(algo, key, iv);
  let txt = decipher.update(ciph, "hex", "utf8");
  txt += decipher.final("utf8");

  return plaintext === txt;
};

/**
 * Perform a sample encryption and decryption
 * @param algo Algorithm to use
 * @param key Encryption key
 * @param iv Initialization vector if applicable
 */
const sampleEncryptDecryptGCM = (algo: string, key: BinaryLike, iv: BinaryLike | null): boolean => {
  const plaintext = "Out of the mountain of despair, a stone of hope.";

  const cipher = createCipheriv(algo, key, iv) as import("crypto").CipherGCM;
  let ciph = cipher.update(plaintext, "utf8", "hex");
  ciph += cipher.final("hex");

  const decipher = createDecipheriv(algo, key, iv) as import("crypto").DecipherGCM;
  decipher.setAuthTag(cipher.getAuthTag());
  let txt = decipher.update(ciph, "hex", "utf8");
  txt += decipher.final("utf8");

  return plaintext === txt;
};

it("should encrypt & decrypt using update & final interface", () => {
  const plaintext = "Out of the mountain of despair, a stone of hope.";

  const key = randomBytes(32);
  const iv = randomBytes(16);

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let ciph = cipher.update(plaintext, "utf8", "hex");
  ciph += cipher.final("hex");

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  let txt = decipher.update(ciph, "hex", "utf8");
  txt += decipher.final("utf8");

  expect(txt).toBe(plaintext);
});

it("should encrypt & decrypt using streaming interface", () => {
  const plaintext = "Out of the mountain of despair, a stone of hope.";

  const key = randomBytes(32);
  const iv = randomBytes(16);

  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.end(plaintext);
  let ciph = cipher.read();

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.end(ciph);
  let txt = decipher.read().toString("utf8");

  expect(txt).toBe(plaintext);
});

it("should fail when cipher is not defined", () => {
  expect(() => createCipheriv(null as unknown as string, randomBytes(32), randomBytes(16))).toThrow();
});

it("should fail when key is not defined", () => {
  expect(() => createCipheriv("aes-256-cbc", null as unknown as BinaryLike, randomBytes(16))).toThrow();
});

it("should fail when iv is not defined", () => {
  expect(() => createCipheriv("aes-256-cbc", randomBytes(32), null as unknown as BinaryLike)).toThrow();
});

it("should fail when key length is invalid", () => {
  expect(() => createCipheriv("aes-128-cbc", randomBytes(15), randomBytes(16))).toThrow();
  expect(() => createCipheriv("aes-256-cbc", randomBytes(31), randomBytes(16))).toThrow();
  expect(() => createCipheriv("aes-192-cbc", randomBytes(23), randomBytes(12))).toThrow();
});

it("should fail when iv length is invalid", () => {
  expect(() => createCipheriv("aes-128-cbc", randomBytes(16), randomBytes(15))).toThrow();
  expect(() => createCipheriv("aes-256-cbc", randomBytes(16), randomBytes(31))).toThrow();
  expect(() => createCipheriv("aes-192-cbc", randomBytes(16), randomBytes(11))).toThrow();
});

it("only zero-sized iv or null should be accepted in ECB mode", () => {
  expect(sampleEncryptDecrypt("aes-128-ecb", randomBytes(16), Buffer.alloc(0))).toBe(true);
  expect(sampleEncryptDecrypt("aes-128-ecb", randomBytes(16), null)).toBe(true);
  expect(() => createCipheriv("aes-128-ecb", randomBytes(16), randomBytes(16))).toThrow();
});

it("should allow only valid iv lengths in GCM mode", () => {
  expect(sampleEncryptDecryptGCM("aes-256-gcm", randomBytes(32), randomBytes(1))).toBe(true);
  expect(sampleEncryptDecryptGCM("aes-256-gcm", randomBytes(32), randomBytes(96))).toBe(true);
});

const referencePlaintext = "Out of the mountain of despair, a stone of hope.";

const references = {
  "aes-128-ecb": {
    iv: "",
    key: "cd44a845618733f41669b81ec91ba2f0",
    ciphertext:
      "6df4d1e637cca154462e2a7436312b03055cd08a3cc57edc0c1296940c4ec50348f2c25c667986d80a7e979a4c720ca00bff25383c2b2bc5e4c5aa82e785c165",
    authTag: null,
  },
  "aes-128-cbc": {
    iv: "43a5e1e3b0a716aa8b9a1574b2ac86ad",
    key: "c88964a004457c1f49b641f8a6bbf5d8",
    ciphertext:
      "92482a5a78b2a657c8c1f20d37457d652c8d0b0220d493bfaacb8835159d910d69df3b10be67589e85a0a9114ea3fd2fccff835f861a4297cc3bd6b4a65b4589",
    authTag: null,
  },
  aes128: {
    iv: "ab0c635f3f86ac997fb556f9b7fe8e76",
    key: "c91eb04c29d58b34669cf717e4acecbb",
    ciphertext:
      "72855bf0d5744eeb5772221df2ebd3c966f8712cdd207fbd265b9a45cc9d6df8cad41972650503a0dbfc672ff4093fec1238fd0ad960a4be15b2d599d1fc12ac",
    authTag: null,
  },
  "aes-128-cfb": {
    iv: "608a3a6ba9c3aa0ba90be65fa5df03aa",
    key: "ee235a102b6bca616a65d0ca74b238d7",
    ciphertext: "8497dba3f7f3252e7f5f3cf2c49c5e16cd83da98a942532537a77283afb875ec5a865020ced4242615edb7ec2eaf7e6c",
    authTag: null,
  },
  "aes-128-cfb8": {
    iv: "3021d44812302ae0312c9ef523f01bf5",
    key: "20787258b5d2a166262ecc6e3e917a58",
    ciphertext: "db4596b2f0d7a74bea91a1d715e1327ca149591f5bc64d19fde7138eacfa5dd0da503596dcc66bc771edcf14b6eb8f69",
    authTag: null,
  },
  "aes-128-cfb1": {
    iv: "c91453a0182f1efeeb4525ed96b0aad3",
    key: "26bfaea72f720475528cc5b2bfd5cf2e",
    ciphertext: "5d3f5c646140be734f9283e67759f8b06340cc96a8bb21b591cfd43a48cc2941decdd9b4aea13b7c5c7a48d443c8d384",
    authTag: null,
  },
  "aes-128-ofb": {
    iv: "ca6bf9503134e3a4bad0890a973d4189",
    key: "f4687e40072a015e25d927e13b7318c4",
    ciphertext: "281d5e352b1b093de2918c4db8e4065e2e911515ca7583ebb0206d0149bfac1e4ad15d120d708c543171bd908ce290a2",
    authTag: null,
  },
  "aes-128-ctr": {
    iv: "a934743ec98c1c4d335bdba13c05a2f4",
    key: "74d127cd01a0615761d94b69f82846eb",
    ciphertext: "a61309b2bb64dc900961136daa502f607b36854f766f8db5fa4a0d5fd4c969209f942d0727ce11c0c7e48b11c840d9c4",
    authTag: null,
  },
  "aes-128-gcm": {
    iv: "3941a463832c24e6d9dd3698652b6698",
    key: "83d0dbb3e74480502f3532ae3462532f",
    ciphertext: "85a0b803d532e2a810a2e4737136d33dece7f8b8d9ce32e1a875677b7889d90cd8082ba35e23ddb70e87d965feedf3f0",
    authTag: "60c15ca251ffe5578b6cb06feb45f2b9",
  },
};

it("should encrypt & decrypt well-known values", () => {
  Object.entries(references).forEach(([algo, params]) => {
    const decipher = createDecipheriv(
      algo,
      Buffer.from(params.key, "hex"),
      Buffer.from(params.iv, "hex"),
    ) as DecipherGCM;
    if (params.authTag) {
      decipher.setAuthTag(Buffer.from(params.authTag, "hex"));
    }

    let plaintext = decipher.update(params.ciphertext, "hex", "utf8");
    plaintext += decipher.final("utf8");

    expect(plaintext).toBe(referencePlaintext);

    const cipher = createCipheriv(algo, Buffer.from(params.key, "hex"), Buffer.from(params.iv, "hex")) as CipherGCM;
    let ciphertext = cipher.update(referencePlaintext, "utf8", "hex");
    ciphertext += cipher.final("hex");

    expect(ciphertext).toBe(params.ciphertext);
    if (params.authTag) {
      expect(cipher.getAuthTag().toString("hex")).toBe(params.authTag);
    }
  });
});
