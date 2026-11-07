import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

describe("S3Client endpoint option", () => {
  const options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "bucket",
    region: "us-east-1",
  };

  // presign() builds the request URL from the stored endpoint exactly like a
  // request would, without opening a connection, so the ports below are never dialed.
  it.each([
    "http://127.0.0.1:1#@127.0.0.1:2",
    "http://127.0.0.1:1\\@127.0.0.1:2",
    "http://127.0.0.1:1?@127.0.0.1:2",
    "http://user:p@ss@127.0.0.1:1",
    "http://user:@127.0.0.1:1",
    "http://user@127.0.0.1:1",
    "http://127.0.0.1:1/x/../prefix/",
    "http://127.1:1",
    "https://acct.supabase.co/storage/v1/s3",
    "https://[::1]:9000",
    "http:/127.0.0.1:1",
    "http:127.0.0.1:1",
    "http:///127.0.0.1:1",
    "  http://127.0.0.1:1  ",
  ])("signs for the origin and path that new URL(%j) names", endpoint => {
    const expected = new URL(endpoint);
    const presigned = new S3Client({ ...options, endpoint }).presign("key.txt");
    // Compared as text: new URL(presigned) would hide a leaked userinfo, a raw
    // dot-segment or a non-canonical IPv4 spelling again.
    expect(presigned.split("?")[0]).toBe(`${expected.origin}${expected.pathname.replace(/\/$/, "")}/bucket/key.txt`);
  });

  // new URL() reads these as a scheme (localhost:) or not at all.
  it.each([
    ["s3.example.com", "https://s3.example.com"],
    ["localhost:9000", "https://localhost:9000"],
    ["127.0.0.1:9000/prefix/", "https://127.0.0.1:9000/prefix"],
    ["[::1]:9000", "https://[::1]:9000"],
  ])("defaults %j to https", (endpoint, origin) => {
    const presigned = new S3Client({ ...options, endpoint }).presign("key.txt");
    expect(presigned.split("?")[0]).toBe(`${origin}/bucket/key.txt`);
  });

  it("rejects an endpoint without a host", () => {
    expect(() => new S3Client({ ...options, endpoint: "//127.0.0.1:1" })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  it("applies the same parsing to S3_ENDPOINT", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(new URL(Bun.s3.presign("key.txt")).host)`],
      env: {
        ...bunEnv,
        AWS_ENDPOINT: undefined,
        S3_ENDPOINT: "http://127.0.0.1:1#@127.0.0.1:2",
        S3_ACCESS_KEY_ID: "test",
        S3_SECRET_ACCESS_KEY: "test",
        S3_BUCKET: "bucket",
        S3_REGION: "us-east-1",
      },
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("127.0.0.1:1\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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
