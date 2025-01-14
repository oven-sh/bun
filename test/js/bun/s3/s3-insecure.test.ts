import { describe, it, expect } from "bun:test";
import { S3Client } from "bun";

describe("s3", async () => {
  it("should not fail to connect when endpoint is http and not https", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response("<>lol!", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 400,
        });
      },
    });

    const s3 = new S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      endpoint: server.url.href,
      bucket: "test",
    });

    const file = s3.file("hello.txt");
    let err;
    try {
      await file.text();
    } catch (e) {
      err = e;
    }
    // Test we don't get ConnectionRefused
    expect(err.code!).toBe("UnknownError");
  });
});
