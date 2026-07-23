import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunEnvNoProxy, bunExe } from "harness";
import { createHash, createHmac } from "node:crypto";

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

describe("S3Client region option", () => {
  it.each(["us-east-1/other.example.com", "us-east-1?x", "us-east-1#x", "us east 1"])(
    "rejects the region %s because it is not a valid host name component",
    region => {
      const client = new S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "bucket",
        region,
      });
      expect(() => client.presign("key.txt")).toThrow("Invalid S3 endpoint");
    },
  );

  it("rejects a region that is not a valid host name component when using virtual hosted style", () => {
    const client = new S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "bucket",
      region: "us-east-1/other.example.com",
      virtualHostedStyle: true,
    });
    expect(() => client.presign("key.txt")).toThrow("Invalid S3 endpoint");
  });

  it("uses a valid region to build the default host", () => {
    const options = {
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "bucket",
    };

    const valid = new S3Client({ ...options, region: "eu-central-1" });
    const url = new URL(valid.presign("key.txt"));
    expect(url.hostname).toBe("s3.eu-central-1.amazonaws.com");
    expect(url.pathname).toBe("/bucket/key.txt");

    const invalid = new S3Client({ ...options, region: "eu-central-1@other.example.com" });
    expect(() => invalid.presign("key.txt")).toThrow("Invalid S3 endpoint");
  });
});

describe("S3 endpoints without a region component", () => {
  it("defaults the signing region to us-east-1", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `for (const endpoint of ["https://s3.amazonaws.com", "https://mybucket.s3.amazonaws.com"]) {
          const client = new Bun.S3Client({
            accessKeyId: "test",
            secretAccessKey: "test",
            bucket: "mybucket",
            endpoint,
          });
          const url = new URL(client.presign("key.txt"));
          console.log(url.hostname + " " + url.searchParams.get("X-Amz-Credential"));
        }`,
      ],
      env: { ...bunEnv, AWS_REGION: undefined, AWS_DEFAULT_REGION: undefined, S3_REGION: undefined },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^s3\.amazonaws\.com test\/\d{8}\/us-east-1\/s3\/aws4_request$/);
    expect(lines[1]).toMatch(/^mybucket\.s3\.amazonaws\.com test\/\d{8}\/us-east-1\/s3\/aws4_request$/);
    expect(exitCode).toBe(0);
  });
});

// ── Independent, from-spec AWS Signature V4 reference ─────────────────────
// Used to prove that the signatures Bun produces for oversized inputs are
// not just present but correct.
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html

function sigv4Signature(
  secretAccessKey: string,
  day: string,
  region: string,
  service: string,
  amzDate: string,
  canonicalRequest: string,
): string {
  let key: string | Buffer = `AWS4${secretAccessKey}`;
  for (const part of [day, region, service, "aws4_request"]) {
    key = createHmac("sha256", key).update(part, "utf8").digest();
  }
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${day}/${region}/${service}/aws4_request`,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  return createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
}

/** The X-Amz-Signature a compliant signer must produce for `presignedUrl`. */
function expectedPresignSignature(presignedUrl: string, secretAccessKey: string, method = "GET"): string {
  const url = new URL(presignedUrl);
  // Canonical query string: every parameter except X-Amz-Signature, sorted,
  // keeping the raw (already percent-encoded) key=value pairs.
  const canonicalQuery = presignedUrl
    .slice(presignedUrl.indexOf("?") + 1)
    .split("&")
    .filter(kv => !kv.startsWith("X-Amz-Signature="))
    .sort()
    .join("&");
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    `host:${url.host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const [, day, region, service] = url.searchParams.get("X-Amz-Credential")!.split("/");
  return sigv4Signature(secretAccessKey, day, region, service, url.searchParams.get("X-Amz-Date")!, canonicalRequest);
}

/** The Authorization signature a compliant signer must produce for `request`. */
function expectedHeaderSignature(
  request: { method: string; url: string; headers: Record<string, string> },
  secretAccessKey: string,
): { got: string; want: string } {
  const [, credential, signedHeaders, got] =
    /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
      request.headers["authorization"],
    )!;
  const [, day, region, service] = credential.split("/");
  const url = new URL(request.url);
  const canonicalRequest = [
    request.method,
    url.pathname,
    url.search.slice(1),
    ...signedHeaders.split(";").map(name => `${name}:${request.headers[name]}`),
    "",
    signedHeaders,
    request.headers["x-amz-content-sha256"],
  ].join("\n");
  return {
    got,
    want: sigv4Signature(secretAccessKey, day, region, service, request.headers["x-amz-date"], canonicalRequest),
  };
}

