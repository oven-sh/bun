import type { S3Options } from "bun";
import { S3Client, s3 as defaultS3, file, randomUUIDv7 } from "bun";
import { describe, expect, it } from "bun:test";
import child_process from "child_process";
import { randomUUID } from "crypto";
import { bunEnv, bunExe, dockerExe, getSecret, isCI, isDockerEnabled, tempDirWithFiles } from "harness";
import path from "path";
const s3 = (...args) => defaultS3.file(...args);
const S3 = (...args) => new S3Client(...args);

// Import docker-compose helper
import * as dockerCompose from "../../../docker/index.ts";

const dockerCLI = dockerExe() as string;
type S3Credentials = S3Options & {
  service: string;
};
let minioCredentials: S3Credentials | undefined;
const allCredentials: S3Credentials[] = [
  {
    accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
    secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
    endpoint: getSecret("S3_R2_ENDPOINT"),
    bucket: getSecret("S3_R2_BUCKET"),
    service: "R2" as string,
  },
];

if (isDockerEnabled()) {
  // Use docker-compose to start MinIO
  const minioInfo = await dockerCompose.ensure("minio");

  // Get container name for docker exec
  const containerName = child_process
    .execSync(
      `docker ps --filter "ancestor=minio/minio:latest" --filter "status=running" --format "{{.Names}}" | head -1`,
      { encoding: "utf-8" },
    )
    .trim();

  if (containerName) {
    // Create a bucket using mc inside the container
    child_process.spawnSync(dockerCLI, [`exec`, containerName, `mc`, `mb`, `data/buntest`], {
      stdio: "ignore",
    });
  }

  minioCredentials = {
    endpoint: `http://${minioInfo.host}:${minioInfo.ports[9000]}`, // MinIO endpoint from docker-compose
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "buntest",
    service: "MinIO" as string,
  };
  allCredentials.push(minioCredentials);
}
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
                  } catch (e) {
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
                    it.skipIf(credentials.service !== "MinIO")(
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
                const s3file = file(tmpfile.name, { ...options, type: "text/css" });
                await s3file.write("Hello Bun!");
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/css");
              }
              {
                const s3file = file(tmpfile.name, options);
                await s3file.write("Hello Bun!", { type: "text/plain" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }

              {
                const s3file = file(tmpfile.name, options);
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
          const dir = tempDirWithFiles("fsr", {
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
                const s3file = fn("s3://bucket/credentials-test", {
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
describe.skipIf(!minioCredentials)("minio", () => {
  const testDir = tempDirWithFiles("minio-credential-test", {
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
            [endpoint]: minioCredentials!.endpoint as string,
            "S3_BUCKET": minioCredentials!.bucket as string,
            "S3_ACCESS_KEY_ID": minioCredentials!.accessKeyId as string,
            "S3_SECRET_ACCESS_KEY": minioCredentials!.secretAccessKey as string,
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
            ...minioCredentials,
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
describe.skipIf(!minioCredentials)("Archive with S3", () => {
  const credentials = minioCredentials!;

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
    });

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
