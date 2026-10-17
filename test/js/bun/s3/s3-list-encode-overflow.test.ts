import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, MAX_PATH_BYTES } from "harness";
import { serve } from "s3-server";

const fill = (length: number, text: string) => Buffer.alloc(length, text).toString();

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

// Bun signs each request below, and the server of test/packages/s3-server checks the
// signature with its own implementation: a request that gets its answer was signed correctly.
// The first row of each test is a size that the signer always took. It refused the others
// before it sent a request, because it kept the text that it signs in arrays of a fixed size.
describe.concurrent("S3 requests with a long signed text", () => {
  // Base64 text that has `+` and `/` as often as a real session token.
  const base64Token = (length: number) =>
    Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 11) & 255))
      .toString("base64")
      .slice(0, length);
  const credentials = (sessionToken: string) => ({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "secret",
    sessionToken,
  });

  // 4096 characters is the largest session token that AWS STS issues. Amazon S3 refuses more
  // than 8 KB of headers, so the last row only shows that the signer has no limit of its own.
  it.each([3800, 4000, 4096, 8000])("sends a PUT and a GET with a session token of %i characters", async length => {
    const sessionToken = base64Token(length);
    await using server = serve({ credentials: credentials(sessionToken), buckets: ["bucket"] });
    const client = new S3Client(server.clientOptions("bucket"));

    await client.write("object.txt", "Hello Bun!");
    expect(await client.file("object.txt").text()).toBe("Hello Bun!");
    expect(
      server.requests.map(request => [request.operation, request.status, request.headers.get("x-amz-security-token")]),
    ).toEqual([
      ["PutObject", 200, sessionToken],
      ["GetObject", 200, sessionToken],
    ]);
  });

  it("sends a PUT and a GET through fetch with a session token of 4000 characters", async () => {
    const sessionToken = base64Token(4000);
    await using server = serve({ credentials: credentials(sessionToken), buckets: ["bucket"] });
    const s3 = server.clientOptions();

    await fetch("s3://bucket/object.txt", { method: "PUT", body: "Hello Bun!", s3 });
    expect(await (await fetch("s3://bucket/object.txt", { s3 })).text()).toBe("Hello Bun!");
    expect(
      server.requests.map(request => [request.operation, request.status, request.headers.get("x-amz-security-token")]),
    ).toEqual([
      ["PutObject", 200, sessionToken],
      ["GetObject", 200, sessionToken],
    ]);
  });

  // Amazon S3 allows a key of 1024 bytes. Percent-encoding makes each of these keys three times as long.
  it.each([
    ["113 CJK characters", fill(113 * 3, "文")],
    ["114 CJK characters", fill(114 * 3, "文")],
    ["1023 bytes", fill(341 * 3, "文")],
    // macOS refuses a path of 1024 bytes before the signer sees the key.
    ...(MAX_PATH_BYTES > 1024 ? [["1024 bytes", fill(341 * 3, "文") + "a"]] : []),
  ])("sends a PUT and a GET for a key of %s", async (_, key) => {
    await using server = serve({ buckets: ["bucket"] });
    const client = new S3Client(server.clientOptions("bucket"));

    await client.write(key, "Hello Bun!");
    expect(await client.file(key).text()).toBe("Hello Bun!");
    expect(server.requests.map(request => [request.operation, request.status, request.key])).toEqual([
      ["PutObject", 200, key],
      ["GetObject", 200, key],
    ]);
  });

  it.each([3000, 4200])("sends a PUT with a contentDisposition of %i characters", async length => {
    await using server = serve({ buckets: ["bucket"] });
    const client = new S3Client(server.clientOptions("bucket"));
    const contentDisposition = `attachment; filename="${fill(length, "a")}.txt"`;

    await client.write("object.txt", "Hello Bun!", { contentDisposition });
    expect(
      server.requests.map(request => [request.operation, request.status, request.headers.get("content-disposition")]),
    ).toEqual([["PutObject", 200, contentDisposition]]);
  });

  it.each([3800, 4200])("sends a PUT with a contentEncoding of %i characters", async length => {
    await using server = serve({ buckets: ["bucket"] });
    const client = new S3Client(server.clientOptions("bucket"));
    const contentEncoding = fill(length, "e");

    await client.write("object.txt", "Hello Bun!", { contentEncoding });
    expect(
      server.requests.map(request => [request.operation, request.status, request.headers.get("content-encoding")]),
    ).toEqual([["PutObject", 200, contentEncoding]]);
  });

  // The region is a part of the text that the signature is made from. That text goes to
  // the heap from a region of 133 characters.
  it.each([132, 133, 4000])("sends a PUT and a GET with a region of %i characters", async length => {
    await using server = serve({ region: fill(length, "r"), buckets: ["bucket"] });
    const client = new S3Client(server.clientOptions("bucket"));

    await client.write("object.txt", "Hello Bun!");
    expect(await client.file("object.txt").text()).toBe("Hello Bun!");
    expect(server.requests.map(request => [request.operation, request.status])).toEqual([
      ["PutObject", 200],
      ["GetObject", 200],
    ]);
  });

  it.each([300, 700])("lists with a prefix and a startAfter of %i spaces", async count => {
    await using server = serve({ buckets: ["bucket"] });
    const client = new S3Client(server.clientOptions("bucket"));
    const prefix = `folder${fill(count, " ")}`;

    await client.list({ prefix, startAfter: `${prefix}/after` });
    expect(
      server.requests.map(request => {
        const query = new URL(request.url).searchParams;
        return [request.operation, request.status, query.get("prefix"), query.get("start-after")];
      }),
    ).toEqual([["ListObjectsV2", 200, prefix, `${prefix}/after`]]);
  });

  it.each([300, 700])("lists with a delimiter and a continuationToken of %i spaces", async count => {
    await using server = serve({ buckets: ["bucket"] });
    const client = new S3Client(server.clientOptions("bucket"));
    const spaces = fill(count, " ");

    // The server did not issue this token. It says so only after it accepted the signature.
    await expect(client.list({ delimiter: spaces, continuationToken: spaces })).rejects.toMatchObject({
      code: "InvalidArgument",
    });
    expect(
      server.requests.map(request => {
        const query = new URL(request.url).searchParams;
        return [request.operation, request.errorCode, query.get("delimiter"), query.get("continuation-token")];
      }),
    ).toEqual([["ListObjectsV2", "InvalidArgument", spaces, spaces]]);
  });
});

