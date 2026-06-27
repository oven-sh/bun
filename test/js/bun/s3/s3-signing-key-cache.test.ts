import { S3Client } from "bun";
import { expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";

// SigV4 derived signing key: HMAC chain over the secret, day, region, service.
function deriveSigningKey(secret: string, day: string, region: string, service: string): Buffer {
  const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request");
}

// Re-derive a presigned GET URL's signature from the secret, the way an S3
// server verifies it, so we can tell which secret a URL was actually signed with.
function referenceSignature(presignedUrl: string, secretAccessKey: string): { got: string; expected: string } {
  const url = new URL(presignedUrl);
  const got = url.searchParams.get("X-Amz-Signature")!;
  const amzDate = url.searchParams.get("X-Amz-Date")!;
  const [, day, region, service] = url.searchParams.get("X-Amz-Credential")!.split("/");
  const canonicalQuery = url.search
    .slice(1)
    .split("&")
    .filter(pair => !pair.startsWith("X-Amz-Signature="))
    .sort()
    .join("&");
  const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join(
    "\n",
  );
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${day}/${region}/${service}/aws4_request`,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const expected = createHmac("sha256", deriveSigningKey(secretAccessKey, day, region, service))
    .update(stringToSign)
    .digest("hex");
  return { got, expected };
}

// https://docs.aws.amazon.com/general/latest/gr/signature-v4-examples.html
test("SigV4 reference key derivation matches the AWS documented example", () => {
  expect(
    deriveSigningKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam").toString("hex"),
  ).toBe("f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
});

test("clients with colliding region+secret concatenations do not share a signing key", () => {
  const endpoint = "https://s3.example.com";
  const bucket = "bkt";
  // Distinct credential sets whose `region + "s3" + secret` concatenations are
  // the same byte string ("rs3s3SECRETX"), which collided in the signing-key cache.
  const a = new S3Client({ region: "r", accessKeyId: "AKIA1", secretAccessKey: "s3SECRETX", bucket, endpoint });
  const b = new S3Client({ region: "rs3", accessKeyId: "AKIA2", secretAccessKey: "SECRETX", bucket, endpoint });

  // `a` signs first so it populates the process-wide signing-key cache before `b`.
  const sigA = referenceSignature(a.presign("key.txt", { method: "GET", expiresIn: 300 }), "s3SECRETX");
  const sigB = referenceSignature(b.presign("key.txt", { method: "GET", expiresIn: 300 }), "SECRETX");

  // Control: proves the reference verifier agrees with Bun's signer.
  expect(sigA.got).toBe(sigA.expected);
  // Fails when `b` signs with `a`'s cached derived key.
  expect(sigB.got).toBe(sigB.expected);
});
