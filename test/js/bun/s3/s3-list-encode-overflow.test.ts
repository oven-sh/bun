import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

describe("S3Client.list() option encoding", () => {
  it.each(["prefix", "delimiter", "continuationToken", "startAfter"])(
    "should not panic when %s is longer than 1024 bytes when encoded",
    async key => {
      // S3 keys may be up to 1024 bytes; percent-encoding can triple that.
      // Previously a fixed 1024-byte stack buffer caused `std.debug.panic` on overflow.
      const value = Buffer.alloc(1024, " ").toString();
      await expect(new S3Client().list({ [key]: value })).rejects.toThrow();
    },
  );
});

describe("S3 object keys containing '?' or '#'", () => {
  it("includes the full object key in the presigned URL path", () => {
    // Keys are signed/encoded locally by presign(); no network request is made.
    const client = new S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "bucket",
      region: "us-east-1",
      endpoint: "https://s3.example.com",
    });

    // A key containing '?' must be percent-encoded into the signed path,
    // not cut off at the '?'.
    {
      const presigned = client.presign("confidential-report.pdf?x=.png");
      const url = new URL(presigned);
      expect(url.pathname).toBe("/bucket/confidential-report.pdf%3Fx%3D.png");
    }

    // A key containing '#' after a '/' must also keep the remainder.
    {
      const presigned = client.presign("reports/2024#final.pdf");
      const url = new URL(presigned);
      expect(url.pathname).toBe("/bucket/reports/2024%23final.pdf");
    }

    // Ordinary keys keep working as before.
    {
      const presigned = client.presign("plain-image.png");
      const url = new URL(presigned);
      expect(url.pathname).toBe("/bucket/plain-image.png");
    }
  });
});
