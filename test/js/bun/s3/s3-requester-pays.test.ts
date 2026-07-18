import { S3Client, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The S3 client resolves its proxy from the native env map without consulting
// NO_PROXY (hostname is not threaded through), so a CI HTTP_PROXY would hijack
// requests to our localhost mock endpoint. Earlier attempts blanked the proxy
// vars via process.env in a beforeAll, but an unrelated earlier test file in
// the full-suite run mass-deletes every process.env key, which strips the
// CustomAccessor that syncs proxy-var writes back to the native env map — so
// process.env.HTTP_PROXY = "" becomes a plain data-property write and the
// native map keeps pointing at the proxy. The only robust isolation is a fresh
// subprocess spawned without the proxy env vars.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

// Spawns a subprocess that stands up a mock S3 endpoint on port 0, performs the
// requested S3 operation against it, and prints the captured request's method
// and headers as JSON. Returns { method, headers } so callers can assert on the
// x-amz-request-payer signing/inclusion without the parent process's proxy
// state mattering.
async function runS3Op(options: {
  op: "write" | "text" | "exists" | "delete";
  requestPayer?: boolean;
  viaInstance?: boolean;
  fileLevelRequestPayer?: boolean;
}): Promise<{ method: string; headers: Record<string, string> }> {
  const { op, requestPayer, viaInstance = false, fileLevelRequestPayer } = options;

  const makeFile = viaInstance
    ? `const client = new S3Client({ ...s3Options, endpoint: server.url.href${
        requestPayer === undefined ? "" : `, requestPayer: ${requestPayer}`
      } });
       const file = client.file("test_file"${fileLevelRequestPayer === undefined ? "" : `, { requestPayer: ${fileLevelRequestPayer} }`});`
    : `const file = S3Client.file("test_file", { ...s3Options, endpoint: server.url.href${
        requestPayer === undefined ? "" : `, requestPayer: ${requestPayer}`
      } });`;

  const action =
    op === "write"
      ? `await file.write("Test content");`
      : op === "text"
        ? `await file.text();`
        : op === "exists"
          ? `await file.exists();`
          : `await file.delete();`;

  const fixture = `
    import { S3Client } from "bun";
    const s3Options = { accessKeyId: "test", secretAccessKey: "test", region: "eu-west-3", bucket: "my_bucket" };
    let captured;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        captured = { method: req.method, headers: Object.fromEntries(req.headers) };
        const body = ${JSON.stringify(op === "text" ? "Test content from requester pays bucket" : "")};
        return new Response(body, {
          status: ${op === "delete" ? 204 : 200},
          headers: { "Content-Type": "text/plain", "Content-Length": String(body.length) },
        });
      },
    });
    ${makeFile}
    ${action}
    console.log(JSON.stringify(captured));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: envWithoutProxy,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${exitCode}):\n${stderr || stdout}`);
  }
  return JSON.parse(stdout.trim());
}

describe("s3 - Requester Pays", () => {
  const s3Options: S3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
  };

  it("should include x-amz-request-payer header when requestPayer is true", async () => {
    const { headers } = await runS3Op({ op: "write", requestPayer: true });
    expect(headers["authorization"]).toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBe("requester");
  });

  it("should NOT include x-amz-request-payer header when requestPayer is false", async () => {
    const { headers } = await runS3Op({ op: "write", requestPayer: false });
    expect(headers["authorization"]).not.toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBeUndefined();
  });

  it("should NOT include x-amz-request-payer header by default", async () => {
    const { headers } = await runS3Op({ op: "write" });
    expect(headers["authorization"]).not.toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBeUndefined();
  });

  it("should work with S3Client instance", async () => {
    const { headers } = await runS3Op({ op: "write", requestPayer: true, viaInstance: true });
    expect(headers["authorization"]).toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBe("requester");
  });

  it("should work with file-level options overriding client options", async () => {
    const { headers } = await runS3Op({
      op: "write",
      requestPayer: false,
      viaInstance: true,
      fileLevelRequestPayer: true,
    });
    expect(headers["authorization"]).toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBe("requester");
  });

  it("should include x-amz-request-payer in read operations", async () => {
    const { headers } = await runS3Op({ op: "text", requestPayer: true });
    expect(headers["authorization"]).toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBe("requester");
  });

  it("should include x-amz-request-payer in HEAD requests (exists/size/stat)", async () => {
    const { method, headers } = await runS3Op({ op: "exists", requestPayer: true });
    expect(method).toBe("HEAD");
    expect(headers["authorization"]).toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBe("requester");
  });

  it("should include x-amz-request-payer in DELETE requests", async () => {
    const { method, headers } = await runS3Op({ op: "delete", requestPayer: true });
    expect(method).toBe("DELETE");
    expect(headers["authorization"]).toInclude("x-amz-request-payer");
    expect(headers["x-amz-request-payer"]).toBe("requester");
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