const secretAccessKey = "wJalrXUtnFEMI/K7MDENG/bPxRjfiCYEXAMPLEKEY";
const signingCredentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey,
  bucket: "bucket",
  region: "us-east-1",
  endpoint: "https://s3.example.com",
} as const;

// Shaped like a real STS token: base64 alphabet including "+", "/" and "=",
// each of which percent-encodes to 3 bytes.
const STS_TOKEN_FILL = "FwoGZXIvYXdzEBEaDLongChainedToken+Chunk/Pad=";
const sessionToken = (length: number) => Buffer.alloc(length, STS_TOKEN_FILL).toString();

describe.concurrent("S3 presign with a long session token", () => {
  // The reference implementation must agree with Bun on input that has
  // always worked; this anchors the long-input assertions below.
  it("reference SigV4 signature matches Bun for a short session token", () => {
    const url = new S3Client({ ...signingCredentials, sessionToken: sessionToken(64) }).presign("some-object-key");
    expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe(expectedPresignSignature(url, secretAccessKey));
  });

  // AWS documents no maximum STS session token length, and Cognito /
  // role-chaining routinely produce multi-KB tokens. These used to fail
  // with ERR_S3_INVALID_SESSION_TOKEN once the percent-encoded token no
  // longer fit in a fixed 2048-byte buffer.
  it.each([2049, 4096, 16384])("presigns a %i-character session token with a valid signature", length => {
    const token = sessionToken(length);
    const url = new S3Client({ ...signingCredentials, sessionToken: token }).presign("some-object-key");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("X-Amz-Security-Token")).toBe(token);
    expect(parsed.searchParams.get("X-Amz-Signature")).toBe(expectedPresignSignature(url, secretAccessKey));
  });

  // Same bug class: response-content-disposition was percent-encoded into a
  // fixed 512-byte buffer and failed with ERR_S3_INVALID_SIGNATURE.
  it("presigns a contentDisposition longer than 512 bytes when encoded", () => {
    const contentDisposition = `attachment; filename="${Buffer.alloc(600, "long file name ").toString()}.pdf"`;
    const url = new S3Client(signingCredentials).presign("some-object-key", { contentDisposition });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("response-content-disposition")).toBe(contentDisposition);
    expect(parsed.searchParams.get("X-Amz-Signature")).toBe(expectedPresignSignature(url, secretAccessKey));
  });
});

describe.concurrent("S3 header auth with a long session token", () => {
  // Header-signed operations built their canonical request in a fixed
  // 4096-byte buffer, so tokens past ~3.9 KB failed with
  // ERR_S3_INVALID_SIGNATURE before a request was even attempted.
  it("signs and sends a PUT whose session token is 8 KB", async () => {
    const length = 8192;
    const token = sessionToken(length);
    // The fixture rebuilds the same token so it never travels through argv.
    const fixture = `
      const captured = Promise.withResolvers();
      using server = Bun.serve({
        port: 0,
        async fetch(req) {
          captured.resolve({
            method: req.method,
            url: req.url,
            headers: Object.fromEntries(req.headers),
            body: await req.text(),
          });
          return new Response("", { status: 200 });
        },
      });
      const client = new Bun.S3Client({
        ...${JSON.stringify(signingCredentials)},
        endpoint: server.url.href,
        sessionToken: Buffer.alloc(${length}, ${JSON.stringify(STS_TOKEN_FILL)}).toString(),
      });
      await client.file("some-object-key").write("hello s3");
      console.log(JSON.stringify(await captured.promise));
    `;
    // The fixture's S3 request targets an in-process server and must not
    // be rerouted by ambient proxy configuration on CI hosts.
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnvNoProxy, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });

    const request = JSON.parse(stdout);
    expect(request.method).toBe("PUT");
    expect(request.body).toBe("hello s3");
    expect(request.headers["x-amz-security-token"]).toBe(token);
    expect(request.headers["authorization"]).toContain("x-amz-security-token");
    const { got, want } = expectedHeaderSignature(request, secretAccessKey);
    expect(got).toBe(want);
  });
});
