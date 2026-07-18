import { S3Client, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// S3Client resolves its proxy from the native env map without consulting
// NO_PROXY (it calls getHttpProxy with no hostname), so a CI HTTP_PROXY would
// swallow requests to the localhost mock endpoints below. In-process
// `process.env.HTTP_PROXY = ""` is *not* reliable here: an earlier test file
// in the same `bun test` process may have `delete`d the proxy-env custom
// accessor (which is how JS writes sync back to the native map), after which
// assigning "" only touches a plain data property and the S3 client still sees
// the startup proxy. Run each S3 operation in a fresh subprocess with the
// proxy vars stripped from its env instead — the subprocess's env map is built
// from the spawned environment, so no accessor is needed.
const envNoProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

// Shared subprocess fixture prefix: a mock S3 endpoint on port 0 plus the
// S3Options every case feeds through. The caller supplies the operation body
// and is expected to `console.log(JSON.stringify(...))` the observed request
// headers; the parent process asserts on that JSON.
const fixturePreamble = /* js */ `
  import { s3, S3Client } from "bun";
  import { randomUUID } from "node:crypto";

  const s3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
  };

  let reqHeaders;
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      reqHeaders = req.headers;
      return new Response("", { headers: { "Content-Type": "text/plain" }, status: 200 });
    },
  });

  const report = () =>
    console.log(JSON.stringify({
      authorization: reqHeaders?.get("authorization") ?? null,
      storageClassHeader: reqHeaders?.get("x-amz-storage-class") ?? null,
    }));
`;

async function runFixture(body: string): Promise<{ authorization: string | null; storageClassHeader: string | null }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixturePreamble + body],
    env: envNoProxy,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

