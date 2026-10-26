import type { S3File, S3Options } from "bun";
import { S3Client, s3 as defaultS3, file, randomUUIDv7 } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import { createHash, createHmac, randomUUID } from "crypto";
import { bunEnv, bunExe, getSecret, isASAN, isCI, isDebug, tempDir, tempDirWithFiles } from "harness";
import { totalmem } from "os";
import path from "path";
import { serve, spawnServer } from "s3-server";
const s3 = (...args: Parameters<typeof defaultS3.file>) => defaultS3.file(...args);
const S3 = (...args) => new S3Client(...args);

type S3Credentials = S3Options & {
  service: string;
};

// The S3 server of test/packages/s3-server, in a process of its own. It needs
// no container, so these tests run on each platform. It has a region, so it
// refuses a signature for another region, as Amazon S3 does.
const localServer = await spawnServer({
  bunExe: bunExe(),
  env: bunEnv,
  region: "us-east-1",
  buckets: ["buntest", { name: "buntest-us-west-1", region: "us-west-1" }],
});
afterAll(() => localServer.stop());
const localCredentials: S3Credentials = {
  ...localServer.clientOptions("buntest"),
  service: "s3-server" as string,
};

const allCredentials: S3Credentials[] = [
  {
    accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
    secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
    endpoint: getSecret("S3_R2_ENDPOINT"),
    bucket: getSecret("S3_R2_BUCKET"),
    service: "R2" as string,
  },
  localCredentials,
];
const r2Credentials = allCredentials[0];
describe.concurrent.skipIf(!r2Credentials.endpoint && !isCI)("Virtual Hosted-Style", () => {
  if (!r2Credentials.endpoint) {
    return;
  }
  const r2Url = new URL(r2Credentials.endpoint);
  // R2 do support virtual hosted style lets use it
  r2Url.hostname = `${r2Credentials.bucket}.${r2Url.hostname}`;

  const credentials: S3Options = {
    accessKeyId: r2Credentials.accessKeyId,
    secretAccessKey: r2Credentials.secretAccessKey,
    endpoint: r2Url.toString(),
    virtualHostedStyle: true,
  };

  it("basic operations", async () => {
    const client = new Bun.S3Client(credentials);
    const file = client.file(randomUUIDv7() + ".txt");
    await file.write("Hello Bun!");
    const text = await file.text();
    expect(text).toBe("Hello Bun!");
    const stat = await file.stat();
    expect(stat.size).toBe(10);
    expect(stat.type).toBe("text/plain;charset=utf-8");
    await file.unlink();
    expect(await file.exists()).toBe(false);
  });

  it("ignore bucket name in path", async () => {
    const client = new Bun.S3Client(credentials);
    const filename = randomUUIDv7() + ".txt";
    const file = client.file(filename, {
      bucket: "will-be-ignored",
    });
    await file.write("Hello Bun!");
    const text = await client.file(filename).text();
    expect(text).toBe("Hello Bun!");
    await file.unlink();
  });

  it("presign", async () => {
    {
      const client = new Bun.S3Client(credentials);
      const presigned = client.presign("filename.txt");
      const url = new URL(presigned);
      expect(url.hostname).toBe(r2Url.hostname);
    }

    {
      const client = new Bun.S3Client({
        virtualHostedStyle: true,
        bucket: "bucket",
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "us-west-1",
      });
      const presigned = client.presign("filename.txt");
      const url = new URL(presigned);
      expect(url.hostname).toBe("bucket.s3.us-west-1.amazonaws.com");
    }

    {
      const client = new Bun.S3Client({
        virtualHostedStyle: true,
        bucket: "bucket",
        accessKeyId: "test",
        secretAccessKey: "test",
      });
      const presigned = client.presign("filename.txt");
      const url = new URL(presigned);
      expect(url.hostname).toBe("bucket.s3.us-east-1.amazonaws.com");
    }
  });

  it("inspect", () => {
    const client = new Bun.S3Client({
      endpoint: "bucket.test.r2.cloudflarestorage.com",
      accessKeyId: "test",
      secretAccessKey: "test",
      virtualHostedStyle: true,
    });

    {
      expect(Bun.inspect(client)).toBe(
        'S3Client ("bucket") {\n  endpoint: "bucket.test.r2.cloudflarestorage.com",\n  region: "auto",\n  accessKeyId: "[REDACTED]",\n  secretAccessKey: "[REDACTED]",\n  partSize: 5242880,\n  queueSize: 5,\n  retry: 3\n}',
      );
    }

    {
      expect(
        Bun.inspect(
          new Bun.S3Client({
            virtualHostedStyle: true,
            bucket: "bucket",
            accessKeyId: "test",
            secretAccessKey: "test",
            region: "us-west-1",
          }),
        ),
      ).toBe(
        'S3Client ("bucket") {\n  endpoint: "https://<bucket>.s3.<region>.amazonaws.com",\n  region: "us-west-1",\n  accessKeyId: "[REDACTED]",\n  secretAccessKey: "[REDACTED]",\n  partSize: 5242880,\n  queueSize: 5,\n  retry: 3\n}',
      );
    }
    {
      const file = client.file("filename.txt");
      expect(Bun.inspect(file)).toBe(
        'S3Ref ("bucket/filename.txt") {\n  endpoint: "bucket.test.r2.cloudflarestorage.com",\n  region: "auto",\n  accessKeyId: "[REDACTED]",\n  secretAccessKey: "[REDACTED]",\n  partSize: 5242880,\n  queueSize: 5,\n  retry: 3\n}',
      );
    }
    {
      const file = client
        .file("filename.txt", {
          type: "text/plain",
        })
        .slice(10);
      expect(Bun.inspect(file)).toBe(
        'S3Ref ("bucket/filename.txt") {\n  type: "text/plain;charset=utf-8",\n  offset: 10,\n  endpoint: "bucket.test.r2.cloudflarestorage.com",\n  region: "auto",\n  accessKeyId: "[REDACTED]",\n  secretAccessKey: "[REDACTED]",\n  partSize: 5242880,\n  queueSize: 5,\n  retry: 3\n}',
      );
    }
  });
});
for (let credentials of allCredentials) {
  describe.concurrent(`${credentials.service}`, () => {
    const s3Options: S3Options = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      endpoint: credentials.endpoint,
      region: credentials.region,
    };

    const S3Bucket = credentials.bucket;

    function makePayLoadFrom(text: string, size: number): string {
      return Buffer.alloc(size, text).toString();
    }

    // 10 MiB big enough to Multipart upload in more than one part
    const bigPayload = makePayLoadFrom("Bun is the best runtime ever", 10 * 1024 * 1024);
    // more than 5 MiB but less than 2 parts size
    const mediumPayload = makePayLoadFrom("Bun is the best runtime ever", 6 * 1024 * 1024);
    // less than 5 MiB
    const bigishPayload = makePayLoadFrom("Bun is the best runtime ever", 1 * 1024 * 1024);
    describe.skipIf(!s3Options.accessKeyId)("s3", () => {
      for (let bucketInName of [true, false]) {
        describe.concurrent("fetch", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };

            async function tmp() {
              const tmp_filename = bucketInName ? `s3://${S3Bucket}/${randomUUID()}` : `s3://${randomUUID()}`;
              const result = await fetch(tmp_filename, {
                method: "PUT",
                body: "Hello Bun!",
                s3: options,
              });
              expect(result.status).toBe(200);

              return {
                name: tmp_filename,
                [Symbol.asyncDispose]: async () => {
                  try {
                    const result = await fetch(tmp_filename, {
                      method: "DELETE",
                      s3: options,
                    });
                    expect([204, 200, 404]).toContain(result.status);
                  } catch (e: any) {
                    // if error with NoSuchKey, it means the file does not exist and its fine
                    expect(e?.code || e).toBe("NoSuchKey");
                  }
                },
              };
            }

            it("should download file via fetch GET", async () => {
              await using tmpfile = await tmp();
              const result = await fetch(tmpfile.name, { s3: options });
              expect(result.status).toBe(200);
              expect(await result.text()).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              await using tmpfile = await tmp();
              const result = await fetch(tmpfile.name, {
                headers: { "range": "bytes=6-10" },
                s3: options,
              });
              expect(result.status).toBe(206);
              expect(await result.text()).toBe("Bun!");
            });

            it("should check if a key exists or content-length", async () => {
              await using tmpfile = await tmp();
              const result = await fetch(tmpfile.name, {
                method: "HEAD",
                s3: options,
              });
              expect(result.status).toBe(200); // 404 if do not exists
              expect(result.headers.get("content-length")).toBe("10"); // content-length
            });

            it("should check if a key does not exist", async () => {
              await using tmpfile = await tmp();
              const result = await fetch(tmpfile.name + "-does-not-exist", { s3: options });
              expect(result.status).toBe(404);
            });

            it("should be able to set content-type", async () => {
              await using tmpfile = await tmp();
              {
                const result = await fetch(tmpfile.name, {
                  method: "PUT",
                  body: "Hello Bun!",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  s3: options,
                });
                expect(result.status).toBe(200);
                const response = await fetch(tmpfile.name, { s3: options });
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }
              {
                const result = await fetch(tmpfile.name, {
                  method: "PUT",
                  body: "Hello Bun!",
                  headers: {
                    "Content-Type": "text/plain",
                  },
                  s3: options,
                });
                expect(result.status).toBe(200);
                const response = await fetch(tmpfile.name, { s3: options });
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }
            });

            it("should send conditional headers", async () => {
              await using tmpfile = await tmp();
              // The key has an object, so the condition of this write does not hold.
              const write = await fetch(tmpfile.name, {
                method: "PUT",
                body: "replaced",
                headers: { "If-None-Match": "*" },
                s3: options,
              });
              expect(write.status).toBe(412);

              const read = await fetch(tmpfile.name, { s3: options });
              expect(await read.text()).toBe("Hello Bun!");
              const notModified = await fetch(tmpfile.name, {
                headers: { "If-None-Match": read.headers.get("etag")! },
                s3: options,
              });
              expect(notModified.status).toBe(304);
            });

            it("should store the headers of an upload", async () => {
              await using tmpfile = await tmp();
              const result = await fetch(tmpfile.name, {
                method: "PUT",
                body: "Hello Bun!",
                headers: {
                  "Cache-Control": "max-age=60",
                  "Content-Disposition": 'attachment; filename="bun.txt"',
                },
                s3: options,
              });
              expect(result.status).toBe(200);
              const response = await fetch(tmpfile.name, { s3: options });
              expect({
                cacheControl: response.headers.get("cache-control"),
                contentDisposition: response.headers.get("content-disposition"),
              }).toEqual({
                cacheControl: "max-age=60",
                contentDisposition: 'attachment; filename="bun.txt"',
              });
            });

            it("should be able to upload large files", async () => {
              await using tmpfile = await tmp();
              // 10 MiB big enough to Multipart upload in more than one part
              const buffer = Buffer.alloc(1 * 1024 * 1024, "a");
              {
                await fetch(tmpfile.name, {
                  method: "PUT",
                  body: async function* () {
                    for (let i = 0; i < 10; i++) {
                      await Bun.sleep(10);
                      yield buffer;
                    }
                  },
                  s3: options,
                }).then(res => res.text());

                const result = await fetch(tmpfile.name, { method: "HEAD", s3: options });
                expect(result.status).toBe(200);
                expect(result.headers.get("content-length")).toBe((buffer.byteLength * 10).toString());
              }
            }, 20_000);
          });
        });

        describe("Bun.S3Client", () => {
          describe.concurrent(bucketInName ? "bucket in path" : "bucket in options", () => {
            const options = bucketInName ? null : { bucket: S3Bucket };

            var bucket = S3(s3Options);

            async function tmp() {
              const tmp_filename = bucketInName! ? `${S3Bucket}/${randomUUID()}` : `${randomUUID()}`;
              const file = bucket.file(tmp_filename, options!);
              await file.write("Hello Bun!");

              return {
                name: tmp_filename,
                [Symbol.asyncDispose]: async () => {
                  try {
                    const file = bucket.file(tmp_filename, options!);
                    await file.unlink();
                  } catch (e: any) {
                    // if error with NoSuchKey, it means the file does not exist and its fine
                    expect(e?.code || e).toBe("NoSuchKey");
                  }
                },
              };
            }

            it("should download file via Bun.s3().text()", async () => {
              await using tmpfile = await tmp();
              const file = bucket.file(tmpfile.name, options!);
              await file.write("Hello Bun!");
              const text = await file.text();
              expect(text).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              await using tmpfile = await tmp();
              const file = bucket.file(tmpfile.name, options!);
              const text = await file.slice(6, 10).text();
              expect(text).toBe("Bun!");
            });
            it("should download range with 0 offset", async () => {
              await using tmpfile = await tmp();
              const file = bucket.file(tmpfile.name, options!);
              const text = await file.slice(0, 5).text();
              expect(text).toBe("Hello");
            });

            it("should check if a key exists or content-length", async () => {
              await using tmpfile = await tmp();
              const file = bucket.file(tmpfile.name, options!);
              const exists = await file.exists();
              expect(exists).toBe(true);
              const stat = await file.stat();
              expect(stat.size).toBe(10);
            });

            it("should check if a key does not exist", async () => {
              await using tmpfile = await tmp();
              const file = bucket.file(tmpfile.name + "-does-not-exist", options!);
              const exists = await file.exists();
              expect(exists).toBe(false);
            });

            it("should be able to set content-type", async () => {
              await using tmpfile = await tmp();
              {
                const s3file = bucket.file(tmpfile.name, options!);
                await s3file.write("Hello Bun!", { type: "text/css" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/css");
              }
              {
                const s3file = bucket.file(tmpfile.name, options!);
                await s3file.write("Hello Bun!", { type: "text/plain" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }

              {
                const s3file = bucket.file(tmpfile.name, options!);
                const writer = s3file.writer({ type: "application/json" });
                writer.write("Hello Bun!");
                await writer.end();
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }

              {
                await bucket.write(tmpfile.name, "Hello Bun!", { ...options, type: "application/xml" });
                const response = await fetch(bucket.file(tmpfile.name, options!).presign());
                expect(response.headers.get("content-type")).toStartWith("application/xml");
              }
            });

            it("should be able to set content-disposition", async () => {
              await using tmpfile = await tmp();
              {
                const s3file = bucket.file(tmpfile.name, options!);
                await s3file.write("Hello Bun!", { contentDisposition: 'attachment; filename="test.txt"' });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-disposition")).toBe('attachment; filename="test.txt"');
              }
              {
                const s3file = bucket.file(tmpfile.name, options!);
                await s3file.write("Hello Bun!", { contentDisposition: "inline" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-disposition")).toBe("inline");
              }
              {
                await bucket.write(tmpfile.name, "Hello Bun!", {
                  ...options,
                  contentDisposition: 'attachment; filename="report.pdf"',
                });
                const response = await fetch(bucket.file(tmpfile.name, options!).presign());
                expect(response.headers.get("content-disposition")).toBe('attachment; filename="report.pdf"');
              }
            });
            it("should be able to set content-disposition in writer", async () => {
              await using tmpfile = await tmp();
              {
                const s3file = bucket.file(tmpfile.name, options!);
                const writer = s3file.writer({
                  contentDisposition: 'attachment; filename="test.txt"',
                });
                writer.write("Hello Bun!!");
                await writer.end();
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-disposition")).toBe('attachment; filename="test.txt"');
              }
            });

            it("should be able to set content-encoding", async () => {
              await using tmpfile = await tmp();
              {
                const s3file = bucket.file(tmpfile.name, options!);
                await s3file.write("Hello Bun!", { contentEncoding: "gzip" });
                // Use decompress: false since content isn't actually gzip-compressed
                const response = await fetch(s3file.presign(), { decompress: false });
                expect(response.headers.get("content-encoding")).toBe("gzip");
              }
              {
                const s3file = bucket.file(tmpfile.name, options!);
                await s3file.write("Hello Bun!", { contentEncoding: "br" });
                // Use decompress: false since content isn't actually br-compressed
                const response = await fetch(s3file.presign(), { decompress: false });
                expect(response.headers.get("content-encoding")).toBe("br");
              }
              {
                await bucket.write(tmpfile.name, "Hello Bun!", {
                  ...options,
                  contentEncoding: "identity",
                });
                const response = await fetch(bucket.file(tmpfile.name, options!).presign(), { decompress: false });
                expect(response.headers.get("content-encoding")).toBe("identity");
              }
            });
            it("should be able to set content-encoding in writer", async () => {
              await using tmpfile = await tmp();
              {
                const s3file = bucket.file(tmpfile.name, options!);
                const writer = s3file.writer({
                  contentEncoding: "gzip",
                });
                writer.write("Hello Bun!!");
                await writer.end();
                // Use decompress: false since content isn't actually gzip-compressed
                const response = await fetch(s3file.presign(), { decompress: false });
                expect(response.headers.get("content-encoding")).toBe("gzip");
              }
            });

            it("should be able to upload large files using bucket.write + readable Request", async () => {
              await using tmpfile = await tmp();
              {
                await bucket.write(
                  tmpfile.name,
                  new Request("https://example.com", {
                    method: "PUT",
                    body: async function* () {
                      for (let i = 0; i < 10; i++) {
                        if (i % 5 === 0) {
                          await Bun.sleep(10);
                        }
                        yield bigishPayload;
                      }
                    },
                  }),
                  options!,
                );
                expect(await bucket.size(tmpfile.name, options!)).toBe(Buffer.byteLength(bigishPayload) * 10);
              }
            }, 50_000);

            it("should be able to upload large files in one go using bucket.write", async () => {
              {
                await using tmpfile = await tmp();
                await bucket.write(tmpfile.name, bigPayload, options!);
                expect(await bucket.size(tmpfile.name, options!)).toBe(Buffer.byteLength(bigPayload));
                expect(await bucket.file(tmpfile.name, options!).text()).toBe(bigPayload);
              }
            }, 50_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              {
                await using tmpfile = await tmp();
                const s3File = bucket.file(tmpfile.name, options!);
                await s3File.write(bigPayload);
                const stat = await s3File.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(await s3File.text()).toBe(bigPayload);
              }
            }, 50_000);

            for (let queueSize of [1, 5, 7, 10, 20]) {
              for (let payloadQuantity of [1, 5, 7, 10, 20]) {
                for (let partSize of [5, 7, 10]) {
                  // the larger payload causes OOM in CI.
                  for (let payload of [bigishPayload]) {
                    // lets skip tests with more than 10 parts on cloud providers
                    it.skipIf(credentials.service !== "s3-server")(
                      `should be able to upload large files using writer() in multiple parts with partSize=${partSize} queueSize=${queueSize} payloadQuantity=${payloadQuantity} payloadSize=${payload.length * payloadQuantity}`,
                      async () => {
                        {
                          await using tmpfile = await tmp();
                          const s3File = bucket.file(tmpfile.name, options!);
                          const writer = s3File.writer({
                            queueSize,
                            partSize: partSize * 1024 * 1024,
                          });
                          for (let i = 0; i < payloadQuantity; i++) {
                            await writer.write(payload);
                          }
                          await writer.end();
                          const stat = await s3File.stat();
                          expect(stat.size).toBe(Buffer.byteLength(payload) * payloadQuantity);
                          await s3File.delete();
                        }
                      },
                      50_000,
                    );
                  }
                }
              }
            }
          });
        });

        describe("Bun.file", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const options = bucketInName! ? s3Options : { ...s3Options, bucket: S3Bucket };

            async function tmp() {
              const url = bucketInName! ? `s3://${S3Bucket}/${randomUUID()}` : `s3://${randomUUID()}`;
              const s3file = file(url, options);
              await s3file.write("Hello Bun!");

              return {
                name: url,
                // async resource management: dispose when leaving scope
                async [Symbol.asyncDispose]() {
                  try {
                    await s3file.unlink();
                  } catch (e: any) {
                    // swallow "NoSuchKey", rethrow anything else
                    if ((e?.code ?? e) !== "NoSuchKey") throw e;
                  }
                },
              };
            }

            it("should download file via Bun.file().text()", async () => {
              await using tmpfile = await tmp();
              const s3file = file(tmpfile.name, options);
              const text = await s3file.text();
              expect(text).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              await using tmpfile = await tmp();
              const s3file = file(tmpfile.name, options);
              const text = await s3file.slice(6, 10).text();
              expect(text).toBe("Bun!");
            });

            it("should check if a key exists or content-length", async () => {
              await using tmpfile = await tmp();
              const s3file = file(tmpfile.name, options);
              const exists = await s3file.exists();
              expect(exists).toBe(true);
              const stat = await s3file.stat();
              expect(stat.size).toBe(10);
            });

            it("should check if a key does not exist", async () => {
              await using tmpfile = await tmp();
              const s3file = file(tmpfile.name + "-does-not-exist", options);
              const exists = await s3file.exists();
              expect(exists).toBe(false);
            });

            it("should be able to set content-type", async () => {
              await using tmpfile = await tmp();
              {
                const s3file = file(tmpfile.name, { ...options, type: "text/css" }) as unknown as S3File;
                await s3file.write("Hello Bun!");
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/css");
              }
              {
                const s3file = file(tmpfile.name, options) as unknown as S3File;
                await s3file.write("Hello Bun!", { type: "text/plain" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }

              {
                const s3file = file(tmpfile.name, options) as unknown as S3File;
                const writer = s3file.writer({ type: "application/json" });
                writer.write("Hello Bun!");
                await writer.end();
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }
            });
            it("should be able to upload large files using writer() #16452", async () => {
              await using tmpfile = await tmp();
              const s3file = file(tmpfile.name, options);
              const writer = s3file.writer();
              writer.write(mediumPayload);
              writer.write(mediumPayload);

              await writer.end();

              // end() followed by .text() sometimes does not return a correct result.
              await Bun.sleep(10);

              expect(await s3file.text()).toBe(mediumPayload.repeat(2));
            }, 100_000);
            it("should be able to upload large files using flush and partSize", async () => {
              await using tmpfile = await tmp();
              const s3file = file(tmpfile.name, options);

              const writer = s3file.writer({
                //@ts-ignore
                partSize: mediumPayload.length,
              });
              writer.write(mediumPayload);
              writer.write(mediumPayload);
              let total = 0;
              while (true) {
                const flushed = await writer.flush();
                if (flushed === 0) break;
                expect(flushed).toBe(Buffer.byteLength(mediumPayload));
                total += flushed;
              }
              expect(total).toBe(Buffer.byteLength(mediumPayload) * 2);
              await writer.end();
              expect(await s3file.text()).toBe(mediumPayload.repeat(2));
            }, 100_000);
            it("should be able to upload large files in one go using Bun.write", async () => {
              {
                await using tmpfile = await tmp();
                await Bun.write(file(tmpfile.name, options), bigPayload);
                expect(await S3Client.size(tmpfile.name, options)).toBe(Buffer.byteLength(bigPayload));
                expect(await file(tmpfile.name, options).text()).toEqual(bigPayload);
              }
            }, 15_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              {
                await using tmpfile = await tmp();
                const s3File = file(tmpfile.name, options);
                await s3File.write(bigPayload);
                expect(s3File.size).toBeNaN();
                expect(await s3File.text()).toBe(bigPayload);
                await s3File.delete();
              }
            }, 100_000);
          });
        });

        describe("Bun.s3", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };
            async function tmp() {
              const tmp_filename = bucketInName ? `${S3Bucket}/${randomUUID()}` : `${randomUUID()}`;
              const s3file = s3(tmp_filename, options);
              await s3file.write("Hello Bun!");
              return {
                name: tmp_filename,
                [Symbol.asyncDispose]: async () => {
                  try {
                    await s3file.unlink();
                  } catch (e: any) {
                    // if error with NoSuchKey, it means the file does not exist and its fine
                    expect(e?.code || e).toBe("NoSuchKey");
                  }
                },
              };
            }

            it("should download file via Bun.s3().text()", async () => {
              await using tmpfile = await tmp();
              const s3file = s3(tmpfile.name, options);
              const text = await s3file.text();
              expect(text).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              await using tmpfile = await tmp();
              const s3file = s3(tmpfile.name, options);
              const text = await s3file.slice(6, 10).text();
              expect(text).toBe("Bun!");
            });

            it("should check if a key exists or content-length", async () => {
              await using tmpfile = await tmp();
              const s3file = s3(tmpfile.name, options);
              const exists = await s3file.exists();
              expect(exists).toBe(true);
              expect(s3file.size).toBeNaN();
              const stat = await s3file.stat();
              expect(stat.size).toBe(10);
              expect(stat.etag).toBeDefined();

              expect(stat.lastModified).toBeDefined();
            });

            it("should check if a key does not exist", async () => {
              await using tmpfile = await tmp();
              const s3file = s3(tmpfile.name + "-does-not-exist", options);
              const exists = await s3file.exists();
              expect(exists).toBe(false);
            });

            it("presign url", async () => {
              await using tmpfile = await tmp();
              const s3file = s3(tmpfile.name, options);
              const response = await fetch(s3file.presign());
              expect(response.status).toBe(200);
              expect(await response.text()).toBe("Hello Bun!");
            });

            it("should be able to set content-type", async () => {
              await using tmpfile = await tmp();
              {
                const s3file = s3(tmpfile.name, { ...options, type: "text/css" });
                await s3file.write("Hello Bun!");
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/css");
              }
              {
                const s3file = s3(tmpfile.name, options);
                await s3file.write("Hello Bun!", { type: "text/plain" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }

              {
                const s3file = s3(tmpfile.name, options);
                const writer = s3file.writer({ type: "application/json" });
                writer.write("Hello Bun!");
                await writer.end();
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }
            });

            it("should be able to upload large files in one go using Bun.write", async () => {
              {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name, options);
                await Bun.write(s3file, bigPayload);
                const stat = await s3file.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(stat.etag).toBeDefined();

                expect(stat.lastModified).toBeDefined();
                expect(await s3file.text()).toBe(bigPayload);
                await s3file.delete();
              }
            }, 100_000);

            it("should be able to upload large files using flush and partSize", async () => {
              await using tmpfile = await tmp();
              const s3file = s3(tmpfile.name, options);

              const writer = s3file.writer({
                partSize: mediumPayload.length,
              });
              writer.write(mediumPayload);
              writer.write(mediumPayload);
              let total = 0;
              while (true) {
                const flushed = await writer.flush();
                if (flushed === 0) break;
                expect(flushed).toBe(Buffer.byteLength(mediumPayload));
                total += flushed;
              }
              expect(total).toBe(Buffer.byteLength(mediumPayload) * 2);
              await writer.end();
              expect(await s3file.text()).toBe(mediumPayload.repeat(2));
            }, 100_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              {
                await using tmpfile = await tmp();
                const s3File = s3(tmpfile.name, options);
                await s3File.write(bigPayload);
                const stat = await s3File.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(stat.etag).toBeDefined();

                expect(stat.lastModified).toBeDefined();

                expect(await s3File.text()).toBe(bigPayload);
                await s3File.delete();
              }
            }, 100_000);

            describe("readable stream", () => {
              it("should work with small files", async () => {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name + "-readable-stream", options);
                await s3file.write("Hello Bun!");
                const stream = s3file.stream();
                const reader = stream.getReader();
                let bytes = 0;
                let chunks: Array<Buffer> = [];

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  bytes += value?.length ?? 0;

                  if (value) chunks.push(value as Buffer);
                }
                expect(bytes).toBe(10);
                expect(Buffer.concat(chunks)).toEqual(Buffer.from("Hello Bun!"));
              });
              it("should work with large files ", async () => {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name + "-readable-stream-big", options);
                await s3file.write(bigishPayload);
                const stream = s3file.stream();
                const reader = stream.getReader();
                let bytes = 0;
                let chunks: Array<Buffer> = [];
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  bytes += value?.length ?? 0;
                  if (value) chunks.push(value as Buffer);
                }

                const bigishPayloadString = Buffer.concat(chunks).toString();
                expect(bigishPayload.length).toBe(bigishPayloadString.length);

                // if this test fails, then we want to avoid printing megabytes to stderr.

                if (bigishPayloadString !== bigishPayload) {
                  const SHA1 = Bun.SHA1.hash(bigishPayloadString, "hex");
                  const SHA1_2 = Bun.SHA1.hash(bigishPayload, "hex");
                  expect(SHA1).toBe(SHA1_2);
                }
              }, 30_000);
              it("should work with sliced files (offset 0)", async () => {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name + "-readable-stream-slice", options);
                await s3file.write("Hello Bun!");
                const sliced = s3file.slice(0, 5);
                const stream = sliced.stream();
                const reader = stream.getReader();
                let bytes = 0;
                let chunks: Array<Buffer> = [];

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  bytes += value?.length ?? 0;
                  if (value) chunks.push(value as Buffer);
                }
                expect(bytes).toBe(5);
                expect(Buffer.concat(chunks)).toEqual(Buffer.from("Hello"));
              });
              it("should work with sliced files (non-zero offset)", async () => {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name + "-readable-stream-slice-offset", options);
                await s3file.write("Hello Bun!");
                const sliced = s3file.slice(6, 10);
                const stream = sliced.stream();
                const reader = stream.getReader();
                let bytes = 0;
                let chunks: Array<Buffer> = [];

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  bytes += value?.length ?? 0;
                  if (value) chunks.push(value as Buffer);
                }
                expect(bytes).toBe(4);
                expect(Buffer.concat(chunks)).toEqual(Buffer.from("Bun!"));
              });
            });
          });
        });
      }
      describe.concurrent("special characters", () => {
        // supabase will throw InvalidKey
        it.skipIf(credentials.service === "supabase")("should allow special characters in the path", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          const s3file = s3(`🌈🦄${randomUUID()}.txt`, options);
          await s3file.write("Hello Bun!");
          await s3file.exists();
          await s3file.unlink();
          expect().pass();
        });
        it("should allow forward slashes in the path", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          const s3file = s3(`${randomUUID()}/test.txt`, options);
          await s3file.write("Hello Bun!");
          await s3file.exists();
          await s3file.unlink();
          expect().pass();
        });
        it("should allow backslashes in the path", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          const s3file = s3(`${randomUUID()}\\test.txt`, options);
          await s3file.write("Hello Bun!");
          await s3file.exists();
          await s3file.unlink();
          expect().pass();
        });
        it("should allow starting with forward slash", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          const s3file = s3(`/${randomUUID()}test.txt`, options);
          await s3file.write("Hello Bun!");
          await s3file.exists();
          await s3file.unlink();
          expect().pass();
        });

        it("should allow starting with backslash", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          const s3file = s3(`\\${randomUUID()}test.txt`, options);
          await s3file.write("Hello Bun!");
          await s3file.exists();
          await s3file.unlink();
          expect().pass();
        });

        it("should allow ending with forward slash", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          const s3file = s3(`${randomUUID()}/`, options);
          await s3file.write("Hello Bun!");
          await s3file.exists();
          await s3file.unlink();
          expect().pass();
        });

        it("should allow ending with backslash", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          const s3file = s3(`${randomUUID()}\\`, options);
          await s3file.write("Hello Bun!");
          await s3file.exists();
          await s3file.unlink();
          expect().pass();
        });
      });

      describe.concurrent("static methods", () => {
        it("its defined", () => {
          expect(S3Client).toBeDefined();
          expect(S3Client.write).toBeDefined();
          expect(S3Client.file).toBeDefined();
          expect(S3Client.stat).toBeDefined();
          expect(S3Client.unlink).toBeDefined();
          expect(S3Client.exists).toBeDefined();
          expect(S3Client.presign).toBeDefined();
          expect(S3Client.size).toBeDefined();
          expect(S3Client.delete).toBeDefined();
        });
        it("should work", async () => {
          const filename = randomUUID() + ".txt";
          await S3Client.write(filename, "Hello Bun!", { ...s3Options, bucket: S3Bucket });
          expect(await S3Client.file(filename, { ...s3Options, bucket: S3Bucket }).text()).toBe("Hello Bun!");
          const stat = await S3Client.stat(filename, { ...s3Options, bucket: S3Bucket });
          expect(stat.size).toBe(10);
          expect(stat.etag).toBeString();
          expect(stat.lastModified).toBeValidDate();
          expect(stat.type).toBe("text/plain;charset=utf-8");
          const url = S3Client.presign(filename, { ...s3Options, bucket: S3Bucket });
          expect(url).toBeDefined();
          const response = await fetch(url);
          expect(response.status).toBe(200);
          expect(await response.text()).toBe("Hello Bun!");
          await S3Client.unlink(filename, { ...s3Options, bucket: S3Bucket });
          expect().pass();
        });
      });
      describe.concurrent("errors", () => {
        it("Bun.write(s3file, file) should throw if the file does not exist", async () => {
          try {
            await Bun.write(s3("test.txt", { ...s3Options, bucket: S3Bucket }), file("./do-not-exist.txt"));
            expect.unreachable();
          } catch (e: any) {
            expect(e?.code).toBe("ENOENT");
            expect(e?.path).toBe("./do-not-exist.txt");
            expect(e?.syscall).toBe("open");
          }
        });

        it("Bun.write(s3file, file) should work with empty file", async () => {
          await using dir = tempDir("fsr", {
            "hello.txt": "",
          });
          const tmp_filename = `${randomUUID()}.txt`;

          await Bun.write(s3(tmp_filename, { ...s3Options, bucket: S3Bucket }), file(path.join(dir, "hello.txt")));
          await s3(tmp_filename, { ...s3Options, bucket: S3Bucket }).unlink();
        });
        it("Bun.write(s3file, file) should throw if the file does not exist", async () => {
          try {
            await Bun.write(
              s3("test.txt", { ...s3Options, bucket: S3Bucket }),
              s3("do-not-exist.txt", { ...s3Options, bucket: S3Bucket }),
            );
            expect.unreachable();
          } catch (e: any) {
            expect(e?.code).toBe("NoSuchKey");
            expect(e?.path).toBe("do-not-exist.txt");
            expect(e?.name).toBe("S3Error");
          }
        });
        it("Bun.write(s3file, file) should throw if the file does not exist", async () => {
          try {
            await Bun.write(
              s3("test.txt", { ...s3Options, bucket: S3Bucket }),
              s3("do-not-exist.txt", { ...s3Options, bucket: "does-not-exists" }),
            );
            expect.unreachable();
          } catch (e: any) {
            expect(["AccessDenied", "NoSuchBucket", "NoSuchKey"]).toContain(e?.code);
            expect(e?.path).toBe("do-not-exist.txt");
            expect(e?.name).toBe("S3Error");
          }
        });
        it("should error if bucket is missing", async () => {
          try {
            await Bun.write(s3("test.txt", s3Options), "Hello Bun!");
            expect.unreachable();
          } catch (e: any) {
            expect(e?.code).toBe("ERR_S3_INVALID_PATH");
            expect(e?.name).toBe("S3Error");
          }
        });

        it("should error if bucket is missing on payload", async () => {
          try {
            await Bun.write(s3("test.txt", { ...s3Options, bucket: S3Bucket }), s3("test2.txt", s3Options));
            expect.unreachable();
          } catch (e: any) {
            expect(e?.code).toBe("ERR_S3_INVALID_PATH");
            expect(e?.path).toBe("test2.txt");
            expect(e?.name).toBe("S3Error");
          }
        });

        it("should error when invalid method", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path)].map(async fn => {
              const s3file = fn("method-test", {
                ...s3Options,
                bucket: S3Bucket,
              });

              try {
                // @ts-expect-error
                await s3file.presign({ method: "OPTIONS" });
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("ERR_S3_INVALID_METHOD");
              }
            }),
          );
        });

        it("should error when path is too long", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path)].map(async fn => {
              try {
                const s3file = fn("test" + "a".repeat(4096), {
                  ...s3Options,
                  bucket: S3Bucket,
                });

                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                // ERR_STRING_TOO_LONG can occur when the path is too long to convert to a JS string
                expect(["ENAMETOOLONG", "ERR_S3_INVALID_PATH", "ERR_STRING_TOO_LONG"]).toContain(e?.code);
              }
            }),
          );
        });
      });
      describe.concurrent("credentials", () => {
        it("should error with invalid access key id", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path), file].map(async fn => {
              const s3file = fn("s3://bucket/credentials-test", {
                ...s3Options,
                accessKeyId: "invalid",
              });

              try {
                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(["InvalidAccessKeyId", "InvalidArgument"]).toContain(e?.code);
              }
            }),
          );
        });
        it("should error with invalid secret key id", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path), file].map(async fn => {
              const s3file = fn("s3://bucket/credentials-test", {
                ...s3Options,
                secretAccessKey: "invalid",
              });
              try {
                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(["SignatureDoesNotMatch", "AccessDenied"]).toContain(e?.code);
              }
            }),
          );
        });

        it("should error with invalid endpoint", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path), file].map(async fn => {
              try {
                const s3file = fn("s3://bucket/credentials-test", {
                  ...s3Options,
                  endpoint: "🙂.🥯",
                });
                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("ERR_INVALID_ARG_TYPE");
              }
            }),
          );
        });
        it("should error with invalid endpoint", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path), file].map(async fn => {
              try {
                const s3file =
                  credentials.service === "s3-server"
                    ? // The bucket is in another region than the endpoint.
                      fn("s3://buntest-us-west-1/credentials-test", s3Options)
                    : fn("s3://bucket/credentials-test", {
                        ...s3Options, // credentials and endpoint dont match
                        endpoint: "s3.us-west-1.amazonaws.com",
                      });
                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("PermanentRedirect");
              }
            }),
          );
        });
        it("should error with invalid endpoint", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path), file].map(async fn => {
              try {
                const s3file = fn("s3://bucket/credentials-test", {
                  ...s3Options,
                  endpoint: "..asd.@%&&&%%",
                });
                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("ERR_INVALID_ARG_TYPE");
              }
            }),
          );
        });

        it("should error with invalid bucket", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path), file].map(async fn => {
              const s3file = fn("s3://credentials-test", {
                ...s3Options,
                bucket: "invalid",
              });

              try {
                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(["AccessDenied", "NoSuchBucket"]).toContain(e?.code);
                expect(e?.name).toBe("S3Error");
              }
            }),
          );
        });

        it("should error when missing credentials", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path), file].map(async fn => {
              const s3file = fn("s3://credentials-test", {
                bucket: "invalid",
              });

              try {
                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("ERR_S3_MISSING_CREDENTIALS");
              }
            }),
          );
        });
        it("should error when presign missing credentials", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path)].map(async fn => {
              const s3file = fn("method-test", {
                bucket: S3Bucket,
              });

              try {
                await s3file.presign();
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("ERR_S3_MISSING_CREDENTIALS");
              }
            }),
          );
        });

        it("should error when presign with invalid endpoint", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path)].map(async fn => {
              let options = { ...s3Options, bucket: S3Bucket };
              options.endpoint = Buffer.alloc(2048, "a").toString();

              try {
                const s3file = fn(randomUUID(), options);

                await s3file.write("Hello Bun!");
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("ERR_S3_INVALID_ENDPOINT");
              }
            }),
          );
        });
        it("should error when presign with invalid token", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path)].map(async fn => {
              let options = { ...s3Options, bucket: S3Bucket };
              options.sessionToken = Buffer.alloc(4096, "a").toString();

              try {
                const s3file = fn(randomUUID(), options);
                await s3file.presign();
                expect.unreachable();
              } catch (e: any) {
                expect(e?.code).toBe("ERR_S3_INVALID_SESSION_TOKEN");
              }
            }),
          );
        });
      });

      describe.concurrent("S3 static methods", () => {
        describe("presign", () => {
          it("should work", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign();
            expect(url).toBeDefined();
            expect(url.includes("X-Amz-Expires=86400")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });
          it("default endpoint and region should work", async () => {
            let options = { ...s3Options };
            options.endpoint = undefined;
            options.region = undefined;
            const s3file = s3("s3://bucket/credentials-test", options);
            const url = s3file.presign();
            expect(url).toBeDefined();
            expect(url.includes("https://s3.us-east-1.amazonaws.com")).toBe(true);
            expect(url.includes("X-Amz-Expires=86400")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });
          it("default endpoint + region should work", async () => {
            let options = { ...s3Options };
            options.endpoint = undefined;
            options.region = "us-west-1";
            const s3file = s3("s3://bucket/credentials-test", options);
            const url = s3file.presign();
            expect(url).toBeDefined();
            expect(url.includes("https://s3.us-west-1.amazonaws.com")).toBe(true);
            expect(url.includes("X-Amz-Expires=86400")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });
          it("should work with expires", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign({
              expiresIn: 10,
            });
            expect(url).toBeDefined();
            expect(url.includes("X-Amz-Expires=10")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });
          it("should work with acl", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign({
              expiresIn: 10,
              acl: "public-read",
            });
            expect(url).toBeDefined();
            expect(url.includes("X-Amz-Expires=10")).toBe(true);
            expect(url.includes("X-Amz-Acl=public-read")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });

          it("should work with storage class", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign({
              expiresIn: 10,
              storageClass: "GLACIER_IR",
            });
            expect(url).toBeDefined();
            expect(url.includes("X-Amz-Expires=10")).toBe(true);
            expect(url.includes("x-amz-storage-class=GLACIER_IR")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });

          it("s3().presign() should work", async () => {
            const url = s3("s3://bucket/credentials-test", s3Options).presign({
              expiresIn: 10,
            });
            expect(url).toBeDefined();
            expect(url.includes("X-Amz-Expires=10")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });

          it("s3().presign() endpoint should work", async () => {
            const url = s3("s3://bucket/credentials-test", s3Options).presign({
              expiresIn: 10,
              endpoint: "https://s3.bun.sh",
            });
            expect(url).toBeDefined();
            expect(url.includes("https://s3.bun.sh")).toBe(true);
            expect(url.includes("X-Amz-Expires=10")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });

          it("s3().presign() endpoint should work", async () => {
            const url = s3("s3://folder/credentials-test", s3Options).presign({
              expiresIn: 10,
              bucket: "my-bucket",
            });
            expect(url).toBeDefined();
            expect(url.includes("my-bucket")).toBe(true);
            expect(url.includes("X-Amz-Expires=10")).toBe(true);
            expect(url.includes("X-Amz-Date")).toBe(true);
            expect(url.includes("X-Amz-Signature")).toBe(true);
            expect(url.includes("X-Amz-Credential")).toBe(true);
            expect(url.includes("X-Amz-Algorithm")).toBe(true);
            expect(url.includes("X-Amz-SignedHeaders")).toBe(true);
          });
        });

        it("exists, write, size, unlink should work", async () => {
          const fullPath = randomUUID();
          const bucket = S3({
            ...s3Options,
            bucket: S3Bucket,
          });
          expect(await bucket.exists(fullPath)).toBe(false);

          await bucket.write(fullPath, "bun");
          expect(await bucket.exists(fullPath)).toBe(true);
          expect(await bucket.size(fullPath)).toBe(3);
          await bucket.unlink(fullPath);
          expect(await bucket.exists(fullPath)).toBe(false);
        });

        it("should be able to upload a slice", async () => {
          const filename = randomUUID();
          const fullPath = `s3://${S3Bucket}/${filename}`;
          const s3file = s3(fullPath, s3Options);
          await s3file.write("Hello Bun!");
          const slice = s3file.slice(6, 10);
          expect(await slice.text()).toBe("Bun!");
          expect(await s3file.text()).toBe("Hello Bun!");

          await s3file.write(slice);
          const text = await s3file.text();
          expect(text).toBe("Bun!");
          await s3file.unlink();
        });
      });
    });
  });
}

