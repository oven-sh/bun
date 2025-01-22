import { describe, it, expect } from "bun:test";
import { s3, S3Client, type S3Options } from "bun";
import { randomUUID } from "node:crypto";

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
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    const storageClass = "STANDARD_IA";

    await S3Client.file("from_static_file", {
      ...s3Options,
      endpoint: server.url.href,
      storageClass,
    }).write("This is a good file");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-storage-class");
    expect(reqHeaders!.get("x-amz-storage-class")).toBe(storageClass);
  });

  it("should work with static .write() method", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    const storageClass = "REDUCED_REDUNDANCY";

    await S3Client.write("from_static_write", "This is a good file", {
      ...s3Options,
      endpoint: server.url.href,
      storageClass,
    });

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-storage-class");
    expect(reqHeaders!.get("x-amz-storage-class")).toBe(storageClass);
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
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    const storageClass = "ONEZONE_IA";

    const s3 = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
      storageClass,
    });

    const file = s3.file("instance_file");

    await file.write("Some content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-storage-class");
    expect(reqHeaders!.get("x-amz-storage-class")).toBe(storageClass);
  });

  it("should work with instance .file() method + options", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    const storageClass = "SNOW";

    const file = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    }).file("instance_file", { storageClass });

    await file.write("Some content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-storage-class");
    expect(reqHeaders!.get("x-amz-storage-class")).toBe(storageClass);
  });

  it("should work with writer + options on small file", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    const storageClass = "SNOW";

    const s3 = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
    });

    const writer = s3.file("file_from_writer").writer({ storageClass });

    const smallFile = Buffer.alloc(10 * 1024);

    for (let i = 0; i < 10; i++) {
      await writer.write(smallFile);
    }
    await writer.end();

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-storage-class");
    expect(reqHeaders!.get("x-amz-storage-class")).toBe(storageClass);
  });

  it(
    "should work with writer + options on big file",
    async () => {
      let reqHeaders: Headers | undefined = undefined;

      using server = Bun.serve({
        port: 0,
        async fetch(req) {
          const isCreateMultipartUploadRequest = req.method == "POST" && req.url.includes("?uploads=");

          if (isCreateMultipartUploadRequest) {
            reqHeaders = req.headers;
            return new Response(
              `<InitiateMultipartUploadResult>
            <Bucket>my_bucket</Bucket>
            <Key>file_from_writer</Key>
            <UploadId>${randomUUID()}</UploadId>
         </InitiateMultipartUploadResult>`,
              {
                headers: {
                  "Content-Type": "text/xml",
                },
                status: 200,
              },
            );
          }

          const isCompleteMultipartUploadRequets = req.method == "POST" && req.url.includes("uploadId=");

          if (isCompleteMultipartUploadRequets) {
            return new Response(
              `<CompleteMultipartUploadResult>
   <Location>http://my_bucket.s3.<Region>.amazonaws.com/file_from_writer</Location>
   <Bucket>my_bucket</Bucket>
   <Key>file_from_writer</Key>
   <ETag>"f9a5ddddf9e0fcbd05c15bb44b389171-20"</ETag>
</CompleteMultipartUploadResult>`,
              {
                headers: {
                  "Content-Type": "text/xml",
                },
                status: 200,
              },
            );
          }

          return new Response(undefined, { status: 200, headers: { "Etag": `"f9a5ddddf9e0fcbd05c15bb44b389171-20"` } });
        },
      });

      const storageClass = "SNOW";

      const s3 = new S3Client({
        ...s3Options,
        endpoint: server.url.href,
      });

      const writer = s3.file("file_from_writer").writer({
        storageClass,
        queueSize: 10,
        partSize: 5 * 1024,
      });

      const bigFile = Buffer.alloc(10 * 1024 * 1024);

      for (let i = 0; i < 10; i++) {
        await writer.write(bigFile);
      }
      await writer.end();

      expect(reqHeaders!.get("authorization")).toInclude("x-amz-storage-class");
      expect(reqHeaders!.get("x-amz-storage-class")).toBe(storageClass);
    },
    { timeout: 20_000 },
  );

  it("should work with default s3 instance", async () => {
    let reqHeaders: Headers | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
          },
          status: 200,
        });
      },
    });

    const storageClass = "INTELLIGENT_TIERING";

    await s3.file("my_file", { ...s3Options, storageClass, endpoint: server.url.href }).write("any thing");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-storage-class");
    expect(reqHeaders!.get("x-amz-storage-class")).toBe(storageClass);
  });
});
