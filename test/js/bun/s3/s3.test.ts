import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { bunExe, bunEnv, getSecret, tempDirWithFiles, isLinux } from "harness";
import { randomUUID } from "crypto";
import { S3Client, s3, file, which } from "bun";
const S3 = (...args) => new S3Client(...args);
import child_process from "child_process";
import type { S3Options } from "bun";
import path from "path";

const dockerCLI = which("docker") as string;
function isDockerEnabled(): boolean {
  if (!dockerCLI) {
    return false;
  }

  try {
    const info = child_process.execSync(`${dockerCLI} info`, { stdio: ["ignore", "pipe", "inherit"] });
    return info.toString().indexOf("Server Version:") !== -1;
  } catch (error) {
    return false;
  }
}

const allCredentials = [
  {
    accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
    secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
    endpoint: getSecret("S3_R2_ENDPOINT"),
    bucket: getSecret("S3_R2_BUCKET"),
    service: "R2" as string,
  },
];

// TODO: figure out why minio is not creating a bucket on Linux, works on macOS and windows
if (isDockerEnabled() && !isLinux) {
  const minio_dir = tempDirWithFiles("minio", {});
  const result = child_process.spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      "minio",
      "-p",
      "9000:9000",
      "-p",
      "9001:9001",
      "-e",
      "MINIO_ROOT_USER=minioadmin",
      "-e",
      "MINIO_ROOT_PASSWORD=minioadmin",
      "-v",
      `${minio_dir}:/data`,
      "minio/minio",
      "server",
      "--console-address",
      ":9001",
      "/data",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error) {
    if (!result.error.message.includes('The container name "/minio" is already in use by container'))
      throw result.error;
  }
  // wait for minio to be ready
  await Bun.sleep(1_000);

  /// create a bucket
  child_process.spawnSync(dockerCLI, [`exec`, `minio`, `mc`, `mb`, `http://localhost:9000/buntest`], {
    stdio: "ignore",
  });

  allCredentials.push({
    endpoint: "http://localhost:9000", // MinIO endpoint
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    bucket: "buntest",
    service: "MinIO" as string,
  });
}
for (let credentials of allCredentials) {
  describe(`${credentials.service}`, () => {
    const s3Options: S3Options = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      endpoint: credentials.endpoint,
    };

    const S3Bucket = credentials.bucket;

    function makePayLoadFrom(text: string, size: number): string {
      while (Buffer.byteLength(text) < size) {
        text += text;
      }
      return text.slice(0, size);
    }

    // 10 MiB big enough to Multipart upload in more than one part
    const bigPayload = makePayLoadFrom("Bun is the best runtime ever", 10 * 1024 * 1024);
    const bigishPayload = makePayLoadFrom("Bun is the best runtime ever", 1 * 1024 * 1024);

    describe.skipIf(!s3Options.accessKeyId)("s3", () => {
      for (let bucketInName of [true, false]) {
        describe("fetch", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            var tmp_filename: string;
            const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };
            beforeAll(async () => {
              tmp_filename = bucketInName ? `s3://${S3Bucket}/${randomUUID()}` : `s3://${randomUUID()}`;
              const result = await fetch(tmp_filename, {
                method: "PUT",
                body: "Hello Bun!",
                s3: options,
              });
              expect(result.status).toBe(200);
            });

            afterAll(async () => {
              const result = await fetch(tmp_filename, {
                method: "DELETE",
                s3: options,
              });
              expect(result.status).toBe(204);
            });

            it("should download file via fetch GET", async () => {
              const result = await fetch(tmp_filename, { s3: options });
              expect(result.status).toBe(200);
              expect(await result.text()).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              const result = await fetch(tmp_filename, {
                headers: { "range": "bytes=6-10" },
                s3: options,
              });
              expect(result.status).toBe(206);
              expect(await result.text()).toBe("Bun!");
            });

            it("should check if a key exists or content-length", async () => {
              const result = await fetch(tmp_filename, {
                method: "HEAD",
                s3: options,
              });
              expect(result.status).toBe(200); // 404 if do not exists
              expect(result.headers.get("content-length")).toBe("10"); // content-length
            });

            it("should check if a key does not exist", async () => {
              const result = await fetch(tmp_filename + "-does-not-exist", { s3: options });
              expect(result.status).toBe(404);
            });

            it("should be able to set content-type", async () => {
              {
                const result = await fetch(tmp_filename, {
                  method: "PUT",
                  body: "Hello Bun!",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  s3: options,
                });
                expect(result.status).toBe(200);
                const response = await fetch(tmp_filename, { s3: options });
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }
              {
                const result = await fetch(tmp_filename, {
                  method: "PUT",
                  body: "Hello Bun!",
                  headers: {
                    "Content-Type": "text/plain",
                  },
                  s3: options,
                });
                expect(result.status).toBe(200);
                const response = await fetch(tmp_filename, { s3: options });
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }
            });

            it("should be able to upload large files", async () => {
              // 10 MiB big enough to Multipart upload in more than one part
              const buffer = Buffer.alloc(1 * 1024 * 1024, "a");
              {
                await fetch(tmp_filename, {
                  method: "PUT",
                  body: async function* () {
                    for (let i = 0; i < 10; i++) {
                      await Bun.sleep(10);
                      yield buffer;
                    }
                  },
                  s3: options,
                }).then(res => res.text());

                const result = await fetch(tmp_filename, { method: "HEAD", s3: options });
                expect(result.status).toBe(200);
                expect(result.headers.get("content-length")).toBe((buffer.byteLength * 10).toString());
              }
            }, 20_000);
          });
        });

        describe("Bun.S3Client", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const tmp_filename = bucketInName ? `${S3Bucket}/${randomUUID()}` : `${randomUUID()}`;
            const options = bucketInName ? null : { bucket: S3Bucket };

            var bucket = S3(s3Options);
            beforeAll(async () => {
              const file = bucket.file(tmp_filename, options);
              await file.write("Hello Bun!");
            });

            afterAll(async () => {
              const file = bucket.file(tmp_filename, options);
              await file.unlink();
            });

            it("should download file via Bun.s3().text()", async () => {
              const file = bucket.file(tmp_filename, options);
              const text = await file.text();
              expect(text).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              const file = bucket.file(tmp_filename, options);
              const text = await file.slice(6, 10).text();
              expect(text).toBe("Bun!");
            });

            it("should check if a key exists or content-length", async () => {
              const file = bucket.file(tmp_filename, options);
              const exists = await file.exists();
              expect(exists).toBe(true);
              const stat = await file.stat();
              expect(stat.size).toBe(10);
            });

            it("should check if a key does not exist", async () => {
              const file = bucket.file(tmp_filename + "-does-not-exist", options);
              const exists = await file.exists();
              expect(exists).toBe(false);
            });

            it("should be able to set content-type", async () => {
              {
                const s3file = bucket.file(tmp_filename, options);
                await s3file.write("Hello Bun!", { type: "text/css" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/css");
              }
              {
                const s3file = bucket.file(tmp_filename, options);
                await s3file.write("Hello Bun!", { type: "text/plain" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }

              {
                const s3file = bucket.file(tmp_filename, options);
                const writer = s3file.writer({ type: "application/json" });
                writer.write("Hello Bun!");
                await writer.end();
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }

              {
                await bucket.write(tmp_filename, "Hello Bun!", { ...options, type: "application/xml" });
                const response = await fetch(bucket.file(tmp_filename, options).presign());
                expect(response.headers.get("content-type")).toStartWith("application/xml");
              }
            });

            it("should be able to upload large files using bucket.write + readable Request", async () => {
              {
                await bucket.write(
                  tmp_filename,
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
                  options,
                );
                expect(await bucket.size(tmp_filename, options)).toBe(Buffer.byteLength(bigishPayload) * 10);
              }
            }, 10_000);

            it("should be able to upload large files in one go using bucket.write", async () => {
              {
                await bucket.write(tmp_filename, bigPayload, options);
                expect(await bucket.size(tmp_filename, options)).toBe(Buffer.byteLength(bigPayload));
                expect(await bucket.file(tmp_filename, options).text()).toBe(bigPayload);
              }
            }, 10_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              {
                const s3File = bucket.file(tmp_filename, options);
                await s3File.write(bigPayload);
                const stat = await s3File.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(await s3File.text()).toBe(bigPayload);
              }
            }, 10_000);
          });
        });

        describe("Bun.file", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const tmp_filename = bucketInName ? `s3://${S3Bucket}/${randomUUID()}` : `s3://${randomUUID()}`;
            const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };
            beforeAll(async () => {
              const s3file = file(tmp_filename, options);
              await s3file.write("Hello Bun!");
            });

            afterAll(async () => {
              const s3file = file(tmp_filename, options);
              await s3file.unlink();
            });

            it("should download file via Bun.file().text()", async () => {
              const s3file = file(tmp_filename, options);
              const text = await s3file.text();
              expect(text).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              const s3file = file(tmp_filename, options);
              const text = await s3file.slice(6, 10).text();
              expect(text).toBe("Bun!");
            });

            it("should check if a key exists or content-length", async () => {
              const s3file = file(tmp_filename, options);
              const exists = await s3file.exists();
              expect(exists).toBe(true);
              const stat = await s3file.stat();
              expect(stat.size).toBe(10);
            });

            it("should check if a key does not exist", async () => {
              const s3file = file(tmp_filename + "-does-not-exist", options);
              const exists = await s3file.exists();
              expect(exists).toBe(false);
            });

            it("should be able to set content-type", async () => {
              {
                const s3file = file(tmp_filename, { ...options, type: "text/css" });
                await s3file.write("Hello Bun!");
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/css");
              }
              {
                const s3file = file(tmp_filename, options);
                await s3file.write("Hello Bun!", { type: "text/plain" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }

              {
                const s3file = file(tmp_filename, options);
                const writer = s3file.writer({ type: "application/json" });
                writer.write("Hello Bun!");
                await writer.end();
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }
            });

            it("should be able to upload large files in one go using Bun.write", async () => {
              {
                await Bun.write(file(tmp_filename, options), bigPayload);
                expect(await S3Client.size(tmp_filename, options)).toBe(Buffer.byteLength(bigPayload));
                expect(await file(tmp_filename, options).text()).toEqual(bigPayload);
              }
            }, 15_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              {
                const s3File = file(tmp_filename, options);
                await s3File.write(bigPayload);
                expect(s3File.size).toBeNaN();
                expect(await s3File.text()).toBe(bigPayload);
              }
            }, 10_000);
          });
        });

        describe("Bun.s3", () => {
          describe(bucketInName ? "bucket in path" : "bucket in options", () => {
            const tmp_filename = bucketInName ? `${S3Bucket}/${randomUUID()}` : `${randomUUID()}`;
            const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };
            beforeAll(async () => {
              const s3file = s3(tmp_filename, options);
              await s3file.write("Hello Bun!");
            });

            afterAll(async () => {
              const s3file = s3(tmp_filename, options);
              await s3file.unlink();
            });

            it("should download file via Bun.s3().text()", async () => {
              const s3file = s3(tmp_filename, options);
              const text = await s3file.text();
              expect(text).toBe("Hello Bun!");
            });

            it("should download range", async () => {
              const s3file = s3(tmp_filename, options);
              const text = await s3file.slice(6, 10).text();
              expect(text).toBe("Bun!");
            });

            it("should check if a key exists or content-length", async () => {
              const s3file = s3(tmp_filename, options);
              const exists = await s3file.exists();
              expect(exists).toBe(true);
              expect(s3file.size).toBeNaN();
              const stat = await s3file.stat();
              expect(stat.size).toBe(10);
              expect(stat.etag).toBeDefined();

              expect(stat.lastModified).toBeDefined();
            });

            it("should check if a key does not exist", async () => {
              const s3file = s3(tmp_filename + "-does-not-exist", options);
              const exists = await s3file.exists();
              expect(exists).toBe(false);
            });

            it("presign url", async () => {
              const s3file = s3(tmp_filename, options);
              const response = await fetch(s3file.presign());
              expect(response.status).toBe(200);
              expect(await response.text()).toBe("Hello Bun!");
            });

            it("should be able to set content-type", async () => {
              {
                const s3file = s3(tmp_filename, { ...options, type: "text/css" });
                await s3file.write("Hello Bun!");
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/css");
              }
              {
                const s3file = s3(tmp_filename, options);
                await s3file.write("Hello Bun!", { type: "text/plain" });
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("text/plain");
              }

              {
                const s3file = s3(tmp_filename, options);
                const writer = s3file.writer({ type: "application/json" });
                writer.write("Hello Bun!");
                await writer.end();
                const response = await fetch(s3file.presign());
                expect(response.headers.get("content-type")).toStartWith("application/json");
              }
            });

            it("should be able to upload large files in one go using Bun.write", async () => {
              {
                const s3file = s3(tmp_filename, options);
                await Bun.write(s3file, bigPayload);
                const stat = await s3file.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(stat.etag).toBeDefined();

                expect(stat.lastModified).toBeDefined();
                expect(await s3file.text()).toBe(bigPayload);
              }
            }, 10_000);

            it("should be able to upload large files in one go using S3File.write", async () => {
              {
                const s3File = s3(tmp_filename, options);
                await s3File.write(bigPayload);
                const stat = await s3File.stat();
                expect(stat.size).toBe(Buffer.byteLength(bigPayload));
                expect(stat.etag).toBeDefined();

                expect(stat.lastModified).toBeDefined();

                expect(await s3File.text()).toBe(bigPayload);
              }
            }, 10_000);

            describe("readable stream", () => {
              afterAll(async () => {
                await Promise.all([
                  s3(tmp_filename + "-readable-stream", options).unlink(),
                  s3(tmp_filename + "-readable-stream-big", options).unlink(),
                ]);
              });
              it("should work with small files", async () => {
                const s3file = s3(tmp_filename + "-readable-stream", options);
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
                const s3file = s3(tmp_filename + "-readable-stream-big", options);
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
                expect(bytes).toBe(Buffer.byteLength(bigishPayload));
                expect(Buffer.concat(chunks).toString()).toBe(bigishPayload);
              }, 30_000);
            });
          });
        });
      }
      describe("special characters", () => {
        it("should allow special characters in the path", async () => {
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
        it("should allow starting with slashs and backslashes", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          {
            const s3file = s3(`/${randomUUID()}test.txt`, options);
            await s3file.write("Hello Bun!");
            await s3file.unlink();
          }
          {
            const s3file = s3(`\\${randomUUID()}test.txt`, options);
            await s3file.write("Hello Bun!");
            await s3file.unlink();
          }
          expect().pass();
        });

        it("should allow ending with slashs and backslashes", async () => {
          const options = { ...s3Options, bucket: S3Bucket };
          {
            const s3file = s3(`${randomUUID()}/`, options);
            await s3file.write("Hello Bun!");
            await s3file.unlink();
          }
          {
            const s3file = s3(`${randomUUID()}\\`, options);
            await s3file.write("Hello Bun!");
            await s3file.unlink();
          }
          expect().pass();
        });
      });

      describe("static methods", () => {
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
      describe("errors", () => {
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
          await Bun.write(s3("test.txt", { ...s3Options, bucket: S3Bucket }), file(path.join(dir, "hello.txt")));
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
            expect(["AccessDenied", "NoSuchBucket"]).toContain(e?.code);
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
                expect(["ENAMETOOLONG", "ERR_S3_INVALID_PATH"]).toContain(e?.code);
              }
            }),
          );
        });
      });
      describe("credentials", () => {
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
              options.endpoint = Buffer.alloc(1024, "a").toString();

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

      describe("S3 static methods", () => {
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