// What fetch() does with the `headers` of a request to an s3:// URL. This server is in
// the process of the test, so that the tests can read its record of the requests.
describe.concurrent("fetch() request headers", () => {
  const server = serve({ buckets: ["headers"] });
  afterAll(() => server.stop());
  const options = server.clientOptions("headers");
  const client = new S3Client(options);

  /** An object with the text "previous". */
  async function existing(s3: S3Client = client, log = server) {
    const key = randomUUIDv7();
    await s3.write(key, "previous");
    /**
     * Reads the object back, then gives what the server got for the key between the write above
     * and that read. The read is a round trip, so a request that was on its way has arrived.
     */
    const after = async () => {
      const text = await s3.file(key).text();
      const requests = log.requests
        .filter(request => request.key === key)
        .slice(1, -1)
        .map(request => ({
          operation: request.operation,
          signed: (/SignedHeaders=([^,]*)/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "").split(";"),
          headers: request.headers,
        }));
      return { text, requests };
    };
    return { key, url: `s3://${key}`, after };
  }

  const outcome = (request: Promise<Response>) =>
    request.then(
      response => ({ status: response.status }),
      error => ({ name: error.name, code: error.code, message: error.message }),
    );
  /** The rejection for a header that fetch() cannot send. The message has the header's name. */
  const refuses = (name: string) => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_VALUE",
    message: expect.stringContaining(`the "${name}" header`),
  });

  it("sends the headers that need no signature", async () => {
    const { url, after } = await existing();
    const response = await fetch(url, {
      method: "PUT",
      body: "next",
      headers: {
        "Cache-Control": "max-age=60",
        "Content-Disposition": "attachment",
        "Content-Encoding": "identity",
        "Content-Type": "text/x-test",
        "Upgrade": "custom",
        "X-Custom": "1",
      },
      s3: options,
    });
    expect(response.status).toBe(200);
    const { text, requests } = await after();
    expect(
      requests.map(put => ({
        operation: put.operation,
        cacheControl: put.headers.get("cache-control"),
        contentDisposition: put.headers.get("content-disposition"),
        contentEncoding: put.headers.get("content-encoding"),
        contentType: put.headers.get("content-type"),
        upgrade: put.headers.get("upgrade"),
        custom: put.headers.get("x-custom"),
        // The signature does not cover the headers of the caller that are not `Content-*`.
        signed: put.signed.filter(name => ["cache-control", "upgrade", "x-custom"].includes(name)),
      })),
    ).toEqual([
      {
        operation: "PutObject",
        cacheControl: "max-age=60",
        contentDisposition: "attachment",
        contentEncoding: "identity",
        contentType: "text/x-test",
        upgrade: "custom",
        custom: "1",
        signed: [],
      },
    ]);
    expect(text).toBe("next");
  });

  it("sends range together with content-type", async () => {
    const { url, after } = await existing();
    const response = await fetch(url, {
      headers: { "Range": "bytes=0-3", "Content-Type": "text/x-test" },
      s3: options,
    });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("prev");
    const { requests } = await after();
    expect(requests.map(get => [get.headers.get("range"), get.headers.get("content-type")])).toEqual([
      ["bytes=0-3", "text/x-test"],
    ]);
  });

  // Without the header, GET and HEAD answer 200, DELETE removes the object, and PUT and POST replace it.
  it.each(["GET", "HEAD", "DELETE", "PUT", "POST"])("a stale If-Match fails a %s", async method => {
    const { url, after } = await existing();
    const body = method === "PUT" || method === "POST" ? "next" : undefined;
    const response = await fetch(url, { method, body, headers: { "If-Match": '"stale"' }, s3: options });
    expect(response.status).toBe(412);
    const { text, requests } = await after();
    expect(requests.map(request => request.headers.get("if-match"))).toEqual(['"stale"']);
    expect(text).toBe("previous");
  });

  it.each([
    ["an object", (headers: Record<string, string>) => headers],
    ["a Headers", (headers: Record<string, string>) => new Headers(headers)],
    ["an array of pairs", (headers: Record<string, string>) => Object.entries(headers)],
  ])("reads the headers from %s", async (_, make) => {
    const { url, after } = await existing();
    const init = (headers: Record<string, string>) => ({
      method: "PUT",
      body: "next",
      headers: make(headers),
      s3: options,
    });
    expect(await outcome(fetch(url, init({ "If-None-Match": "*" })))).toEqual({ status: 412 });
    expect(await outcome(fetch(url, init({ "x-amz-meta-a": "1" })))).toEqual(refuses("x-amz-meta-a"));
    expect((await after()).text).toBe("previous");
  });

  it.each([
    ["fetch(url, init)", (url: string, init: RequestInit) => fetch(url, { ...init, s3: options })],
    ["Bun.fetch(url, init)", (url: string, init: RequestInit) => Bun.fetch(url, { ...init, s3: options })],
    [
      "session.fetch(url, init)",
      (url: string, init: RequestInit) => new Bun.FetchSession().fetch(url, { ...init, s3: options }),
    ],
    ["fetch(request, { s3 })", (url: string, init: RequestInit) => fetch(new Request(url, init), { s3: options })],
    [
      "fetch(request, { headers, s3 })",
      (url: string, { headers, ...init }: RequestInit) => fetch(new Request(url, init), { headers, s3: options }),
    ],
    // @ts-expect-error The types do not have an object with a `url` as the first argument.
    ["fetch({ url, ...init }, { s3 })", (url: string, init: RequestInit) => fetch({ url, ...init }, { s3: options })],
  ] as [string, (url: string, init: RequestInit) => Promise<Response>][])("%s", async (_, call) => {
    const { url, after } = await existing();
    const init = (headers: Record<string, string>) => ({ method: "PUT", body: "next", headers });
    expect(await outcome(call(url, init({ "If-None-Match": "*" })))).toEqual({ status: 412 });
    expect(await outcome(call(url, init({ "x-amz-meta-a": "1" })))).toEqual(refuses("x-amz-meta-a"));
    expect((await after()).text).toBe("previous");
  });

  it("says why it does not send a header", async () => {
    const { url, after } = await existing();
    const message = (init: RequestInit) =>
      fetch(url, { method: "PUT", ...init, s3: options }).then(
        response => `resolved with ${response.status}`,
        error => error.message,
      );
    expect({
      generated: await message({ headers: { "Host": "example.com" } }),
      notSigned: await message({ headers: { "x-amz-copy-source": "/headers/other" } }),
      notInStreamUpload: await message({ headers: { "If-None-Match": "*" }, body: new Blob(["next"]).stream() }),
    }).toEqual({
      generated: 'fetch() to an s3:// URL: the "Host" header is generated by request signing; remove it from headers',
      notSigned:
        'fetch() to an s3:// URL: the "x-amz-copy-source" header needs a signature, and fetch() does not sign request headers',
      notInStreamUpload:
        'fetch() to an s3:// URL: the "If-None-Match" header cannot be sent with a stream body, which is uploaded in parts; pass the body as bytes',
    });
    expect(await after()).toEqual({ text: "previous", requests: [] });
  });

  // The signer writes the first six. The others need a signature, and fetch() signs a fixed set of headers.
  it.each([
    ["host", "Host"],
    ["HOST", "Host"],
    ["authorization", "Authorization"],
    ["x-amz-date", "x-amz-date"],
    ["x-amz-content-sha256", "x-amz-content-sha256"],
    ["X-Amz-Security-Token", "X-Amz-Security-Token"],
    ["x-amz-copy-source", "x-amz-copy-source"],
    ["x-amz-meta-name", "x-amz-meta-name"],
    ["X-Amz-Meta-Name", "X-Amz-Meta-Name"],
    ["x-amz-acl", "x-amz-acl"],
    ["Content-MD5", "Content-MD5"],
  ])("rejects the %s header and sends nothing", async (name, sent) => {
    const { url, after } = await existing();
    // With `x-amz-copy-source` this request would be a copy. Without it, it stores an empty object.
    const request = fetch(url, {
      method: "PUT",
      headers: { "Cache-Control": "max-age=60", [name]: "value" },
      s3: options,
    });
    expect(await outcome(request)).toEqual(refuses(sent));
    expect(await after()).toEqual({ text: "previous", requests: [] });
  });

  it.each([
    ["a typed Blob that is sliced", { body: new Blob(["hello world"], { type: "text/x-test" }).slice(0, 5) }],
    ["an empty Content-Type header", { body: "hello", headers: { "Content-Type": "" } }],
  ])("sends no empty Content-Type for %s", async (_, init) => {
    const { url, after } = await existing();
    const response = await fetch(url, { method: "PUT", ...init, s3: options });
    expect(response.status).toBe(200);
    const { text, requests } = await after();
    expect(requests.map(put => put.headers.has("content-type"))).toEqual([false]);
    expect(text).toBe("hello");
  });

  it("sends the headers with a session token, for each kind of buffered body", async () => {
    using dir = tempDir("s3-fetch-headers", { "body.txt": "next" });
    await using withToken = serve({
      buckets: ["headers"],
      credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "secret", sessionToken: "token" },
    });
    const s3 = withToken.clientOptions("headers");
    const bodies: [string, BodyInit, string | null][] = [
      ["a string", "next", null],
      ["a Uint8Array", new TextEncoder().encode("next"), null],
      ["a Blob with a type", new Blob(["next"], { type: "text/x-blob" }), "text/x-blob"],
      ["a file", file(path.join(String(dir), "body.txt")), "text/plain;charset=utf-8"],
      ["URLSearchParams", new URLSearchParams({ next: "" }), "application/x-www-form-urlencoded;charset=UTF-8"],
    ];
    for (const [kind, body, contentType] of bodies) {
      const { url, after } = await existing(new S3Client(s3), withToken);
      const response = await fetch(url, { method: "PUT", body, headers: { "Cache-Control": "max-age=60" }, s3 });
      const { requests } = await after();
      expect({
        kind,
        status: response.status,
        requests: requests.map(put => ({
          cacheControl: put.headers.get("cache-control"),
          contentType: put.headers.get("content-type"),
          token: put.headers.get("x-amz-security-token"),
          tokenIsSigned: put.signed.includes("x-amz-security-token"),
        })),
      }).toEqual({
        kind,
        status: 200,
        requests: [{ cacheControl: "max-age=60", contentType, token: "token", tokenIsSigned: true }],
      });
    }
  });

  it("sends the headers through a proxy", async () => {
    await using proxy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: request => fetch(request.url, { method: request.method, headers: request.headers, body: request.body }),
    });
    const { url, after } = await existing();
    const response = await fetch(url, {
      method: "PUT",
      body: "next",
      headers: { "If-None-Match": "*" },
      proxy: proxy.url.href,
      s3: options,
    });
    expect(response.status).toBe(412);
    expect(await after()).toMatchObject({ text: "previous", requests: [{ operation: "PutObject" }] });
  });

  describe("with a stream body", () => {
    const chunk = () => new TextEncoder().encode("next");
    const stream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk());
          controller.close();
        },
      });
    /** The body of a response whose last bytes have not arrived. */
    async function arriving() {
      const { promise: end, resolve: finish } = Promise.withResolvers<void>();
      const origin = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () =>
          new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(chunk());
                await end;
                controller.close();
              },
            }),
          ),
      });
      const response = await fetch(origin.url);
      return {
        body: response.body!,
        async [Symbol.asyncDispose]() {
          finish();
          await origin.stop(true);
        },
      };
    }

    // A stream whose bytes have all arrived is sent as one request. The rule is the same for it.
    it.each([
      ["a ReadableStream", stream],
      [
        "an async generator",
        () =>
          async function* () {
            yield "next";
          },
      ],
      ["the stream of a Blob", () => new Blob(["next"]).stream()],
      ["the body of a Response", () => new Response("next").body!],
    ] as [string, () => Bun.BodyInit][])("%s: rejects a header that S3 acts on", async (_, body) => {
      const { url, after } = await existing();
      for (const [name, sent] of [
        ["If-None-Match", "If-None-Match"],
        ["if-unmodified-since", "If-Unmodified-Since"],
        ["Cache-Control", "Cache-Control"],
        ["Content-Language", "Content-Language"],
        ["Expires", "Expires"],
      ]) {
        const request = fetch(url, { method: "PUT", body: body(), headers: { [name]: "*" }, s3: options });
        expect(await outcome(request)).toEqual(refuses(sent));
      }
      expect(await after()).toEqual({ text: "previous", requests: [] });
    });

    it("a response body that is still arriving: rejects a header that S3 acts on", async () => {
      await using held = await arriving();
      const { url, after } = await existing();
      const request = fetch(url, { method: "PUT", body: held.body, headers: { "If-None-Match": "*" }, s3: options });
      expect(await outcome(request)).toEqual(refuses("If-None-Match"));
      expect(await after()).toEqual({ text: "previous", requests: [] });
    });

    it("an S3 object: rejects before it reads the object", async () => {
      const source = await existing();
      const { url, after } = await existing();
      const request = fetch(url, {
        method: "PUT",
        body: client.file(source.key),
        headers: { "If-None-Match": "*" },
        s3: options,
      });
      expect(await outcome(request)).toEqual(refuses("If-None-Match"));
      expect(await after()).toEqual({ text: "previous", requests: [] });
      expect((await source.after()).requests).toEqual([]);
    });

    it("cancels the stream with the error", async () => {
      const { url } = await existing();
      const { promise: cancelled, resolve: cancel } = Promise.withResolvers();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk());
          controller.close();
        },
        cancel,
      });
      const error = await fetch(url, { method: "PUT", body, headers: { "If-None-Match": "*" }, s3: options }).then(
        () => undefined,
        error => error,
      );
      expect({ name: error?.name, code: error?.code, message: error?.message }).toEqual(refuses("If-None-Match"));
      expect(await cancelled).toBe(error);
    });

    // A fetch() that a tracing library wraps has headers that the program did not write.
    it.each([
      ["a ReadableStream", stream],
      ["the stream of a Blob", () => new Blob(["next"]).stream()],
    ] as [string, () => Bun.BodyInit][])("%s: uploads with headers that S3 does not act on", async (_, body) => {
      const { url, after } = await existing();
      const response = await fetch(url, {
        method: "PUT",
        body: body(),
        headers: {
          "Accept": "*/*",
          "Baggage": "sentry-environment=production",
          "Content-Length": "4",
          "Content-Type": "text/x-test",
          "Sentry-Trace": "12345678901234567890123456789012-1234567890123456-1",
          "Traceparent": "00-12345678901234567890123456789012-1234567890123456-01",
        },
        s3: options,
      });
      expect(response.status).toBe(200);
      const { text, requests } = await after();
      expect(requests.map(put => [put.operation, put.headers.get("content-type")])).toEqual([
        ["PutObject", "text/x-test"],
      ]);
      expect(text).toBe("next");
    });

    it("uploads with the three headers that the upload carries, and signs two of them", async () => {
      const { url, after } = await existing();
      const response = await fetch(url, {
        method: "PUT",
        body: stream(),
        headers: {
          "Content-Type": "text/x-test",
          "Content-Disposition": "attachment",
          "Content-Encoding": "identity",
        },
        s3: options,
      });
      expect(response.status).toBe(200);
      const { text, requests } = await after();
      expect(
        requests.map(put => ({
          contentType: put.headers.get("content-type"),
          contentDisposition: put.headers.get("content-disposition"),
          contentEncoding: put.headers.get("content-encoding"),
          signed: put.signed.filter(name => name.startsWith("content-")),
        })),
      ).toEqual([
        {
          contentType: "text/x-test",
          contentDisposition: "attachment",
          contentEncoding: "identity",
          signed: ["content-disposition", "content-encoding"],
        },
      ]);
      expect(text).toBe("next");
    });

    it("a GET keeps the error for its body", async () => {
      const { url, after } = await existing();
      const request = fetch(url, { method: "GET", body: stream(), headers: { "If-None-Match": "*" }, s3: options });
      expect(await outcome(request)).toEqual({
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
        message: "fetch() request with GET/HEAD method cannot have body.",
      });
      expect(await after()).toEqual({ text: "previous", requests: [] });
    });
  });

  it("rejects for the header before it opens a file body", async () => {
    using dir = tempDir("s3-fetch-headers", {});
    const { url, after } = await existing();
    const request = fetch(url, {
      method: "PUT",
      body: file(path.join(String(dir), "does-not-exist")),
      headers: { "x-amz-meta-name": "value" },
      s3: options,
    });
    expect(await outcome(request)).toEqual(refuses("x-amz-meta-name"));
    expect(await after()).toEqual({ text: "previous", requests: [] });
  });

  // The child holds the copy of these headers that fetch() makes, which is 4 GiB.
  it.skipIf(isDebug || isASAN || totalmem() < 12 * 1024 ** 3)(
    "rejects headers that do not fit beside the headers of the signature",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          /* js */ `
            // The 16 values share one 256 MiB string. Names and values total 2 ** 32 - 1 bytes,
            // which is the most that the headers of a request can have.
            const value = Buffer.alloc(2 ** 28, "a").toString("latin1");
            const headers = new Headers();
            for (let i = 0; i < 15; i++) headers.append("set-cookie", value);
            headers.append("set-cookie", value.slice(0, 2 ** 28 - 161));

            let requests = 0;
            using server = Bun.serve({ port: 0, fetch: () => (requests++, new Response("ok")) });
            const s3 = { accessKeyId: "a", secretAccessKey: "b", bucket: "bucket", endpoint: server.url.href };
            const outcome = await fetch("s3://key", { headers, s3 }).then(
              response => "resolved with " + response.status,
              error => error.name + ": " + error.message,
            );
            console.log(outcome);
            console.log(requests);
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("RangeError: Headers exceed the maximum total size of 4294967295 bytes\n0\n");
      expect(exitCode).toBe(0);
    },
    60_000,
  );

  it("rejects for the header before it reads an aborted signal", async () => {
    const { url, after } = await existing();
    const request = fetch(url, {
      headers: { "x-amz-meta-name": "value" },
      signal: AbortSignal.abort(),
      s3: options,
    });
    expect(await outcome(request)).toEqual(refuses("x-amz-meta-name"));
    expect(await after()).toEqual({ text: "previous", requests: [] });
  });
});

describe("s3-server", () => {
  const testDir = tempDirWithFiles("s3-credential-test", {
    "index.mjs": `
      import { s3, randomUUIDv7 } from "bun";
      import { expect } from "bun:test";
      const name = randomUUIDv7("hex") + ".txt";
      const s3file = s3.file(name);
      await s3file.write("Hello Bun!");
      try {
        const text = await s3file.text();
        expect(text).toBe("Hello Bun!");
        process.stdout.write(text);
      } finally {
        await s3file.unlink();
      }
    `,
  });
  describe("http endpoint should work when using env variables", () => {
    for (const endpoint of ["S3_ENDPOINT", "AWS_ENDPOINT"]) {
      it.concurrent(endpoint, async () => {
        const { stdout, stderr, exited } = Bun.spawn({
          cmd: [bunExe(), path.join(testDir, "index.mjs")],
          env: {
            ...bunEnv,
            // @ts-ignore
            [endpoint]: localCredentials.endpoint as string,
            "S3_BUCKET": localCredentials.bucket as string,
            "S3_REGION": localCredentials.region as string,
            "S3_ACCESS_KEY_ID": localCredentials.accessKeyId as string,
            "S3_SECRET_ACCESS_KEY": localCredentials.secretAccessKey as string,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(await stderr.text()).toBe("");
        expect(await stdout.text()).toBe("Hello Bun!");
        expect(await exited).toBe(0);
      });
    }
  });

  describe.concurrent("should accept / or \\ in start and end of bucket name", () => {
    let bucketPrefixI = 0;
    for (let start of ["/", "\\", ""]) {
      for (let end of ["/", "\\", ""]) {
        let bucket = "buntest";
        if (start) {
          bucket = start + bucket;
        }
        if (end) {
          bucket += end;
        }
        it(`should work with ${start}${bucket}${end}`, async () => {
          const s3 = S3({
            ...localCredentials,
            bucket,
          });
          const file = s3.file(`${bucketPrefixI++} test.txt`);
          await file.write("Hello Bun!");
          const text = await file.text();
          expect(text).toBe("Hello Bun!");
          expect(await file.exists()).toBe(true);
          await file.unlink();
          expect(await file.exists()).toBe(false);
        });
      }
    }
  });
});

describe.concurrent("s3 missing credentials", () => {
  async function assertMissingCredentials(fn: () => Promise<any>) {
    try {
      await fn();
      expect.unreachable();
    } catch (e: any) {
      expect(e?.code).toBe("ERR_S3_MISSING_CREDENTIALS");
    }
  }
  it("unlink", async () => {
    assertMissingCredentials(async () => {
      await Bun.s3.unlink("test");
    });
  });
  it("write", async () => {
    assertMissingCredentials(async () => {
      await Bun.s3.write("test", "test");
    });
  });
  it("exists", async () => {
    assertMissingCredentials(async () => {
      await Bun.s3.exists("test");
    });
  });
  it("size", async () => {
    assertMissingCredentials(async () => {
      await Bun.s3.size("test");
    });
  });
  it("stat", async () => {
    assertMissingCredentials(async () => {
      await Bun.s3.stat("test");
    });
  });
  it("presign", async () => {
    assertMissingCredentials(async () => {
      await Bun.s3.presign("test");
    });
  });
  it("file", async () => {
    assertMissingCredentials(async () => {
      await Bun.s3.file("test").text();
    });
    assertMissingCredentials(async () => {
      await Bun.s3.file("test").bytes();
    });
    assertMissingCredentials(async () => {
      await Bun.s3.file("test").json();
    });
    assertMissingCredentials(async () => {
      await Bun.s3.file("test").formData();
    });
    assertMissingCredentials(async () => {
      await Bun.s3.file("test").delete();
    });
    assertMissingCredentials(async () => {
      await Bun.s3.file("test").exists();
    });
    assertMissingCredentials(async () => {
      await Bun.s3.file("test").stat();
    });
  });
});

// Archive + S3 integration tests
describe("Archive with S3", () => {
  const credentials = localCredentials;

  it("writes archive to S3 via S3Client.write()", async () => {
    const client = new Bun.S3Client(credentials);
    const archive = new Bun.Archive({
      "hello.txt": "Hello from Archive!",
      "data.json": JSON.stringify({ test: true }),
    });

    const key = randomUUIDv7() + ".tar";
    await client.write(key, archive);

    // Verify by downloading and reading back
    const downloaded = await client.file(key).bytes();
    const readArchive = new Bun.Archive(downloaded);
    const files = await readArchive.files();

    expect(files.size).toBe(2);
    expect(await files.get("hello.txt")!.text()).toBe("Hello from Archive!");
    expect(await files.get("data.json")!.text()).toBe(JSON.stringify({ test: true }));

    // Cleanup
    await client.unlink(key);
  });

  it("writes archive to S3 via Bun.write() with s3:// URL", async () => {
    const archive = new Bun.Archive({
      "file1.txt": "content1",
      "dir/file2.txt": "content2",
    });

    const key = randomUUIDv7() + ".tar";
    const s3Url = `s3://${credentials.bucket}/${key}`;

    await Bun.write(s3Url, archive, {
      ...credentials,
    } as any);

    // Verify by downloading
    const s3File = Bun.file(s3Url, credentials);
    const downloaded = await s3File.bytes();
    const readArchive = new Bun.Archive(downloaded);
    const files = await readArchive.files();

    expect(files.size).toBe(2);
    expect(await files.get("file1.txt")!.text()).toBe("content1");
    expect(await files.get("dir/file2.txt")!.text()).toBe("content2");

    // Cleanup
    await s3File.delete();
  });

  it("writes archive with binary content to S3", async () => {
    const client = new Bun.S3Client(credentials);
    const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x80, 0x7f]);
    const archive = new Bun.Archive({
      "binary.bin": binaryData,
    });

    const key = randomUUIDv7() + ".tar";
    await client.write(key, archive);

    // Verify binary data is preserved
    const downloaded = await client.file(key).bytes();
    const readArchive = new Bun.Archive(downloaded);
    const files = await readArchive.files();
    const extractedBinary = await files.get("binary.bin")!.bytes();

    expect(extractedBinary).toEqual(binaryData);

    // Cleanup
    await client.unlink(key);
  });

  it("writes large archive to S3", async () => {
    const client = new Bun.S3Client(credentials);

    // Create archive with multiple files
    const entries: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      entries[`file${i.toString().padStart(3, "0")}.txt`] = `Content for file ${i}`;
    }
    const archive = new Bun.Archive(entries);

    const key = randomUUIDv7() + ".tar";
    await client.write(key, archive);

    // Verify
    const downloaded = await client.file(key).bytes();
    const readArchive = new Bun.Archive(downloaded);
    const files = await readArchive.files();

    expect(files.size).toBe(50);
    expect(await files.get("file000.txt")!.text()).toBe("Content for file 0");
    expect(await files.get("file049.txt")!.text()).toBe("Content for file 49");

    // Cleanup
    await client.unlink(key);
  });

  it("writes archive via s3File.write()", async () => {
    const client = new Bun.S3Client(credentials);
    const archive = new Bun.Archive({
      "test.txt": "Hello via s3File.write()!",
    });

    const key = randomUUIDv7() + ".tar";
    const s3File = client.file(key);
    await s3File.write(archive);

    // Verify
    const downloaded = await s3File.bytes();
    const readArchive = new Bun.Archive(downloaded);
    const files = await readArchive.files();

    expect(files.size).toBe(1);
    expect(await files.get("test.txt")!.text()).toBe("Hello via s3File.write()!");

    // Cleanup
    await s3File.delete();
  });
});

