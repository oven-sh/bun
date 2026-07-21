import { S3Client, type S3Options } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";

// The S3 client does not honor NO_PROXY (#32046), so an HTTP_PROXY inherited
// from the environment would hijack the request to the stub server. An empty
// value reads as "no proxy". Unset on CI; this only matters locally.
const proxyEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
    proxyEnv[key] = process.env[key];
    process.env[key] = "";
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(proxyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// The same documented `S3Options` bag must reach the wire whichever entry point
// it was handed to: `client.write(key, data, opts)`, `client.file(key, opts)`,
// `new S3Client(opts)` or `file.writer(opts)`.
describe("s3 - upload options", () => {
  const s3Options: S3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
  };

  const uploadOptions = {
    acl: "public-read",
    storageClass: "STANDARD_IA",
    type: "text/csv",
    contentDisposition: "attachment",
    contentEncoding: "gzip",
  } as const;

  const sent = {
    acl: "public-read",
    storageClass: "STANDARD_IA",
    type: "text/csv",
    contentDisposition: "attachment",
    contentEncoding: "gzip",
  };

  function headersOf(headers: Headers) {
    return {
      acl: headers.get("x-amz-acl"),
      storageClass: headers.get("x-amz-storage-class"),
      type: headers.get("content-type"),
      contentDisposition: headers.get("content-disposition"),
      contentEncoding: headers.get("content-encoding"),
    };
  }

  /** Serves the S3 responses an upload needs, recording the headers it received. */
  function recordingServer() {
    let put: Headers | undefined;
    let createMultipartUpload: Headers | undefined;
    const partSizes: number[] = [];

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "POST" && req.url.includes("uploads=")) {
          createMultipartUpload = req.headers;
          await req.arrayBuffer();
          return new Response(
            `<InitiateMultipartUploadResult><UploadId>an-upload-id</UploadId></InitiateMultipartUploadResult>`,
          );
        }
        if (req.method === "POST" && req.url.includes("uploadId=")) {
          await req.arrayBuffer();
          return new Response(`<CompleteMultipartUploadResult><ETag>"an-etag"</ETag></CompleteMultipartUploadResult>`);
        }
        if (req.method === "PUT" && req.url.includes("partNumber=")) {
          partSizes.push(Number(req.headers.get("content-length")));
        } else if (req.method === "PUT") {
          put = req.headers;
        }
        await req.arrayBuffer();
        return new Response("", { headers: { ETag: `"an-etag"` } });
      },
    });

    return {
      url: server.url.href,
      /** Headers of the PUT that carried the object, for a single-part upload. */
      get put() {
        if (!put) throw new Error("no PUT was sent");
        return headersOf(put);
      },
      /** Headers of the CreateMultipartUpload POST, for a multipart upload. */
      get createMultipartUpload() {
        if (!createMultipartUpload) throw new Error("no CreateMultipartUpload was sent");
        return headersOf(createMultipartUpload);
      },
      /** Content-Length of each PUT ?partNumber= request, for a multipart upload. */
      partSizes,
      [Symbol.dispose]: () => server.stop(true),
    };
  }

  it("honors options passed to client.write(key, data, options)", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, endpoint: recording.url });

    await client.write("a_file", "Hello Bun!", uploadOptions);

    expect(recording.put).toEqual(sent);
  });

  it("honors options passed to client.file(key, options)", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, endpoint: recording.url });

    await client.file("a_file", uploadOptions).write("Hello Bun!");

    expect(recording.put).toEqual(sent);
  });

  it("honors options passed to the S3Client constructor", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, ...uploadOptions, endpoint: recording.url });

    await client.write("a_file", "Hello Bun!");

    expect(recording.put).toEqual(sent);
  });

  it("honors constructor options on a file handle taken from the client", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, ...uploadOptions, endpoint: recording.url });

    await client.file("a_file").write("Hello Bun!");

    expect(recording.put).toEqual(sent);
  });

  it("honors options passed to file.writer(options)", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, endpoint: recording.url });

    const writer = client.file("a_file").writer(uploadOptions);
    writer.write("Hello Bun!");
    await writer.end();

    expect(recording.put).toEqual(sent);
  });

  it("file.writer() with no arguments inherits the file handle's options", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, endpoint: recording.url });

    const writer = client.file("a_file", uploadOptions).writer();
    writer.write("Hello Bun!");
    await writer.end();

    expect(recording.put).toEqual(sent);
  });

  it("sends the options on a multipart CreateMultipartUpload", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, endpoint: recording.url });

    const writer = client.file("a_file").writer({ ...uploadOptions, partSize: 5 * 1024 * 1024 });
    // Larger than partSize, so the upload goes through CreateMultipartUpload
    // instead of a single PUT.
    writer.write(Buffer.alloc(6 * 1024 * 1024));
    await writer.end();

    expect(recording.createMultipartUpload).toEqual(sent);
  });

  it("honors a per-call partSize when the source is a Bun.file", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, endpoint: recording.url });

    // A local-file source goes through `write_file_with_source_destination`'s
    // File→S3 branch, which would otherwise read partSize from the handle.
    using dir = tempDir("s3-upload-partsize", {
      "source.bin": Buffer.alloc(14 * 1024 * 1024),
    });
    const partSize = 7 * 1024 * 1024;
    await client.file("a_file").write(Bun.file(path.join(String(dir), "source.bin")), { ...uploadOptions, partSize });

    // 14 MiB in 7 MiB parts is exactly two parts; the default 5 MiB would send three.
    expect(recording.createMultipartUpload).toEqual(sent);
    expect(recording.partSizes).toEqual([partSize, partSize]);
  });

  it("lets per-call options override the handle's options", async () => {
    using recording = recordingServer();
    const client = new S3Client({ ...s3Options, ...uploadOptions, endpoint: recording.url });

    await client
      .file("a_file", { acl: "private", contentDisposition: "inline" })
      .write("Hello Bun!", { contentEncoding: "br" });

    expect(recording.put).toEqual({
      ...sent,
      acl: "private",
      contentDisposition: "inline",
      contentEncoding: "br",
    });
  });
});
