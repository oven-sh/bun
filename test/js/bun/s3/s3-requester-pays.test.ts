import { S3Client, type S3Options } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

describe("s3 - Requester Pays", () => {
  // Every request in this file targets a local mock server, but S3Client
  // ignores NO_PROXY (https://github.com/oven-sh/bun/issues/32045), so an
  // HTTP_PROXY from the environment would swallow the requests. Neutralize
  // the proxy vars for this suite; assign "" instead of deleting because the
  // native env cache does not observe deletes.
  const proxyVars = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
  const savedProxyEnv: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const name of proxyVars) {
      savedProxyEnv[name] = process.env[name];
      process.env[name] = "";
    }
  });
  afterAll(() => {
    for (const name of proxyVars) {
      if (savedProxyEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedProxyEnv[name];
      }
    }
  });

  const s3Options: S3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
  };

  it("should include x-amz-request-payer header when requestPayer is true", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    await S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    }).write("Test content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should NOT include x-amz-request-payer header when requestPayer is false", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    await S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: false,
    }).write("Test content");

    expect(reqHeaders!.get("authorization")).not.toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBeNull();
  });

  it("should NOT include x-amz-request-payer header by default", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    await S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
    }).write("Test content");

    expect(reqHeaders!.get("authorization")).not.toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBeNull();
  });

  it("should work with S3Client instance", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await client.file("test_file").write("Test content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should work with file-level options overriding client options", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    // Client has requestPayer: false, but file overrides with true
    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: false,
    });

    await client.file("test_file", { requestPayer: true }).write("Test content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in read operations", async () => {
    let reqHeaders: Headers | undefined = undefined;
    const body = "Test content from requester pays bucket";
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": String(body.length),
          },
          status: 200,
        });
      },
    });

    const file = S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await file.text();

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in HEAD requests (exists/size/stat)", async () => {
    let reqHeaders: Headers | undefined = undefined;
    let reqMethod: string | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        reqMethod = req.method;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": "100",
          },
          status: 200,
        });
      },
    });

    const file = S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await file.exists();

    expect(reqMethod).toBe("HEAD");
    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in DELETE requests", async () => {
    let reqHeaders: Headers | undefined = undefined;
    let reqMethod: string | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        reqMethod = req.method;
        return new Response(null, {
          status: 204,
        });
      },
    });

    const file = S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await file.delete();

    expect(reqMethod).toBe("DELETE");
    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in presigned URLs", async () => {
    const file = S3Client.file("test_file", {
      ...s3Options,
      requestPayer: true,
    });

    const presignedUrl = file.presign({ expiresIn: 3600 });
    const url = new URL(presignedUrl);

    expect(url.searchParams.get("x-amz-request-payer")).toBe("requester");
  });

  it("should NOT include x-amz-request-payer in presigned URLs when requestPayer is false", async () => {
    const file = S3Client.file("test_file", {
      ...s3Options,
      requestPayer: false,
    });

    const presignedUrl = file.presign({ expiresIn: 3600 });
    const url = new URL(presignedUrl);

    expect(url.searchParams.get("x-amz-request-payer")).toBeNull();
  });
});