describe("s3 multipart upload id validation", () => {
  it("rejects a CreateMultipartUpload response whose upload id contains non-ASCII bytes", async () => {
    // The whole scenario runs in a subprocess so a misbehaving runtime cannot take down the test runner.
    const fixture = `
        const goodUploadId = "valid-upload-id-1234567890";
        function initiateXml(uploadIdBytes) {
          return Buffer.concat([
            Buffer.from("<InitiateMultipartUploadResult><Bucket>my_bucket</Bucket><Key>obj</Key><UploadId>"),
            uploadIdBytes,
            Buffer.from("</UploadId></InitiateMultipartUploadResult>"),
          ]);
        }
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            const isCreateMultipartUpload = req.method === "POST" && req.url.includes("?uploads=");
            if (isCreateMultipartUpload) {
              // The "malformed-id-object" key gets an upload id made entirely of bytes >= 0x80,
              // which no real S3 server returns. Everything else gets a normal ASCII upload id.
              const uploadId = req.url.includes("malformed-id-object")
                ? Buffer.alloc(1024, 0xff)
                : Buffer.from(goodUploadId);
              return new Response(initiateXml(uploadId), {
                status: 200,
                headers: { "Content-Type": "text/xml" },
              });
            }
            const isCompleteMultipartUpload = req.method === "POST" && req.url.includes("uploadId=");
            if (isCompleteMultipartUpload) {
              return new Response(
                '<CompleteMultipartUploadResult><Bucket>my_bucket</Bucket><Key>obj</Key><ETag>"etag"</ETag></CompleteMultipartUploadResult>',
                { status: 200, headers: { "Content-Type": "text/xml" } },
              );
            }
            return new Response(undefined, { status: 200, headers: { "ETag": '"etag"' } });
          },
        });

        const client = new Bun.S3Client({
          accessKeyId: "test",
          secretAccessKey: "test",
          region: "eu-west-3",
          bucket: "my_bucket",
          endpoint: server.url.href,
        });

        // One part size plus 1 MiB so the writer takes the multipart path instead of a single PUT.
        const part = Buffer.alloc(6 * 1024 * 1024, "a");

        {
          const writer = client.file("malformed-id-object").writer({ partSize: 5 * 1024 * 1024 });
          writer.write(part);
          try {
            await writer.end();
            console.log("malformed-id: resolved");
          } catch (err) {
            console.log("malformed-id: rejected", err?.code, "-", err?.message);
          }
        }

        {
          const writer = client.file("valid-id-object").writer({ partSize: 5 * 1024 * 1024 });
          writer.write(part);
          await writer.end();
          console.log("valid-id: resolved");
        }

        server.stop(true);
      `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // A server-supplied upload id containing non-ASCII bytes must surface as a normal S3 error
    // on the writer promise instead of terminating the process.
    expect(stdout).toContain("malformed-id: rejected UnknownError - Failed to initiate multipart upload");
    // A well-formed upload id still completes the multipart upload in the same process.
    expect(stdout).toContain("valid-id: resolved");
    expect(exitCode).toBe(0);
  }, 60_000);
});

