import { expect, test } from "bun:test";
import crypto from "node:crypto";

test("crypto.Sign should handle JWK EC keys with ieee-p1363 encoding", () => {
  const jwkKey = {
    kty: "EC",
    crv: "P-256",
    x: "UachlYxCg48kyuIpXA7RRci2bb99E7izkzDQfX1sc6U",
    y: "umhCJJQF5niKkNIvna0egspwqEPc0XiuJ0vmpMOKdSg",
    d: "g_AptXAXWjIrPcyXQWW16JZdSV65Np7DOQxTl-SNhDQ",
  };

  // Test data to sign
  const data = Uint8Array.from([
    48, 130, 1, 60, 160, 3, 2, 1, 2, 2, 1, 0, 48, 10, 6, 8, 42, 134, 72, 206, 61, 4, 3, 2, 48, 34, 49, 32, 48, 30, 6,
    10, 43, 6, 1, 4, 1, 130, 162, 124, 1, 4, 12, 16, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48,
    30, 23, 13, 50, 52, 48, 56, 48, 49, 50, 51, 52, 57, 48, 53, 90, 23, 13, 51, 53, 48, 55, 51, 48, 50, 51, 52, 57, 48,
    53, 90, 48, 34, 49, 32, 48, 30, 6, 10, 43, 6, 1, 4, 1, 130, 162, 124, 1, 4, 12, 16, 48, 48, 48, 48, 48, 48, 48, 48,
    48, 48, 48, 48, 48, 48, 48, 48, 48, 89, 48, 19, 6, 7, 42, 134, 72, 206, 61, 2, 1, 6, 8, 42, 134, 72, 206, 61, 3, 1,
    7, 3, 66, 0, 4, 81, 167, 33, 149, 140, 66, 131, 143, 36, 202, 226, 41, 92, 14, 209, 69, 200, 182, 109, 191, 125, 19,
    184, 179, 147, 48, 208, 125, 125, 108, 115, 165, 186, 104, 66, 36, 148, 5, 230, 120, 138, 144, 210, 47, 157, 173,
    30, 130, 202, 112, 168, 67, 220, 209, 120, 174, 39, 75, 230, 164, 195, 138, 117, 40, 163, 99, 48, 97, 48, 15, 6, 3,
    85, 29, 19, 1, 1, 255, 4, 5, 48, 3, 1, 1, 255, 48, 14, 6, 3, 85, 29, 15, 1, 1, 255, 4, 4, 3, 2, 1, 6, 48, 29, 6, 3,
    85, 29, 14, 4, 22, 4, 20, 26, 32, 165, 220, 165, 110, 20, 1, 152, 7, 131, 164, 65, 149, 192, 89, 122, 219, 37, 252,
    48, 31, 6, 3, 85, 29, 35, 4, 24, 48, 22, 128, 20, 26, 32, 165, 220, 165, 110, 20, 1, 152, 7, 131, 164, 65, 149, 192,
    89, 122, 219, 37, 252,
  ]);

  // Test signing with ieee-p1363 encoding
  const signer = crypto.createSign("sha256");
  signer.update(data);

  const signature = signer.sign({
    key: jwkKey,
    format: "jwk",
    type: "pkcs8",
    dsaEncoding: "ieee-p1363",
  });

  // IEEE P1363 format for P-256 should be exactly 64 bytes (32 bytes for r, 32 bytes for s)
  expect(signature.length).toBe(64);
  expect(signature).toBeInstanceOf(Buffer);
});

test("crypto.Sign should handle JWK EC keys with different encodings", () => {
  const jwkKey = {
    kty: "EC",
    crv: "P-256",
    x: "UachlYxCg48kyuIpXA7RRci2bb99E7izkzDQfX1sc6U",
    y: "umhCJJQF5niKkNIvna0egspwqEPc0XiuJ0vmpMOKdSg",
    d: "g_AptXAXWjIrPcyXQWW16JZdSV65Np7DOQxTl-SNhDQ",
  };

  const testData = "test data to sign";

  // Test without dsaEncoding (default is 'der')
  {
    const signer = crypto.createSign("sha256");
    signer.update(testData);
    const signature = signer.sign({
      key: jwkKey,
      format: "jwk",
    });
    expect(signature).toBeInstanceOf(Buffer);
    // DER format has variable length due to encoding
    expect(signature.length).toBeGreaterThan(0);
    expect(signature.length).toBeLessThanOrEqual(72); // Max DER size for P-256
  }

  // Test with explicit dsaEncoding: 'der'
  {
    const signer = crypto.createSign("sha256");
    signer.update(testData);
    const signature = signer.sign({
      key: jwkKey,
      format: "jwk",
      dsaEncoding: "der",
    });
    expect(signature).toBeInstanceOf(Buffer);
    expect(signature.length).toBeGreaterThan(0);
    expect(signature.length).toBeLessThanOrEqual(72);
  }

  // Test with dsaEncoding: 'ieee-p1363'
  {
    const signer = crypto.createSign("sha256");
    signer.update(testData);
    const signature = signer.sign({
      key: jwkKey,
      format: "jwk",
      dsaEncoding: "ieee-p1363",
    });
    expect(signature).toBeInstanceOf(Buffer);
    expect(signature.length).toBe(64); // Fixed size for P-256 in P1363 format
  }

  // Test with KeyObject and ieee-p1363
  {
    const privateKey = crypto.createPrivateKey({
      key: jwkKey,
      format: "jwk",
      type: "pkcs8",
    });

    const signer = crypto.createSign("sha256");
    signer.update(testData);
    const signature = signer.sign({
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    expect(signature).toBeInstanceOf(Buffer);
    expect(signature.length).toBe(64);
  }
});