describe("s3 - Storage class", () => {
  const s3Options: S3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
  };

  it("should throw TypeError if storage class isnt one of enum", async () => {
    try {
      new S3Client({
        ...s3Options,
        endpoint: "anything",
        // @ts-expect-error not an enum
        storageClass: "INVALID_VALUE",
      }).file("instance_file");

      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
    }
  });

  it("should work with static .file() method", async () => {
    const storageClass = "STANDARD_IA";
    const got = await runFixture(/* js */ `
      await S3Client.file("from_static_file", {
        ...s3Options,
        endpoint: server.url.href,
        storageClass: ${JSON.stringify(storageClass)},
      }).write("This is a good file");
      report();
    `);

    expect(got.authorization).toInclude("x-amz-storage-class");
    expect(got.storageClassHeader).toBe(storageClass);
  });

  it("should work with static .write() method", async () => {
    const storageClass = "REDUCED_REDUNDANCY";
    const got = await runFixture(/* js */ `
      await S3Client.write("from_static_write", "This is a good file", {
        ...s3Options,
        endpoint: server.url.href,
        storageClass: ${JSON.stringify(storageClass)},
      });
      report();
    `);

    expect(got.authorization).toInclude("x-amz-storage-class");
    expect(got.storageClassHeader).toBe(storageClass);
  });

  it("should work with static presign", () => {
    const storageClass = "DEEP_ARCHIVE";
    const result = S3Client.file("awsome_file").presign({
      ...s3Options,
      storageClass,
    });

    expect(result).toInclude(`x-amz-storage-class=${storageClass}`);
  });

  it("should work with instance options + .file() method", async () => {
    const storageClass = "ONEZONE_IA";
    const got = await runFixture(/* js */ `
      const client = new S3Client({
        ...s3Options,
        endpoint: server.url.href,
        storageClass: ${JSON.stringify(storageClass)},
      });
      await client.file("instance_file").write("Some content");
      report();
    `);

    expect(got.authorization).toInclude("x-amz-storage-class");
    expect(got.storageClassHeader).toBe(storageClass);
  });

  it("should work with instance .file() method + options", async () => {
    const storageClass = "SNOW";
    const got = await runFixture(/* js */ `
      const file = new S3Client({
        ...s3Options,
        endpoint: server.url.href,
      }).file("instance_file", { storageClass: ${JSON.stringify(storageClass)} });
      await file.write("Some content");
      report();
    `);

    expect(got.authorization).toInclude("x-amz-storage-class");
    expect(got.storageClassHeader).toBe(storageClass);
  });

  it("should work with writer + options on small file", async () => {
    const storageClass = "SNOW";
    const got = await runFixture(/* js */ `
      const client = new S3Client({
        ...s3Options,
        endpoint: server.url.href,
      });
      const writer = client.file("file_from_writer").writer({ storageClass: ${JSON.stringify(storageClass)} });
      const smallFile = Buffer.alloc(10 * 1024);
      for (let i = 0; i < 10; i++) writer.write(smallFile);
      await writer.end();
      report();
    `);

    expect(got.authorization).toInclude("x-amz-storage-class");
    expect(got.storageClassHeader).toBe(storageClass);
  });

  it(
    "should work with writer + options on big file",
    async () => {
      const storageClass = "SNOW";
      // This case needs a multipart-aware mock server, so it doesn't share
      // `fixturePreamble`'s simple server.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          /* js */ `
            import { S3Client } from "bun";
            import { randomUUID } from "node:crypto";

            const s3Options = {
              accessKeyId: "test",
              secretAccessKey: "test",
              region: "eu-west-3",
              bucket: "my_bucket",
            };

            let reqHeaders;
            using server = Bun.serve({
              port: 0,
              async fetch(req) {
                const isCreateMultipartUploadRequest = req.method == "POST" && req.url.includes("?uploads=");
                if (isCreateMultipartUploadRequest) {
                  reqHeaders = req.headers;
                  return new Response(
                    "<InitiateMultipartUploadResult><Bucket>my_bucket</Bucket><Key>file_from_writer</Key><UploadId>" +
                      randomUUID() +
                      "</UploadId></InitiateMultipartUploadResult>",
                    { headers: { "Content-Type": "text/xml" }, status: 200 },
                  );
                }
                const isCompleteMultipartUploadRequest = req.method == "POST" && req.url.includes("uploadId=");
                if (isCompleteMultipartUploadRequest) {
                  return new Response(
                    "<CompleteMultipartUploadResult><Location>http://my_bucket.s3.region.amazonaws.com/file_from_writer</Location><Bucket>my_bucket</Bucket><Key>file_from_writer</Key><ETag>\\"f9a5ddddf9e0fcbd05c15bb44b389171-20\\"</ETag></CompleteMultipartUploadResult>",
                    { headers: { "Content-Type": "text/xml" }, status: 200 },
                  );
                }
                return new Response(undefined, {
                  status: 200,
                  headers: { Etag: '"f9a5ddddf9e0fcbd05c15bb44b389171-20"' },
                });
              },
            });

            const client = new S3Client({ ...s3Options, endpoint: server.url.href });
            const writer = client.file("file_from_writer").writer({
              storageClass: ${JSON.stringify(storageClass)},
              queueSize: 10,
              partSize: 5 * 1024 * 1024,
            });
            const bigFile = Buffer.alloc(10 * 1024 * 1024);
            for (let i = 0; i < 10; i++) writer.write(bigFile);
            await writer.end();

            console.log(JSON.stringify({
              authorization: reqHeaders?.get("authorization") ?? null,
              storageClassHeader: reqHeaders?.get("x-amz-storage-class") ?? null,
            }));
          `,
        ],
        env: envNoProxy,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      const got = JSON.parse(stdout.trim());

      expect(got.authorization).toInclude("x-amz-storage-class");
      expect(got.storageClassHeader).toBe(storageClass);
    },
    { timeout: 20_000 },
  );

  it("should work with default s3 instance", async () => {
    const storageClass = "INTELLIGENT_TIERING";
    const got = await runFixture(/* js */ `
      await s3
        .file("my_file", { ...s3Options, storageClass: ${JSON.stringify(storageClass)}, endpoint: server.url.href })
        .write("any thing");
      report();
    `);

    expect(got.authorization).toInclude("x-amz-storage-class");
    expect(got.storageClassHeader).toBe(storageClass);
  });
});
