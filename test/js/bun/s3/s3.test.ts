import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { bunExe, bunEnv, getSecret, tempDirWithFiles } from "harness";
import { randomUUID } from "crypto";
import { S3, s3, file } from "bun";
import type { S3File, S3FileOptions } from "bun";
import path from "path";
const s3Options: S3FileOptions = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
};

const S3Bucket = getSecret("S3_R2_BUCKET");

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
        }, 10_000);
      });
    });

    describe("Bun.S3", () => {
      describe(bucketInName ? "bucket in path" : "bucket in options", () => {
        const tmp_filename = bucketInName ? `${S3Bucket}/${randomUUID()}` : `${randomUUID()}`;
        const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };
        beforeAll(async () => {
          const file = new S3(tmp_filename, options);
          await file.write("Hello Bun!");
        });

        afterAll(async () => {
          const file = new S3(tmp_filename, options);
          await file.unlink();
        });

        it("should download file via Bun.s3().text()", async () => {
          const file = new S3(tmp_filename, options);
          const text = await file.text();
          expect(text).toBe("Hello Bun!");
        });

        it("should download range", async () => {
          const file = new S3(tmp_filename, options);
          const text = await file.slice(6, 10).text();
          expect(text).toBe("Bun!");
        });

        it("should check if a key exists or content-length", async () => {
          const file = new S3(tmp_filename, options);
          const exists = await file.exists();
          expect(exists).toBe(true);
          const contentLength = await file.size;
          expect(contentLength).toBe(10);
        });

        it("should check if a key does not exist", async () => {
          const file = new S3(tmp_filename + "-does-not-exist", options);
          const exists = await file.exists();
          expect(exists).toBe(false);
        });

        it("should be able to set content-type", async () => {
          {
            const s3file = new S3(tmp_filename, { ...options, type: "text/css" });
            await s3file.write("Hello Bun!");
            const response = await fetch(s3file.presign());
            expect(response.headers.get("content-type")).toStartWith("text/css");
          }
          {
            const s3file = new S3(tmp_filename, options);
            await s3file.write("Hello Bun!", { type: "text/plain" });
            const response = await fetch(s3file.presign());
            expect(response.headers.get("content-type")).toStartWith("text/plain");
          }

          {
            const s3file = new S3(tmp_filename, options);
            const writer = s3file.writer({ type: "application/json" });
            writer.write("Hello Bun!");
            await writer.end();
            const response = await fetch(s3file.presign());
            expect(response.headers.get("content-type")).toStartWith("application/json");
          }

          {
            await S3.upload(tmp_filename, "Hello Bun!", { ...options, type: "application/xml" });
            const response = await fetch(s3(tmp_filename, options).presign());
            expect(response.headers.get("content-type")).toStartWith("application/xml");
          }
        });

        it("should be able to upload large files using S3.upload + readable Request", async () => {
          {
            await S3.upload(
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
            expect(await S3.size(tmp_filename, options)).toBe(Buffer.byteLength(bigishPayload) * 10);
          }
        }, 10_000);

        it("should be able to upload large files in one go using S3.upload", async () => {
          {
            await S3.upload(tmp_filename, bigPayload, options);
            expect(await S3.size(tmp_filename, options)).toBe(Buffer.byteLength(bigPayload));
            expect(await new S3(tmp_filename, options).text()).toBe(bigPayload);
          }
        }, 10_000);

        it("should be able to upload large files in one go using S3File.write", async () => {
          {
            const s3File = new S3(tmp_filename, options);
            await s3File.write(bigPayload);
            expect(await s3File.size).toBe(Buffer.byteLength(bigPayload));
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
          const contentLength = await s3file.size;
          expect(contentLength).toBe(10);
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
            expect(await S3.size(tmp_filename, options)).toBe(Buffer.byteLength(bigPayload));
            expect(await file(tmp_filename, options).text()).toEqual(bigPayload);
          }
        }, 15_000);

        it("should be able to upload large files in one go using S3File.write", async () => {
          {
            const s3File = file(tmp_filename, options);
            await s3File.write(bigPayload);
            expect(await s3File.size).toBe(Buffer.byteLength(bigPayload));
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
          const contentLength = await s3file.size;
          expect(contentLength).toBe(10);
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

        it("should be able to upload large files in one go using S3.upload", async () => {
          {
            await S3.upload(s3(tmp_filename, options), bigPayload);
            expect(await S3.size(tmp_filename, options)).toBe(Buffer.byteLength(bigPayload));
          }
        }, 10_000);

        it("should be able to upload large files in one go using Bun.write", async () => {
          {
            await Bun.write(s3(tmp_filename, options), bigPayload);
            expect(await S3.size(tmp_filename, options)).toBe(Buffer.byteLength(bigPayload));
            expect(await s3(tmp_filename, options).text()).toBe(bigPayload);
          }
        }, 10_000);

        it("should be able to upload large files in one go using S3File.write", async () => {
          {
            const s3File = s3(tmp_filename, options);
            await s3File.write(bigPayload);
            expect(await s3File.size).toBe(Buffer.byteLength(bigPayload));
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

  describe("credentials", () => {
    it("should error with invalid access key id", async () => {
      [s3, (...args) => new S3(...args), file].forEach(fn => {
        const s3file = fn("s3://bucket/credentials-test", {
          ...s3Options,
          accessKeyId: "invalid",
        });
        expect(s3file.write("Hello Bun!")).rejects.toThrow();
      });
    });
    it("should error with invalid secret key id", async () => {
      [s3, (...args) => new S3(...args), file].forEach(fn => {
        const s3file = fn("s3://bucket/credentials-test", {
          ...s3Options,
          secretAccessKey: "invalid",
        });
        expect(s3file.write("Hello Bun!")).rejects.toThrow();
      });
    });

    it("should error with invalid endpoint", async () => {
      [s3, (...args) => new S3(...args), file].forEach(fn => {
        const s3file = fn("s3://bucket/credentials-test", {
          ...s3Options,
          endpoint: "🙂.🥯",
        });
        expect(s3file.write("Hello Bun!")).rejects.toThrow();
      });
    });

    it("should error with invalid endpoint", async () => {
      [s3, (...args) => new S3(...args), file].forEach(fn => {
        const s3file = fn("s3://bucket/credentials-test", {
          ...s3Options,
          endpoint: "..asd.@%&&&%%",
        });
        expect(s3file.write("Hello Bun!")).rejects.toThrow();
      });
    });

    it("should error with invalid bucket", async () => {
      [s3, (...args) => new S3(...args), file].forEach(fn => {
        const s3file = fn("s3://credentials-test", {
          ...s3Options,
          bucket: "invalid",
        });
        expect(s3file.write("Hello Bun!")).rejects.toThrow();
      });
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

      it("S3.presign should work", async () => {
        const url = S3.presign("s3://bucket/credentials-test", {
          ...s3Options,
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

      it("S3.presign endpoint should work", async () => {
        const url = S3.presign("s3://bucket/credentials-test", {
          ...s3Options,
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

      it("S3.presign endpoint should work", async () => {
        const url = S3.presign("s3://folder/credentials-test", {
          ...s3Options,
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

    it("exists, upload, size, unlink should work", async () => {
      const filename = randomUUID();
      const fullPath = `s3://${S3Bucket}/${filename}`;
      expect(await S3.exists(fullPath, s3Options)).toBe(false);

      await S3.upload(fullPath, "bun", s3Options);
      expect(await S3.exists(fullPath, s3Options)).toBe(true);
      expect(await S3.size(fullPath, s3Options)).toBe(3);
      await S3.unlink(fullPath, s3Options);
      expect(await S3.exists(fullPath, s3Options)).toBe(false);
    });

    it("should be able to upload a slice", async () => {
      const filename = randomUUID();
      const fullPath = `s3://${S3Bucket}/${filename}`;
      const s3file = s3(fullPath, s3Options);
      await s3file.write("Hello Bun!");
      const slice = s3file.slice(6, 10);
      expect(await slice.text()).toBe("Bun!");
      expect(await s3file.text()).toBe("Hello Bun!");

      await S3.upload(fullPath, slice, s3Options);
      const text = await s3file.text();
      expect(text).toBe("Bun!");
      await s3file.unlink();
    });
  });
});
