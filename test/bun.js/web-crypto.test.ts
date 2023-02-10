import { describe, expect, it, beforeAll } from "bun:test";

type Ed25519KeyPair = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

describe("Web Crypto", () => {
  it("has globals", () => {
    expect(crypto.subtle !== undefined).toBe(true);
    expect(CryptoKey.name).toBe("CryptoKey");
    expect(SubtleCrypto.name).toBe("SubtleCrypto");
  });
  it("should encrypt and decrypt", async () => {
    const key = await crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode("Hello World!");
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      data,
    );
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      encrypted,
    );
    expect(new TextDecoder().decode(decrypted)).toBe("Hello World!");
  });

  it("should verify and sign", async () => {
    async function importKey(secret) {
      return await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    }

    async function signResponse(message, secret) {
      const key = await importKey(secret);
      const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));

      // Convert ArrayBuffer to Base64
      return btoa(String.fromCharCode(...new Uint8Array(signature)));
    }

    async function verifySignature(message, signature, secret) {
      const key = await importKey(secret);

      // Convert Base64 to Uint8Array
      const sigBuf = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

      return await crypto.subtle.verify("HMAC", key, sigBuf, new TextEncoder().encode(message));
    }

    const msg = `hello world`;
    const SECRET = "secret";
    const signature = await signResponse(msg, SECRET);

    const isSigValid = await verifySignature(msg, signature, SECRET);
    expect(isSigValid).toBe(true);
  });

  describe("Ed25519", () => {
    let importedKeypair: Ed25519KeyPair;

    describe("generateKey", () => {
      it("should generate key pair", async () => {
        const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as Ed25519KeyPair;
        expect(keyPair.privateKey).toBeDefined();
        expect(keyPair.privateKey instanceof CryptoKey).toBe(true);
        expect(keyPair.publicKey).toBeDefined();
        expect(keyPair.publicKey instanceof CryptoKey).toBe(true);
      });

      it("should generate an extractable key pair", async () => {
        const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as Ed25519KeyPair;
        const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
        const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

        expect(privateKey).toBeDefined();
        expect(privateKey.d).toBeDefined();
        expect(privateKey.x).toBeDefined();
        expect(privateKey.x!.length).toBe(43);
        expect(privateKey.d!.length).toBe(43);
        expect(privateKey.kty).toEqual("OKP");
        expect(privateKey.crv).toEqual("Ed25519");
        expect(privateKey.ext).toBe(true);
        expect(privateKey.key_ops).toStrictEqual(["sign"]);

        expect(publicKey).toBeDefined();
        expect(publicKey.x).toBeDefined();
        expect(publicKey.x!.length).toBe(43);
        expect(publicKey.kty).toEqual("OKP");
        expect(publicKey.crv).toEqual("Ed25519");
        expect(publicKey.ext).toBe(true);
        expect(publicKey.key_ops).toStrictEqual(["verify"]);
      });

      it("should generate an nonextractable private key", async done => {
        const keyPair = (await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"])) as Ed25519KeyPair;
        expect(keyPair.privateKey).toBeDefined();
        expect(keyPair.publicKey).toBeDefined();
        try {
          await crypto.subtle.exportKey("jwk", keyPair.privateKey);
          done(new Error("Should not be able to export private key"));
        } catch (e) {
          if (!(e instanceof Error)) {
            process.exit(1);
          } else {
            expect(e.message).toBe("The CryptoKey is nonextractable");
            done();
          }
        }
      });

      it("should generate keys with correct usages", async () => {
        const keyPair1 = (await crypto.subtle.generateKey("Ed25519", false, ["sign"])) as Ed25519KeyPair;
        const keyPair2 = (await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"])) as Ed25519KeyPair;

        expect(keyPair1.privateKey?.usages).toBeDefined();
        expect(keyPair1.publicKey?.usages).toBeDefined();
        expect(keyPair1.privateKey?.usages).toStrictEqual(["sign"]);
        expect(keyPair1.publicKey?.usages).toStrictEqual([]);

        expect(keyPair2.privateKey?.usages).toBeDefined();
        expect(keyPair2.publicKey?.usages).toBeDefined();
        expect(keyPair2.privateKey?.usages).toEqual(["sign"]);
        expect(keyPair2.publicKey?.usages).toEqual(["verify"]);
      });
    });

    describe("importKey", () => {
      it("should do raw import", async () => {
        const privateKey = "whvdISVptebNycNBnzsGltGsSWhThuD-mP2tcsBbNt8";
        const buf = Buffer.from(privateKey, "base64url");
        console.log(buf);
        const imported = await crypto.subtle.importKey("raw", buf, "Ed25519", false, ["sign", "verify"]);
      });

      it("should do JWK import", async () => {
        const kp = await crypto.subtle.importKey(
          "jwk",
          {
            kty: "OKP",
            d: "whvdISVptebNycNBnzsGltGsSWhThuD-mP2tcsBbNt8",
            use: "sig",
            crv: "Ed25519",
            // kid: "sig-1675587884",
            x: "jZJN1eHyhwujYgS9btOxrSGJuVrWVmJMmkovz6vmmJQ",
            alg: "EdDSA",
            ext: true,
          },
          "Ed25519",
          true,
          ["sign"],
        );
      });

      it("should do PKCS8 import", () => {});
    });
  });
});
