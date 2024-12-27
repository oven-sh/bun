import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { getSecret } from "harness";
import { randomUUID } from "crypto";
import { S3, s3, file } from "bun";
import type { S3File, S3FileOptions } from "bun";

const s3Options: S3FileOptions = {
  accessKeyId: getSecret("S3_R2_ACCESS_KEY"),
  secretAccessKey: getSecret("S3_R2_SECRET_KEY"),
  endpoint: getSecret("S3_R2_ENDPOINT"),
};

const S3Bucket = getSecret("S3_R2_BUCKET");

describe.skipIf(!s3Options.accessKeyId)("s3", () => {
  for (let bucketInName of [true, false]) {
    describe("fetch", () => {
      describe(bucketInName ? "bucket in path" : "bucket in options", () => {
        const tmp_filename = bucketInName ? `s3://${S3Bucket}/${randomUUID()}` : `s3://${randomUUID()}`;
        const options = bucketInName ? s3Options : { ...s3Options, bucket: S3Bucket };
        beforeAll(async () => {
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
            await writer.write("Hello Bun!");
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
            await writer.write("Hello Bun!");
            await writer.end();
            const response = await fetch(s3file.presign());
            expect(response.headers.get("content-type")).toStartWith("application/json");
          }
        });
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
            await writer.write("Hello Bun!");
            await writer.end();
            const response = await fetch(s3file.presign());
            expect(response.headers.get("content-type")).toStartWith("application/json");
          }
        });
      });
    });
  }
});
