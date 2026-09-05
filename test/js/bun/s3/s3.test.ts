import type { S3Options } from "bun";
import { S3Client, s3 as defaultS3, file, randomUUIDv7 } from "bun";
import { describe, expect, it } from "bun:test";
import child_process from "child_process";
import { createHash, createHmac, randomUUID } from "crypto";
import { bunEnv, bunExe, dockerExe, getSecret, isCI, isDockerEnabled, tempDir, tempDirWithFiles } from "harness";
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

    // Larger than the default 5 MiB part size. An in-memory payload of this size still goes out as one PUT
    // (only streams are uploaded in parts), so the "one go" tests cover one large request and one large download.
    // Two of them through a writer() need three parts.
    const bigPayload = makePayLoadFrom("Bun is the best runtime ever", 5 * 1024 * 1024 + 1024);
    // more than 5 MiB but less than 2 parts size
    const mediumPayload = makePayLoadFrom("Bun is the best runtime ever", 6 * 1024 * 1024);
    // less than 5 MiB
    const bigishPayload = makePayLoadFrom("Bun is the best runtime ever", 1 * 1024 * 1024);

    // Reads a stream to the end through its reader, the way a consumer that pulls chunk by chunk does.
    async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
    describe.skipIf(!s3Options.accessKeyId)("s3", () => {
      for (let bucketInName of [true, false]) {
        describe.concurrent("fetch", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };

            function uniqueKey() {
              return bucketInName ? `s3://${S3Bucket}/${randomUUID()}` : `s3://${randomUUID()}`;
            }

            // A unique key that is deleted when the test ends.
            function tmpKey() {
              const name = uniqueKey();
              return {
                name,
                [Symbol.asyncDispose]: async () => {
                  const result = await fetch(name, { method: "DELETE", s3: options });
                  expect([204, 200, 404]).toContain(result.status);
                },
              };
            }

            // A unique key that holds "Hello Bun!" and is deleted when the test ends.
            async function tmp() {
              const key = tmpKey();
              const result = await fetch(key.name, {
                method: "PUT",
                body: "Hello Bun!",
                s3: options,
              });
              expect(result.status).toBe(200);
              return key;
            }

            it("should download file via fetch GET", async () => {
              await using tmpfile = await tmp();
              const result = await fetch(tmpfile.name, { s3: options });
              expect(result.status).toBe(200);
              expect(result.headers.get("content-length")).toBe("10");
              expect(await result.text()).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              await using tmpfile = await tmp();
              const result = await fetch(tmpfile.name, {
                headers: { "range": "bytes=6-10" },
                s3: options,
              });
              expect(result.status).toBe(206);
              expect(result.headers.get("content-length")).toBe("4");
              expect(result.headers.get("content-range")).toBe("bytes 6-9/10");
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
              expect(await result.text()).toBe("");
            });

            it("should check if a key does not exist", async () => {
              const result = await fetch(uniqueKey() + "-does-not-exist", { s3: options });
              expect(result.status).toBe(404);
            });

            it("should be able to set content-type", async () => {
              // Each content type gets its own key, so the checks run in parallel.
              await Promise.all(
                ["application/json", "text/plain"].map(async contentType => {
                  await using tmpfile = tmpKey();
                  const result = await fetch(tmpfile.name, {
                    method: "PUT",
                    body: "Hello Bun!",
                    headers: {
                      "Content-Type": contentType,
                    },
                    s3: options,
                  });
                  expect(result.status).toBe(200);
                  const response = await fetch(tmpfile.name, { s3: options });
                  expect(response.status).toBe(200);
                  expect(response.headers.get("content-type")).toStartWith(contentType);
                  expect(await response.text()).toBe("Hello Bun!");
                }),
              );
            });

            it("should be able to upload large files", async () => {
              await using tmpfile = tmpKey();
              // A body of unknown length goes out in parts. 6 MiB crosses the default 5 MiB part size.
              const buffer = Buffer.alloc(1 * 1024 * 1024, "a");
              const chunks = 6;
              const result = await fetch(tmpfile.name, {
                method: "PUT",
                body: async function* () {
                  for (let i = 0; i < chunks; i++) {
                    await Bun.sleep(1);
                    yield buffer;
                  }
                },
                s3: options,
              });
              expect(result.status).toBe(200);

              const head = await fetch(tmpfile.name, { method: "HEAD", s3: options });
              expect(head.status).toBe(200);
              expect(head.headers.get("content-length")).toBe((buffer.byteLength * chunks).toString());
            }, 20_000);
          });
        });

        describe("Bun.S3Client", () => {
          describe.concurrent(bucketInName ? "bucket in path" : "bucket in options", () => {
            const options = bucketInName ? null : { bucket: S3Bucket };

            var bucket = S3(s3Options);

            function uniqueKey() {
              return bucketInName! ? `${S3Bucket}/${randomUUID()}` : `${randomUUID()}`;
            }

            // A unique key that is deleted when the test ends.
            function tmpKey() {
              const name = uniqueKey();
              return {
                name,
                [Symbol.asyncDispose]: async () => {
                  await bucket.file(name, options!).unlink();
                },
              };
            }

            // A unique key that holds "Hello Bun!" and is deleted when the test ends.
            async function tmp() {
              const key = tmpKey();
              await bucket.file(key.name, options!).write("Hello Bun!");
              return key;
            }

            it("should download file via Bun.s3().text()", async () => {
              await using tmpfile = await tmp();
              const file = bucket.file(tmpfile.name, options!);
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
              const [exists, stat] = await Promise.all([file.exists(), file.stat()]);
              expect(exists).toBe(true);
              // The key has no extension, so the upload was sent as application/octet-stream.
              expect(stat).toMatchObject({ size: 10, type: "application/octet-stream" });
              expect(stat.etag).toBeString();
              expect(stat.lastModified).toBeValidDate();
            });

            it("should check if a key does not exist", async () => {
              const file = bucket.file(uniqueKey() + "-does-not-exist", options!);
              const exists = await file.exists();
              expect(exists).toBe(false);
            });

            // Every header variant below writes its own key, so the variants of one test run in parallel.
            async function expectHeader(
              header: string,
              variants: Array<[expected: string, write: (name: string) => unknown]>,
            ) {
              await Promise.all(
                variants.map(async ([expected, write]) => {
                  await using tmpfile = tmpKey();
                  await write(tmpfile.name);
                  const response = await fetch(bucket.file(tmpfile.name, options!).presign(), { decompress: false });
                  expect(response.status).toBe(200);
                  // Some servers add a charset to the content type they store.
                  if (header === "content-type") {
                    expect(response.headers.get(header)).toStartWith(expected);
                  } else {
                    expect(response.headers.get(header)).toBe(expected);
                  }
                  expect(await response.text()).toBe("Hello Bun!");
                }),
              );
            }

            it("should be able to set content-type", async () => {
              await expectHeader("content-type", [
                ["text/css", name => bucket.file(name, options!).write("Hello Bun!", { type: "text/css" })],
                ["text/plain", name => bucket.file(name, options!).write("Hello Bun!", { type: "text/plain" })],
                [
                  "application/json",
                  name => {
                    const writer = bucket.file(name, options!).writer({ type: "application/json" });
                    writer.write("Hello Bun!");
                    return writer.end();
                  },
                ],
                ["application/xml", name => bucket.write(name, "Hello Bun!", { ...options, type: "application/xml" })],
              ]);
            });

            it("should be able to set content-disposition", async () => {
              await expectHeader("content-disposition", [
                [
                  'attachment; filename="test.txt"',
                  name =>
                    bucket
                      .file(name, options!)
                      .write("Hello Bun!", { contentDisposition: 'attachment; filename="test.txt"' }),
                ],
                ["inline", name => bucket.file(name, options!).write("Hello Bun!", { contentDisposition: "inline" })],
                [
                  'attachment; filename="report.pdf"',
                  name =>
                    bucket.write(name, "Hello Bun!", {
                      ...options,
                      contentDisposition: 'attachment; filename="report.pdf"',
                    }),
                ],
              ]);
            });
            it("should be able to set content-disposition in writer", async () => {
              await expectHeader("content-disposition", [
                [
                  'attachment; filename="test.txt"',
                  name => {
                    const writer = bucket.file(name, options!).writer({
                      contentDisposition: 'attachment; filename="test.txt"',
                    });
                    writer.write("Hello Bun!");
                    return writer.end();
                  },
                ],
              ]);
            });

            // The content is not compressed. expectHeader fetches with decompress: false, so the body comes back as is.
            it("should be able to set content-encoding", async () => {
              await expectHeader("content-encoding", [
                ["gzip", name => bucket.file(name, options!).write("Hello Bun!", { contentEncoding: "gzip" })],
                ["br", name => bucket.file(name, options!).write("Hello Bun!", { contentEncoding: "br" })],
                ["identity", name => bucket.write(name, "Hello Bun!", { ...options, contentEncoding: "identity" })],
              ]);
            });
            it("should be able to set content-encoding in writer", async () => {
              await expectHeader("content-encoding", [
                [
                  "gzip",
                  name => {
                    const writer = bucket.file(name, options!).writer({ contentEncoding: "gzip" });
                    writer.write("Hello Bun!");
                    return writer.end();
                  },
                ],
              ]);
            });

            it("should be able to upload large files using bucket.write + readable Request", async () => {
              await using tmpfile = tmpKey();
              // A body of unknown length goes out in parts. 6 MiB crosses the default 5 MiB part size.
              const chunks = 6;
              await bucket.write(
                tmpfile.name,
                new Request("https://example.com", {
                  method: "PUT",
                  body: async function* () {
                    for (let i = 0; i < chunks; i++) {
                      if (i % 5 === 0) {
                        await Bun.sleep(1);
                      }
                      yield bigishPayload;
                    }
                  },
                }),
                options!,
              );
              expect(await bucket.size(tmpfile.name, options!)).toBe(Buffer.byteLength(bigishPayload) * chunks);
            }, 50_000);

            it("should be able to upload large files in one go using bucket.write", async () => {
              await using tmpfile = tmpKey();
              expect(await bucket.write(tmpfile.name, bigPayload, options!)).toBe(Buffer.byteLength(bigPayload));
              expect(await bucket.size(tmpfile.name, options!)).toBe(Buffer.byteLength(bigPayload));
              expect(await bucket.file(tmpfile.name, options!).text()).toBe(bigPayload);
            }, 50_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              await using tmpfile = tmpKey();
              const s3File = bucket.file(tmpfile.name, options!);
              expect(await s3File.write(bigPayload)).toBe(Buffer.byteLength(bigPayload));
              const stat = await s3File.stat();
              expect(stat.size).toBe(Buffer.byteLength(bigPayload));
              expect(await s3File.text()).toBe(bigPayload);
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
                        await using tmpfile = tmpKey();
                        const s3File = bucket.file(tmpfile.name, options!);
                        const partSizeInBytes = partSize * 1024 * 1024;
                        const writer = s3File.writer({
                          queueSize,
                          partSize: partSizeInBytes,
                        });
                        for (let i = 0; i < payloadQuantity; i++) {
                          await writer.write(payload);
                        }
                        await writer.end();
                        const size = Buffer.byteLength(payload) * payloadQuantity;
                        const stat = await s3File.stat();
                        expect(stat.size).toBe(size);
                        // A payload smaller than one part goes out as a single PUT and gets a plain MD5 ETag.
                        // Anything else is a multipart upload, and its ETag ends with the number of parts.
                        if (size < partSizeInBytes) {
                          expect(stat.etag).toMatch(/^"[0-9a-f]{32}"$/);
                        } else {
                          expect(stat.etag).toEndWith(`-${Math.ceil(size / partSizeInBytes)}"`);
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

            function uniqueKey() {
              return bucketInName! ? `s3://${S3Bucket}/${randomUUID()}` : `s3://${randomUUID()}`;
            }

            // A unique key that is deleted when the test ends.
            function tmpKey() {
              const name = uniqueKey();
              return {
                name,
                async [Symbol.asyncDispose]() {
                  await file(name, options).unlink();
                },
              };
            }

            // A unique key that holds "Hello Bun!" and is deleted when the test ends.
            async function tmp() {
              const key = tmpKey();
              await file(key.name, options).write("Hello Bun!");
              return key;
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
              const [exists, stat] = await Promise.all([s3file.exists(), s3file.stat()]);
              expect(exists).toBe(true);
              // The key has no extension, so the upload was sent as application/octet-stream.
              expect(stat).toMatchObject({
                size: 10,
                type: "application/octet-stream",
                etag: expect.any(String),
                lastModified: expect.any(Date),
              });
            });

            it("should check if a key does not exist", async () => {
              const s3file = file(uniqueKey() + "-does-not-exist", options);
              const exists = await s3file.exists();
              expect(exists).toBe(false);
            });

            it("should be able to set content-type", async () => {
              // Each variant writes its own key, so the three checks run in parallel.
              const variants: Array<[type: string, write: (name: string) => unknown]> = [
                ["text/css", name => file(name, { ...options, type: "text/css" }).write("Hello Bun!")],
                ["text/plain", name => file(name, options).write("Hello Bun!", { type: "text/plain" })],
                [
                  "application/json",
                  name => {
                    const writer = file(name, options).writer({ type: "application/json" });
                    writer.write("Hello Bun!");
                    return writer.end();
                  },
                ],
              ];
              await Promise.all(
                variants.map(async ([type, write]) => {
                  await using tmpfile = tmpKey();
                  await write(tmpfile.name);
                  const response = await fetch(file(tmpfile.name, options).presign());
                  expect(response.status).toBe(200);
                  expect(response.headers.get("content-type")).toStartWith(type);
                  expect(await response.text()).toBe("Hello Bun!");
                }),
              );
            });
            it("should be able to upload large files using writer() #16452", async () => {
              await using tmpfile = tmpKey();
              const s3file = file(tmpfile.name, options);
              // Two writes above the part size and no await between them: three parts, the last one small.
              const writer = s3file.writer();
              writer.write(bigPayload);
              writer.write(bigPayload);

              expect(await writer.end()).toBe(Buffer.byteLength(bigPayload) * 2);

              expect(await s3file.text()).toBe(bigPayload.repeat(2));
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
                await using tmpfile = tmpKey();
                expect(await Bun.write(file(tmpfile.name, options), bigPayload)).toBe(Buffer.byteLength(bigPayload));
                expect(await S3Client.size(tmpfile.name, options)).toBe(Buffer.byteLength(bigPayload));
                expect(await file(tmpfile.name, options).text()).toEqual(bigPayload);
              }
            }, 100_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              {
                await using tmpfile = tmpKey();
                const s3File = file(tmpfile.name, options);
                expect(await s3File.write(bigPayload)).toBe(Buffer.byteLength(bigPayload));
                expect(s3File.size).toBeNaN();
                expect(await s3File.text()).toBe(bigPayload);
              }
            }, 100_000);
          });
        });

        describe("Bun.s3", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };

            function uniqueKey() {
              return bucketInName ? `${S3Bucket}/${randomUUID()}` : `${randomUUID()}`;
            }

            // A unique key that is deleted when the test ends.
            function tmpKey() {
              const name = uniqueKey();
              return {
                name,
                [Symbol.asyncDispose]: async () => {
                  await s3(name, options).unlink();
                },
              };
            }

            // A unique key that holds "Hello Bun!" and is deleted when the test ends.
            async function tmp() {
              const key = tmpKey();
              await s3(key.name, options).write("Hello Bun!");
              return key;
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
              expect(s3file.size).toBeNaN();
              const [exists, stat] = await Promise.all([s3file.exists(), s3file.stat()]);
              expect(exists).toBe(true);
              // The key has no extension, so the upload was sent as application/octet-stream.
              expect(stat).toMatchObject({ size: 10, type: "application/octet-stream" });
              expect(stat.etag).toBeString();
              expect(stat.lastModified).toBeValidDate();
            });

            it("should check if a key does not exist", async () => {
              const s3file = s3(uniqueKey() + "-does-not-exist", options);
              const exists = await s3file.exists();
              expect(exists).toBe(false);
            });

            it("presign url", async () => {
              await using tmpfile = await tmp();
              const s3file = s3(tmpfile.name, options);
              const response = await fetch(s3file.presign());
              expect(response.status).toBe(200);
              expect(response.headers.get("content-length")).toBe("10");
              expect(await response.text()).toBe("Hello Bun!");
            });

            it("should be able to set content-type", async () => {
              // Each variant writes its own key, so the three checks run in parallel.
              const variants: Array<[type: string, write: (name: string) => unknown]> = [
                ["text/css", name => s3(name, { ...options, type: "text/css" }).write("Hello Bun!")],
                ["text/plain", name => s3(name, options).write("Hello Bun!", { type: "text/plain" })],
                [
                  "application/json",
                  name => {
                    const writer = s3(name, options).writer({ type: "application/json" });
                    writer.write("Hello Bun!");
                    return writer.end();
                  },
                ],
              ];
              await Promise.all(
                variants.map(async ([type, write]) => {
                  await using tmpfile = tmpKey();
                  await write(tmpfile.name);
                  const response = await fetch(s3(tmpfile.name, options).presign());
                  expect(response.status).toBe(200);
                  expect(response.headers.get("content-type")).toStartWith(type);
                  expect(await response.text()).toBe("Hello Bun!");
                }),
              );
            });

            it("should be able to upload large files in one go using Bun.write", async () => {
              {
                await using tmpfile = tmpKey();
                const s3file = s3(tmpfile.name, options);
                expect(await Bun.write(s3file, bigPayload)).toBe(Buffer.byteLength(bigPayload));
                const stat = await s3file.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(stat.etag).toBeString();
                expect(stat.lastModified).toBeValidDate();
                expect(await s3file.text()).toBe(bigPayload);
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
                await using tmpfile = tmpKey();
                const s3File = s3(tmpfile.name, options);
                expect(await s3File.write(bigPayload)).toBe(Buffer.byteLength(bigPayload));
                const stat = await s3File.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(stat.etag).toBeString();
                expect(stat.lastModified).toBeValidDate();
                expect(await s3File.text()).toBe(bigPayload);
              }
            }, 100_000);

            describe("readable stream", () => {
              it("should work with small files", async () => {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name, options);
                expect(await readAll(s3file.stream())).toEqual(Buffer.from("Hello Bun!"));
              });
              it("should work with large files ", async () => {
                await using tmpfile = tmpKey();
                const s3file = s3(tmpfile.name, options);
                await s3file.write(bigishPayload);
                const received = await readAll(s3file.stream());
                expect(received.byteLength).toBe(Buffer.byteLength(bigishPayload));
                // Compare hashes so a mismatch does not print a megabyte to stderr.
                expect(Bun.SHA1.hash(received, "hex")).toBe(Bun.SHA1.hash(bigishPayload, "hex"));
              }, 30_000);
              it("should work with sliced files (offset 0)", async () => {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name, options);
                expect(await readAll(s3file.slice(0, 5).stream())).toEqual(Buffer.from("Hello"));
              });
              it("should work with sliced files (non-zero offset)", async () => {
                await using tmpfile = await tmp();
                const s3file = s3(tmpfile.name, options);
                expect(await readAll(s3file.slice(6, 10).stream())).toEqual(Buffer.from("Bun!"));
              });
            });
          });
        });
      }
      describe.concurrent("special characters", () => {
        const options = { ...s3Options, bucket: S3Bucket };
        const keys: Array<[label: string, key: () => string, skip?: boolean]> = [
          // supabase will throw InvalidKey
          [
            "should allow special characters in the path",
            () => `🌈🦄${randomUUID()}.txt`,
            credentials.service === "supabase",
          ],
          ["should allow forward slashes in the path", () => `${randomUUID()}/test.txt`],
          ["should allow backslashes in the path", () => `${randomUUID()}\\test.txt`],
          ["should allow starting with forward slash", () => `/${randomUUID()}test.txt`],
          ["should allow starting with backslash", () => `\\${randomUUID()}test.txt`],
          ["should allow ending with forward slash", () => `${randomUUID()}/`],
          ["should allow ending with backslash", () => `${randomUUID()}\\`],
        ];
        for (const [label, key, skip] of keys) {
          it.skipIf(skip ?? false)(label, async () => {
            const s3file = s3(key(), options);
            await s3file.write("Hello Bun!");
            expect(await s3file.text()).toBe("Hello Bun!");
            await s3file.unlink();
            expect(await s3file.exists()).toBe(false);
          });
        }
      });

      describe.concurrent("static methods", () => {
        it("its defined", () => {
          expect(S3Client).toBeFunction();
          expect(S3Client.write).toBeFunction();
          expect(S3Client.file).toBeFunction();
          expect(S3Client.stat).toBeFunction();
          expect(S3Client.unlink).toBeFunction();
          expect(S3Client.exists).toBeFunction();
          expect(S3Client.presign).toBeFunction();
          expect(S3Client.size).toBeFunction();
          expect(S3Client.delete).toBeFunction();
        });
        it("should work", async () => {
          const filename = randomUUID() + ".txt";
          const options = { ...s3Options, bucket: S3Bucket };
          expect(await S3Client.write(filename, "Hello Bun!", options)).toBe(10);
          const url = S3Client.presign(filename, options);
          expect(new URL(url).pathname).toEndWith(`/${filename}`);
          const [text, stat, response] = await Promise.all([
            S3Client.file(filename, options).text(),
            S3Client.stat(filename, options),
            fetch(url),
          ]);
          expect(text).toBe("Hello Bun!");
          expect(stat).toMatchObject({ size: 10, type: "text/plain;charset=utf-8" });
          expect(stat.etag).toBeString();
          expect(stat.lastModified).toBeValidDate();
          expect(response.status).toBe(200);
          expect(await response.text()).toBe("Hello Bun!");
          await S3Client.unlink(filename, options);
          expect(await S3Client.exists(filename, options)).toBe(false);
        });
      });
      describe.concurrent("errors", () => {
        it("Bun.write(s3file, file) should throw if the file does not exist", async () => {
          await expect(
            Bun.write(s3("test.txt", { ...s3Options, bucket: S3Bucket }), file("./do-not-exist.txt")),
          ).rejects.toMatchObject({ code: "ENOENT", path: "./do-not-exist.txt", syscall: "open" });
        });

        it("Bun.write(s3file, file) should work with empty file", async () => {
          await using dir = tempDir("fsr", {
            "hello.txt": "",
          });
          const tmp_filename = `${randomUUID()}.txt`;
          const s3file = s3(tmp_filename, { ...s3Options, bucket: S3Bucket });

          expect(await Bun.write(s3file, file(path.join(dir, "hello.txt")))).toBe(0);
          expect(await s3file.stat()).toMatchObject({ size: 0 });
          await s3file.unlink();
        });
        it("Bun.write(s3file, file) should throw if the file does not exist", async () => {
          await expect(
            Bun.write(
              s3("test.txt", { ...s3Options, bucket: S3Bucket }),
              s3("do-not-exist.txt", { ...s3Options, bucket: S3Bucket }),
            ),
          ).rejects.toMatchObject({ code: "NoSuchKey", path: "do-not-exist.txt", name: "S3Error" });
        });
        it("Bun.write(s3file, file) should throw if the file does not exist", async () => {
          const error = await Bun.write(
            s3("test.txt", { ...s3Options, bucket: S3Bucket }),
            s3("do-not-exist.txt", { ...s3Options, bucket: "does-not-exists" }),
          ).catch(e => e);
          expect(error).toMatchObject({ path: "do-not-exist.txt", name: "S3Error" });
          expect(["AccessDenied", "NoSuchBucket", "NoSuchKey"]).toContain(error.code);
        });
        it("should error if bucket is missing", async () => {
          await expect(Bun.write(s3("test.txt", s3Options), "Hello Bun!")).rejects.toMatchObject({
            code: "ERR_S3_INVALID_PATH",
            name: "S3Error",
          });
        });

        it("should error if bucket is missing on payload", async () => {
          await expect(
            Bun.write(s3("test.txt", { ...s3Options, bucket: S3Bucket }), s3("test2.txt", s3Options)),
          ).rejects.toMatchObject({ code: "ERR_S3_INVALID_PATH", path: "test2.txt", name: "S3Error" });
        });

        it("should error when invalid method", async () => {
          for (const fn of [s3, (path, ...args) => S3(...args).file(path)]) {
            const s3file = fn("method-test", {
              ...s3Options,
              bucket: S3Bucket,
            });

            expect(() => s3file.presign({ method: "OPTIONS" })).toThrow(
              expect.objectContaining({ code: "ERR_S3_INVALID_METHOD" }),
            );
          }
        });

        it("should error when path is too long", async () => {
          await Promise.all(
            [s3, (path, ...args) => S3(...args).file(path)].map(async fn => {
              const error = await (async () => {
                const s3file = fn("test" + Buffer.alloc(4096, "a").toString(), {
                  ...s3Options,
                  bucket: S3Bucket,
                });
                await s3file.write("Hello Bun!");
              })().catch(e => e);
              expect(error).toBeInstanceOf(Error);
              // ERR_STRING_TOO_LONG can occur when the path is too long to convert to a JS string
              expect(["ENAMETOOLONG", "ERR_S3_INVALID_PATH", "ERR_STRING_TOO_LONG"]).toContain(error.code);
            }),
          );
        });
      });
      describe.concurrent("credentials", () => {
        const s3ClientFile = (path, ...args) => S3(...args).file(path);
        const constructors = [s3, s3ClientFile, file];

        // Builds the file with each constructor, runs `attempt` on it, and returns the errors. Every
        // constructor must fail.
        async function errorsOf(
          ctors: Array<(path: string, options: any) => any>,
          path: string,
          options: S3Options,
          attempt: (s3file: any) => unknown,
        ): Promise<any[]> {
          return Promise.all(
            ctors.map(async fn => {
              const error = await (async () => attempt(fn(path, options)))().catch(e => e);
              expect(error).toBeInstanceOf(Error);
              return error;
            }),
          );
        }

        it("should error with invalid access key id", async () => {
          const errors = await errorsOf(
            constructors,
            "s3://bucket/credentials-test",
            { ...s3Options, accessKeyId: "invalid" },
            s3file => s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error.name).toBe("S3Error");
            expect(["InvalidAccessKeyId", "InvalidArgument"]).toContain(error.code);
          }
        });
        it("should error with invalid secret key id", async () => {
          const errors = await errorsOf(
            constructors,
            "s3://bucket/credentials-test",
            { ...s3Options, secretAccessKey: "invalid" },
            s3file => s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error.name).toBe("S3Error");
            expect(["SignatureDoesNotMatch", "AccessDenied"]).toContain(error.code);
          }
        });

        it("should error with invalid endpoint", async () => {
          const errors = await errorsOf(
            constructors,
            "s3://bucket/credentials-test",
            { ...s3Options, endpoint: "🙂.🥯" },
            s3file => s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error).toMatchObject({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
          }
        });
        it("should error with invalid endpoint", async () => {
          const errors = await errorsOf(
            constructors,
            "s3://bucket/credentials-test",
            // credentials and endpoint dont match
            { ...s3Options, endpoint: "s3.us-west-1.amazonaws.com" },
            s3file => s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error).toMatchObject({ name: "S3Error", code: "PermanentRedirect" });
          }
        });
        it("should error with invalid endpoint", async () => {
          const errors = await errorsOf(
            constructors,
            "s3://bucket/credentials-test",
            { ...s3Options, endpoint: "..asd.@%&&&%%" },
            s3file => s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error).toMatchObject({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
          }
        });

        it("should error with invalid bucket", async () => {
          const errors = await errorsOf(
            constructors,
            "s3://credentials-test",
            { ...s3Options, bucket: "invalid" },
            s3file => s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error.name).toBe("S3Error");
            expect(["AccessDenied", "NoSuchBucket"]).toContain(error.code);
          }
        });

        it("should error when missing credentials", async () => {
          const errors = await errorsOf(constructors, "s3://credentials-test", { bucket: "invalid" }, s3file =>
            s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error).toMatchObject({ name: "S3Error", code: "ERR_S3_MISSING_CREDENTIALS" });
          }
        });
        it("should error when presign missing credentials", async () => {
          const errors = await errorsOf([s3, s3ClientFile], "method-test", { bucket: S3Bucket }, s3file =>
            s3file.presign(),
          );
          for (const error of errors) {
            expect(error).toMatchObject({ code: "ERR_S3_MISSING_CREDENTIALS" });
          }
        });

        it("should error when presign with invalid endpoint", async () => {
          const errors = await errorsOf(
            [s3, s3ClientFile],
            randomUUID(),
            { ...s3Options, bucket: S3Bucket, endpoint: Buffer.alloc(2048, "a").toString() },
            s3file => s3file.write("Hello Bun!"),
          );
          for (const error of errors) {
            expect(error).toMatchObject({ name: "S3Error", code: "ERR_S3_INVALID_ENDPOINT" });
          }
        });
        it("should error when presign with invalid token", async () => {
          const errors = await errorsOf(
            [s3, s3ClientFile],
            randomUUID(),
            { ...s3Options, bucket: S3Bucket, sessionToken: Buffer.alloc(4096, "a").toString() },
            s3file => s3file.presign(),
          );
          for (const error of errors) {
            expect(error).toMatchObject({ code: "ERR_S3_INVALID_SESSION_TOKEN" });
          }
        });
      });

      describe.concurrent("S3 static methods", () => {
        describe("presign", () => {
          // Checks the SigV4 query parameters every presigned URL must carry and returns them.
          function presignedParams(url: string, expected: { origin?: string; expiresIn?: number; region?: string }) {
            const { origin, searchParams } = new URL(url);
            expect(origin).toBe(expected.origin ?? new URL(s3Options.endpoint!).origin);
            expect(searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
            expect(searchParams.get("X-Amz-Expires")).toBe(String(expected.expiresIn ?? 86400));
            expect(searchParams.get("X-Amz-Date")).toMatch(/^\d{8}T\d{6}Z$/);
            expect(searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
            expect(searchParams.get("X-Amz-SignedHeaders")).toBe("host");
            const day = searchParams.get("X-Amz-Date")!.slice(0, 8);
            // The region is "auto" when only an endpoint is given.
            expect(searchParams.get("X-Amz-Credential")).toBe(
              `${s3Options.accessKeyId}/${day}/${expected.region ?? "auto"}/s3/aws4_request`,
            );
            return searchParams;
          }

          it("should work", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign();
            expect(new URL(url).pathname).toBe("/bucket/credentials-test");
            presignedParams(url, {});
          });
          it("default endpoint and region should work", async () => {
            let options = { ...s3Options };
            options.endpoint = undefined;
            options.region = undefined;
            const s3file = s3("s3://bucket/credentials-test", options);
            const url = s3file.presign();
            expect(new URL(url).pathname).toBe("/bucket/credentials-test");
            presignedParams(url, { origin: "https://s3.us-east-1.amazonaws.com", region: "us-east-1" });
          });
          it("default endpoint + region should work", async () => {
            let options = { ...s3Options };
            options.endpoint = undefined;
            options.region = "us-west-1";
            const s3file = s3("s3://bucket/credentials-test", options);
            const url = s3file.presign();
            expect(new URL(url).pathname).toBe("/bucket/credentials-test");
            presignedParams(url, { origin: "https://s3.us-west-1.amazonaws.com", region: "us-west-1" });
          });
          it("should work with expires", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign({
              expiresIn: 10,
            });
            presignedParams(url, { expiresIn: 10 });
          });
          it("should work with acl", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign({
              expiresIn: 10,
              acl: "public-read",
            });
            const params = presignedParams(url, { expiresIn: 10 });
            expect(params.get("X-Amz-Acl")).toBe("public-read");
          });

          it("should work with storage class", async () => {
            const s3file = s3("s3://bucket/credentials-test", s3Options);
            const url = s3file.presign({
              expiresIn: 10,
              storageClass: "GLACIER_IR",
            });
            const params = presignedParams(url, { expiresIn: 10 });
            expect(params.get("x-amz-storage-class")).toBe("GLACIER_IR");
          });

          it("s3().presign() should work", async () => {
            const url = s3("s3://bucket/credentials-test", s3Options).presign({
              expiresIn: 10,
            });
            expect(new URL(url).pathname).toBe("/bucket/credentials-test");
            presignedParams(url, { expiresIn: 10 });
          });

          it("s3().presign() endpoint should work", async () => {
            const url = s3("s3://bucket/credentials-test", s3Options).presign({
              expiresIn: 10,
              endpoint: "https://s3.bun.sh",
            });
            expect(new URL(url).pathname).toBe("/bucket/credentials-test");
            presignedParams(url, { origin: "https://s3.bun.sh", expiresIn: 10 });
          });

          it("s3().presign() bucket should work", async () => {
            const url = s3("s3://folder/credentials-test", s3Options).presign({
              expiresIn: 10,
              bucket: "my-bucket",
            });
            expect(new URL(url).pathname).toBe("/my-bucket/folder/credentials-test");
            presignedParams(url, { expiresIn: 10 });
          });
        });

        it("exists, write, size, unlink should work", async () => {
          const fullPath = randomUUID();
          const bucket = S3({
            ...s3Options,
            bucket: S3Bucket,
          });
          expect(await bucket.exists(fullPath)).toBe(false);

          expect(await bucket.write(fullPath, "bun")).toBe(3);
          expect(await Promise.all([bucket.exists(fullPath), bucket.size(fullPath)])).toEqual([true, 3]);
          await bucket.unlink(fullPath);
          expect(await bucket.exists(fullPath)).toBe(false);
        });

        it("should be able to upload a slice", async () => {
          const filename = randomUUID();
          const fullPath = `s3://${S3Bucket}/${filename}`;
          const s3file = s3(fullPath, s3Options);
          await s3file.write("Hello Bun!");
          const slice = s3file.slice(6, 10);
          expect(await Promise.all([slice.text(), s3file.text()])).toEqual(["Bun!", "Hello Bun!"]);

          expect(await s3file.write(slice)).toBe(4);
          expect(await s3file.text()).toBe("Bun!");
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
      const name = randomUUIDv7("hex") + ".txt";
      const s3file = s3.file(name);
      await s3file.write("Hello Bun!");
      try {
        console.log(JSON.stringify({ text: await s3file.text(), size: (await s3file.stat()).size }));
      } finally {
        await s3file.unlink();
      }
    `,
  });
  describe("http endpoint should work when using env variables", () => {
    for (const endpoint of ["S3_ENDPOINT", "AWS_ENDPOINT"]) {
      it.concurrent(endpoint, async () => {
        await using proc = Bun.spawn({
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
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual({ text: "Hello Bun!", size: 10 });
        expect(exitCode).toBe(0);
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
          expect(await file.write("Hello Bun!")).toBe(10);
          expect(await Promise.all([file.text(), file.exists()])).toEqual(["Hello Bun!", true]);
          await file.unlink();
          expect(await file.exists()).toBe(false);
        });
      }
    }
  });
});

describe.concurrent("s3 missing credentials", () => {
  const missingCredentials = { name: "S3Error", code: "ERR_S3_MISSING_CREDENTIALS" };
  it("unlink", async () => {
    await expect(Bun.s3.unlink("test")).rejects.toMatchObject(missingCredentials);
  });
  it("write", async () => {
    await expect(Bun.s3.write("test", "test")).rejects.toMatchObject(missingCredentials);
  });
  it("exists", async () => {
    await expect(Bun.s3.exists("test")).rejects.toMatchObject(missingCredentials);
  });
  it("size", async () => {
    await expect(Bun.s3.size("test")).rejects.toMatchObject(missingCredentials);
  });
  it("stat", async () => {
    await expect(Bun.s3.stat("test")).rejects.toMatchObject(missingCredentials);
  });
  it("presign", () => {
    expect(() => Bun.s3.presign("test")).toThrow(expect.objectContaining({ code: missingCredentials.code }));
  });
  it("file", async () => {
    const file = Bun.s3.file("test");
    await Promise.all(
      [file.text(), file.bytes(), file.json(), file.formData(), file.delete(), file.exists(), file.stat()].map(
        promise => expect(promise).rejects.toMatchObject(missingCredentials),
      ),
    );
  });
});

// Archive + S3 integration tests
describe.concurrent.skipIf(!minioCredentials)("Archive with S3", () => {
  const credentials = minioCredentials!;

  // Returns the archive entries as a name to text map.
  async function archiveEntries(bytes: Uint8Array): Promise<Record<string, string>> {
    const files = await new Bun.Archive(bytes).files();
    const entries: Record<string, string> = {};
    for (const [name, file] of files) {
      entries[name] = await file.text();
    }
    return entries;
  }

  it("writes archive to S3 via S3Client.write()", async () => {
    const client = new Bun.S3Client(credentials);
    const entries = {
      "hello.txt": "Hello from Archive!",
      "data.json": JSON.stringify({ test: true }),
    };
    const archive = new Bun.Archive(entries);

    const key = randomUUIDv7() + ".tar";
    await client.write(key, archive);

    // Verify by downloading and reading back
    expect(await archiveEntries(await client.file(key).bytes())).toEqual(entries);

    // Cleanup
    await client.unlink(key);
  });

  it("writes archive to S3 via Bun.write() with s3:// URL", async () => {
    const entries = {
      "file1.txt": "content1",
      "dir/file2.txt": "content2",
    };
    const archive = new Bun.Archive(entries);

    const key = randomUUIDv7() + ".tar";
    const s3Url = `s3://${credentials.bucket}/${key}`;

    await Bun.write(s3Url, archive, {
      ...credentials,
    });

    // Verify by downloading
    const s3File = Bun.file(s3Url, credentials);
    expect(await archiveEntries(await s3File.bytes())).toEqual(entries);

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
    const files = await new Bun.Archive(await client.file(key).bytes()).files();
    expect([...files.keys()]).toEqual(["binary.bin"]);
    expect(await files.get("binary.bin")!.bytes()).toEqual(binaryData);

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
    expect(await archiveEntries(await client.file(key).bytes())).toEqual(entries);

    // Cleanup
    await client.unlink(key);
  });

  it("writes archive via s3File.write()", async () => {
    const client = new Bun.S3Client(credentials);
    const entries = {
      "test.txt": "Hello via s3File.write()!",
    };
    const archive = new Bun.Archive(entries);

    const key = randomUUIDv7() + ".tar";
    const s3File = client.file(key);
    await s3File.write(archive);

    // Verify
    expect(await archiveEntries(await s3File.bytes())).toEqual(entries);

    // Cleanup
    await s3File.delete();
  });
});

// The S3 client does not honor NO_PROXY, so an inherited proxy would hijack the
// requests to the mock servers below.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

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
      env: envWithoutProxy,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // A server-supplied upload id containing non-ASCII bytes must surface as a normal S3 error
    // on the writer promise instead of terminating the process. A well-formed upload id still
    // completes the multipart upload in the same process.
    expect(stdout).toBe(
      "malformed-id: rejected UnknownError - Failed to initiate multipart upload\nvalid-id: resolved\n",
    );
    expect(exitCode).toBe(0);
  }, 60_000);
});

// Every test spawns its own bun with its own mock server on port 0, so they run in parallel.
describe.concurrent("s3 upload stream body error", () => {
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
      env: envWithoutProxy,
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
      env: envWithoutProxy,
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
      env: envWithoutProxy,
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