describe("S3 limits that the signer keeps", () => {
  const options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "bucket",
    region: "us-east-1",
    endpoint: "https://s3.example.com",
  };

  // Amazon S3 counts the bytes of a key: not its characters, and not its encoded form.
  it.each([
    ["1025 bytes", fill(1025, "a")],
    ["1025 bytes in 1024 characters", fill(1023, "a") + "é"],
    ["1026 bytes in 342 characters", fill(342 * 3, "文")],
  ])("rejects a key of %s", (_, key) => {
    let code: string | undefined;
    try {
      new S3Client(options).presign(key);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    // A path of MAX_PATH_BYTES is refused before the signer sees the key. On macOS that is 1024 bytes.
    expect(code).toBe(Buffer.byteLength(key) >= MAX_PATH_BYTES ? "ENAMETOOLONG" : "ERR_S3_INVALID_PATH");
  });

  // `fetch` takes the key from the URL and not from a path, so each platform has this limit.
  it("sends a key of 1024 bytes through fetch and rejects a key of 1025 bytes", async () => {
    await using server = serve({ buckets: ["bucket"] });
    const s3 = server.clientOptions();
    const key = fill(1024, "k");

    await fetch(`s3://bucket/${key}`, { method: "PUT", body: "Hello Bun!", s3 });
    await expect(fetch(`s3://bucket/${key}k`, { method: "PUT", body: "Hello Bun!", s3 })).rejects.toMatchObject({
      code: "ERR_S3_INVALID_PATH",
    });
    expect(server.requests.map(request => [request.operation, request.status, request.key])).toEqual([
      ["PutObject", 200, key],
    ]);
  });

  // The bucket of a virtual hosted request is a part of the host name.
  it.each(["evil.example.com/path", "evil.example.com\\path"])(
    "rejects the virtual hosted bucket %j because a separator in it changes the host",
    bucket => {
      const client = new S3Client({ ...options, endpoint: undefined, bucket, virtualHostedStyle: true });
      expect(() => client.presign("key.txt")).toThrow("Invalid S3 endpoint");
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
  ])("signs for the origin and path that new URL(%j) names", endpoint => {
    const expected = new URL(endpoint);
    const presigned = new S3Client({ ...options, endpoint }).presign("key.txt");
    // Compared as text: new URL(presigned) would hide a leaked userinfo, a raw
    // dot-segment or a non-canonical IPv4 spelling again.
    expect(presigned.split("?")[0]).toBe(`${expected.origin}${expected.pathname.replace(/\/$/, "")}/bucket/key.txt`);
  });

  it("defaults to https when the endpoint has no scheme", () => {
    const presigned = new S3Client({ ...options, endpoint: "s3.example.com" }).presign("key.txt");
    expect(presigned.split("?")[0]).toBe("https://s3.example.com/bucket/key.txt");
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