describe("s3 upload stream body error", () => {
  // The readStreamIntoSink abrupt path dispatches a single-file PUT before
  // the pump promise rejects; the PUT's response callback must not read a
  // freed MultiPartUpload when fail() runs from the reject handler.
  it("does not UAF when a ReadableStream body errors after enqueue", async () => {
    const fixture = `
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          await req.arrayBuffer();
          return new Response(undefined, { status: 200, headers: { ETag: '"etag"' } });
        },
      });
      const client = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "eu-west-3",
        bucket: "my_bucket",
        endpoint: \`http://127.0.0.1:\${server.port}\`,
        virtualHostedStyle: false,
      });
      for (let i = 0; i < 5; i++) {
        const rs = new ReadableStream({
          async pull(controller) {
            controller.enqueue(new Uint8Array(1024));
            await Bun.sleep(1);
            controller.error(new Error("boom"));
          },
        });
        let caught = "none";
        try {
          await client.write("obj", new Request("https://example.com", { method: "PUT", body: rs }));
        } catch (e) { caught = e.message; }
        console.log("iter", i, caught);
        Bun.gc(true);
        await Bun.sleep(5);
      }
      server.stop(true);
      console.log("done");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: "iter 0 boom\niter 1 boom\niter 2 boom\niter 3 boom\niter 4 boom\ndone",
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // A JS ReadableStream body that errors after some chunks. The pump closes the
  // sink with the error before the write() promise rejects; that close used to
  // be a clean end, which committed the buffered chunks as a complete
  // single-file PUT while the caller saw the rejection. The upload must be
  // aborted instead: no PUT for the object, and the promise rejects with the
  // source's own error.
  it.each([
    [
      "async pull",
      "await Bun.sleep(1); if (n++ < 2) controller.enqueue(new Uint8Array(1024)); else controller.error(new Error('boom'));",
      "rejected boom",
    ],
    [
      "sync pull",
      "if (n++ < 2) controller.enqueue(new Uint8Array(1024)); else controller.error(new Error('boom'));",
      "rejected boom",
    ],
    // error() with no reason still errors the stream; the sink must not read
    // the undefined reason as a clean close.
    [
      "error() without a reason",
      "if (n++ < 2) controller.enqueue(new Uint8Array(1024)); else controller.error();",
      "rejected ReadableStream ended with an error",
    ],
  ])("does not commit a PUT when a ReadableStream body errors after enqueue (%s)", async (_, pullBody, expected) => {
    const fixture = `
      const puts = {};
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const key = new URL(req.url).pathname;
          puts[key] = (puts[key] ?? 0) + (await req.arrayBuffer()).byteLength;
          return new Response(undefined, { status: 200, headers: { ETag: '"etag"' } });
        },
      });
      const client = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "eu-west-3",
        bucket: "my_bucket",
        endpoint: \`http://127.0.0.1:\${server.port}\`,
        virtualHostedStyle: false,
      });
      let n = 0;
      const rs = new ReadableStream({
        async pull(controller) { ${pullBody} },
      });
      const outcome = await client.write("obj", rs).then(
        bytes => "resolved " + bytes,
        e => "rejected " + e.message,
      );
      // A healthy upload afterwards proves the client still works and, having
      // round-tripped through the same server, that no earlier PUT is pending.
      const after = await client.write("ok", "x");
      server.stop(true);
      console.log(JSON.stringify({ outcome, after, puts }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      // The S3 client honors the proxy environment; the stub is on loopback.
      env: { ...bunEnv, HTTP_PROXY: undefined, HTTPS_PROXY: undefined, http_proxy: undefined, https_proxy: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      outcome: expected,
      after: 1,
      puts: { "/my_bucket/ok": 1 },
    });
    expect(exitCode).toBe(0);
  });

  // A `type: "direct"` pull() ends the body through the sink controller's own
  // `close(error?)`. The argument is optional, so a falsy one is the same clean
  // close as `close()`: the bytes written so far are the object and the PUT
  // goes out. Only a truthy error aborts the upload.
  it.each([
    ["", "resolved 12", { "/my_bucket/obj": 12, "/my_bucket/ok": 1 }],
    ["undefined", "resolved 12", { "/my_bucket/obj": 12, "/my_bucket/ok": 1 }],
    ["null", "resolved 12", { "/my_bucket/obj": 12, "/my_bucket/ok": 1 }],
    ["false", "resolved 12", { "/my_bucket/obj": 12, "/my_bucket/ok": 1 }],
    ['""', "resolved 12", { "/my_bucket/obj": 12, "/my_bucket/ok": 1 }],
    ["new Error('boom')", "rejected boom", { "/my_bucket/ok": 1 }],
  ])("a direct stream body that calls controller.close(%s)", async (closeArg, expectedOutcome, expectedPuts) => {
    const fixture = `
      const puts = {};
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const key = new URL(req.url).pathname;
          puts[key] = (puts[key] ?? 0) + (await req.arrayBuffer()).byteLength;
          return new Response(undefined, { status: 200, headers: { ETag: '"etag"' } });
        },
      });
      const client = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "eu-west-3",
        bucket: "my_bucket",
        endpoint: \`http://127.0.0.1:\${server.port}\`,
        virtualHostedStyle: false,
      });
      const rs = new ReadableStream({
        type: "direct",
        pull(controller) {
          controller.write("<b>hello</b>");
          controller.close(${closeArg});
        },
      });
      const outcome = await client.write("obj", new Response(rs)).then(
        bytes => "resolved " + bytes,
        e => "rejected " + e.message,
      );
      const after = await client.write("ok", "x");
      server.stop(true);
      console.log(JSON.stringify({ outcome, after, puts }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      // The S3 client honors the proxy environment; the stub is on loopback.
      env: { ...bunEnv, HTTP_PROXY: undefined, HTTPS_PROXY: undefined, http_proxy: undefined, https_proxy: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({
      outcome: expectedOutcome,
      after: 1,
      puts: expectedPuts,
    });
    expect(exitCode).toBe(0);
  });

  // A native ByteStream source (fetch response body) that errors mid-stream must
  // reject the s3.write() promise with the original JS error, not commit a
  // truncated PUT or reject with a generic UnknownError.
  it("rejects with the upstream error when a native ByteStream body fails mid-upload", async () => {
    const fixture = `
      const net = require("node:net");
      let putBytes = 0;
      const s3srv = Bun.serve({
        port: 0,
        async fetch(req) {
          if (req.method === "PUT") {
            putBytes += (await req.arrayBuffer()).byteLength;
          }
          return new Response(undefined, { status: 200, headers: { ETag: '"etag"' } });
        },
      });
      // Raw-socket source so we can drop the connection mid-body; the client's
      // fetch Response body is a native ByteStream that then errors with
      // ECONNRESET as a JS error.
      const source = net.createServer(sock => {
        sock.write(
          "HTTP/1.1 200 OK\\r\\nContent-Length: 65536\\r\\n\\r\\n" +
            Buffer.alloc(1024, 0x41).toString("latin1"),
        );
        setTimeout(() => sock.destroy(), 10);
      });
      await new Promise(r => source.listen(0, "127.0.0.1", r));
      const client = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "eu-west-3",
        bucket: "my_bucket",
        endpoint: \`http://127.0.0.1:\${s3srv.port}\`,
        virtualHostedStyle: false,
      });
      const upstream = await fetch(\`http://127.0.0.1:\${source.address().port}\`);
      let caught = null;
      try {
        await client.write("obj", upstream);
      } catch (e) {
        caught = { code: e.code, name: e.name };
      }
      s3srv.stop(true);
      source.close();
      console.log(JSON.stringify({ caught, putBytes }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { caught, putBytes } = JSON.parse(stdout.trim());
    // The upstream connection reset surfaces as the original error, not a
    // generic "UnknownError", and the upload is aborted rather than committed.
    expect(caught?.code).toBe("ECONNRESET");
    expect(putBytes).toBe(0);
    expect(exitCode).toBe(0);
  });

  // A fetch response body is a native ByteStream; passing it to s3.write must pipe it
  // into the S3 NetworkSink without buffering the whole object and without spinning.
  it("uploads a fetch response body via the native ByteStream -> NetworkSink path", async () => {
    const fixture = `
      const chunkSize = 64 * 1024;
      const chunkCount = 160; // ~10 MB
      const totalBytes = chunkSize * chunkCount;
      let received = 0;
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          if (url.pathname === "/big") {
            let sent = 0;
            return new Response(
              new ReadableStream({
                type: "direct",
                async pull(controller) {
                  while (sent < chunkCount) {
                    controller.write(Buffer.alloc(chunkSize, 0x42));
                    sent++;
                    await controller.flush();
                  }
                  controller.close();
                },
              }),
            );
          }
          if (req.method === "POST" && url.search.includes("uploads")) {
            return new Response(
              '<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>my_bucket</Bucket><Key>obj</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>',
              { headers: { "content-type": "application/xml" } },
            );
          }
          if (req.method === "PUT") {
            const { byteLength } = await req.arrayBuffer();
            received += byteLength;
            return new Response(undefined, { status: 200, headers: { ETag: '"etag"' } });
          }
          if (req.method === "POST" && url.search.includes("uploadId")) {
            await req.arrayBuffer();
            return new Response(
              '<?xml version="1.0"?><CompleteMultipartUploadResult><ETag>"etag"</ETag></CompleteMultipartUploadResult>',
              { headers: { "content-type": "application/xml" } },
            );
          }
          return new Response(undefined, { status: 200, headers: { ETag: '"etag"' } });
        },
      });
      const client = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "eu-west-3",
        bucket: "my_bucket",
        endpoint: \`http://127.0.0.1:\${server.port}\`,
        virtualHostedStyle: false,
      });
      const upstream = await fetch(\`http://127.0.0.1:\${server.port}/big\`);
      // S3Client.write() does not accept a bare ReadableStream; passing the Response
      // routes BodyValue::Locked -> upload_stream(), which matches the native
      // ByteStream -> NetworkSink fast-path this test exercises.
      await client.write("obj", upstream);
      server.stop(true);
      console.log(JSON.stringify({ received, totalBytes }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { received, totalBytes } = JSON.parse(stdout.trim());
    expect(received).toBe(totalBytes);
    expect(exitCode).toBe(0);
  });
});

describe("presigned url signature", () => {
  function verifyPresignedUrl(presigned: string, credentials: { secretAccessKey: string; region: string }) {
    const url = new URL(presigned);
    const params = presigned.split("?")[1].split("&");
    const signature = params.find(p => p.startsWith("X-Amz-Signature="))!.slice("X-Amz-Signature=".length);
    const canonicalQuery = params.filter(p => !p.startsWith("X-Amz-Signature=")).join("&");
    const amzDate = params.find(p => p.startsWith("X-Amz-Date="))!.slice("X-Amz-Date=".length);
    const day = amzDate.slice(0, 8);
    const canonicalRequest = [
      "GET",
      url.pathname,
      canonicalQuery,
      `host:${url.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      `${day}/${credentials.region}/s3/aws4_request`,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
    const signingKey = hmac(
      hmac(hmac(hmac("AWS4" + credentials.secretAccessKey, day), credentials.region), "s3"),
      "aws4_request",
    );
    const expected = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    return { signature, expected };
  }

  it("derives the signing key from each credential's own region and secret", () => {
    const commonOptions = {
      accessKeyId: "test-access-key",
      bucket: "bucket",
      endpoint: "https://s3.example.com",
    };
    const credentialsA = { ...commonOptions, region: "us-east-1", secretAccessKey: "collides3keys" };
    const credentialsB = { ...commonOptions, region: "us-east-1s3collide", secretAccessKey: "keys" };
    for (const credentials of [credentialsA, credentialsB, credentialsA, credentialsB]) {
      const client = new Bun.S3Client(credentials);
      const presigned = client.presign("credentials-test");
      const { signature, expected } = verifyPresignedUrl(presigned, credentials);
      expect(signature).toBe(expected);
    }
  });
});
