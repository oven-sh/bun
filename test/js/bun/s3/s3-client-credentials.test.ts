import { S3Client, type S3Options } from "bun";
import { describe, expect, test } from "bun:test";

// `S3Client.file()` and the other per-key methods share the client's
// credentials with the returned S3 file when the call passes no credential
// override. These tests check that the shared credentials sign correctly,
// that an override only applies to its own file, and that a file outlives
// the client it came from.
describe("S3Client credentials", () => {
  const clientOptions: S3Options = {
    accessKeyId: "client-key",
    secretAccessKey: "client-secret",
    region: "eu-west-3",
    bucket: "client-bucket",
  };

  function signer(presigned: string) {
    const url = new URL(presigned);
    const [accessKeyId, , region] = url.searchParams.get("X-Amz-Credential")!.split("/");
    return { host: url.host, pathname: url.pathname, accessKeyId, region };
  }

  const clientSigner = {
    host: "s3.eu-west-3.amazonaws.com",
    pathname: "/client-bucket/dir/file.txt",
    accessKeyId: "client-key",
    region: "eu-west-3",
  };

  test("file() without overrides signs with the client's credentials", () => {
    const client = new S3Client(clientOptions);
    for (let i = 0; i < 50; i++) {
      expect(signer(client.file("dir/file.txt").presign())).toEqual(clientSigner);
    }
    expect(signer(client.presign("dir/file.txt"))).toEqual(clientSigner);
  });

  test("non-credential options keep the client's credentials", () => {
    const client = new S3Client(clientOptions);
    const file = client.file("dir/file.txt", { type: "text/plain", acl: "public-read", partSize: 10 * 1024 * 1024 });
    expect(signer(file.presign())).toEqual(clientSigner);
    expect(file.type).toBe("text/plain;charset=utf-8");
  });

  test("credential overrides apply to that file only", () => {
    const client = new S3Client(clientOptions);
    const before = client.file("dir/file.txt");

    const overridden = client.file("dir/file.txt", {
      accessKeyId: "other-key",
      region: "us-east-1",
      bucket: "other-bucket",
    });
    expect(signer(overridden.presign())).toEqual({
      host: "s3.us-east-1.amazonaws.com",
      pathname: "/other-bucket/dir/file.txt",
      accessKeyId: "other-key",
      region: "us-east-1",
    });
    expect(overridden.bucket).toBe("other-bucket");

    const endpointOverridden = client.file("dir/file.txt", { endpoint: "http://localhost:9000" });
    expect(signer(endpointOverridden.presign())).toEqual({ ...clientSigner, host: "localhost:9000" });

    // Neither the client nor the files created before or after changed.
    expect(signer(before.presign())).toEqual(clientSigner);
    expect(signer(client.file("dir/file.txt").presign())).toEqual(clientSigner);
    expect(signer(client.presign("dir/file.txt"))).toEqual(clientSigner);
    expect(before.bucket).toBe("client-bucket");
  });

  test("a file keeps its credentials after the client is collected", () => {
    const file = (() => {
      const client = new S3Client(clientOptions);
      return client.file("dir/file.txt");
    })();
    Bun.gc(true);
    expect(signer(file.presign())).toEqual(clientSigner);
    expect(file.bucket).toBe("client-bucket");
  });

  test("requests sign with the shared or the overridden credentials", async () => {
    const requests: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const accessKeyId = req.headers.get("authorization")!.match(/Credential=([^/]+)\//)![1];
        requests.push(`${req.method} ${new URL(req.url).pathname} ${accessKeyId}`);
        return new Response("", {
          status: 200,
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": "5",
            "Last-Modified": "Thu, 01 Jan 2026 00:00:00 GMT",
            "ETag": '"etag"',
          },
        });
      },
    });
    const client = new S3Client({ ...clientOptions, endpoint: server.url.href });
    const override = { accessKeyId: "other-key", secretAccessKey: "other-secret", bucket: "other-bucket" };

    expect(await client.file("dir/file.txt").exists()).toBe(true);
    expect(await client.file("dir/file.txt", override).exists()).toBe(true);
    expect(await client.exists("dir/file.txt")).toBe(true);
    expect(await client.size("dir/file.txt", override)).toBe(5);
    expect(await client.file("dir/file.txt").write("hello")).toBe(5);
    expect(await client.unlink("dir/file.txt")).toBe(true);
    expect((await client.file("dir/file.txt").stat()).size).toBe(5);

    expect(requests).toEqual([
      "HEAD /client-bucket/dir/file.txt client-key",
      "HEAD /other-bucket/dir/file.txt other-key",
      "HEAD /client-bucket/dir/file.txt client-key",
      "HEAD /other-bucket/dir/file.txt other-key",
      "PUT /client-bucket/dir/file.txt client-key",
      "DELETE /client-bucket/dir/file.txt client-key",
      "HEAD /client-bucket/dir/file.txt client-key",
    ]);
  });
});
