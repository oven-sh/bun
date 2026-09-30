import { S3Client, type NetworkSink, type S3File, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { DEFAULT_CREDENTIALS, S3Server } from "s3-server";

describe("s3 - Requester Pays", () => {
  const s3Options: S3Options = {
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
  };

  it("should include x-amz-request-payer header when requestPayer is true", async () => {
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

    await S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    }).write("Test content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should NOT include x-amz-request-payer header when requestPayer is false", async () => {
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

    await S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: false,
    }).write("Test content");

    expect(reqHeaders!.get("authorization")).not.toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBeNull();
  });

  it("should NOT include x-amz-request-payer header by default", async () => {
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

    await S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
    }).write("Test content");

    expect(reqHeaders!.get("authorization")).not.toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBeNull();
  });

  it("should work with S3Client instance", async () => {
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

    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await client.file("test_file").write("Test content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should work with file-level options overriding client options", async () => {
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

    // Client has requestPayer: false, but file overrides with true
    const client = new S3Client({
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: false,
    });

    await client.file("test_file", { requestPayer: true }).write("Test content");

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in read operations", async () => {
    let reqHeaders: Headers | undefined = undefined;
    const body = "Test content from requester pays bucket";
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": String(body.length),
          },
          status: 200,
        });
      },
    });

    const file = S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await file.text();

    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in HEAD requests (exists/size/stat)", async () => {
    let reqHeaders: Headers | undefined = undefined;
    let reqMethod: string | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        reqMethod = req.method;
        return new Response("", {
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": "100",
          },
          status: 200,
        });
      },
    });

    const file = S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await file.exists();

    expect(reqMethod).toBe("HEAD");
    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in DELETE requests", async () => {
    let reqHeaders: Headers | undefined = undefined;
    let reqMethod: string | undefined = undefined;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        reqHeaders = req.headers;
        reqMethod = req.method;
        return new Response("", {
          status: 204,
        });
      },
    });

    const file = S3Client.file("test_file", {
      ...s3Options,
      endpoint: server.url.href,
      requestPayer: true,
    });

    await file.delete();

    expect(reqMethod).toBe("DELETE");
    expect(reqHeaders!.get("authorization")).toInclude("x-amz-request-payer");
    expect(reqHeaders!.get("x-amz-request-payer")).toBe("requester");
  });

  it("should include x-amz-request-payer in presigned URLs", async () => {
    const file = S3Client.file("test_file", {
      ...s3Options,
      requestPayer: true,
    });

    const presignedUrl = file.presign({ expiresIn: 3600 });
    const url = new URL(presignedUrl);

    expect(url.searchParams.get("x-amz-request-payer")).toBe("requester");
  });

  it("should NOT include x-amz-request-payer in presigned URLs when requestPayer is false", async () => {
    const file = S3Client.file("test_file", {
      ...s3Options,
      requestPayer: false,
    });

    const presignedUrl = file.presign({ expiresIn: 3600 });
    const url = new URL(presignedUrl);

    expect(url.searchParams.get("x-amz-request-payer")).toBeNull();
  });
});

// writer() makes its upload with the options of the client, of the file and of the call.
describe("s3 - writer() options", () => {
  const MiB = 1024 * 1024;

  type MakeFile = (connection: S3Options, options: S3Options) => S3File;
  type OpenWriter = (file: S3File, options: S3Options) => NetworkSink;
  type Case = [name: string, make: MakeFile, open: OpenWriter];

  // Where the options are given, when they are not given to writer().
  const sources: [string, MakeFile][] = [
    [
      "new S3Client(options).file(key)",
      (connection, options) => new S3Client({ ...connection, ...options }).file("key"),
    ],
    ["client.file(key, options)", (connection, options) => new S3Client(connection).file("key", options)],
    ["S3Client.file(key, options)", (connection, options) => S3Client.file("key", { ...connection, ...options })],
    ["Bun.s3.file(key, options)", (connection, options) => Bun.s3.file("key", { ...connection, ...options })],
    [
      'Bun.file("s3://key", options)',
      (connection, options) =>
        Bun.file("s3://key", { ...connection, ...options } as BlobPropertyBag) as unknown as S3File,
    ],
  ];
  // How writer() is called, when the options are not given to it.
  const forms: [string, OpenWriter][] = [
    ["writer()", file => file.writer()],
    ["writer(undefined)", file => file.writer(undefined)],
    ["writer(null)", file => file.writer(null as unknown as undefined)],
    ["writer({})", file => file.writer({})],
  ];
  const cases: Case[] = [
    ...sources.flatMap(([source, make]) => forms.map(([form, open]): Case => [`${source}.${form}`, make, open])),
    [
      "client.file(key).writer(options)",
      connection => new S3Client(connection).file("key"),
      (file, options) => file.writer(options),
    ],
  ];
  // The cases that send more than one part.
  const multipartCases = cases.filter(([name]) =>
    [
      "new S3Client(options).file(key).writer()",
      "client.file(key, options).writer()",
      "client.file(key, options).writer({})",
    ].includes(name),
  );

  /** Writes `bytes` bytes with a writer, and gives what the server got. With `fail`, the server answers 500. */
  async function upload(make: MakeFile, open: OpenWriter, options: S3Options, bytes: number, { fail = false } = {}) {
    const s3 = new S3Server({ buckets: ["bucket"] });
    let requests = 0;
    let inFlight = 0;
    let mostInFlight = 0;
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests++;
        mostInFlight = Math.max(mostInFlight, ++inFlight);
        try {
          if (fail) return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
          return await s3.fetch(request);
        } finally {
          inFlight--;
        }
      },
    });
    const connection = { ...DEFAULT_CREDENTIALS, bucket: "bucket", endpoint: server.url.href };
    const writer = open(make(connection, options), options);
    writer.write(new Uint8Array(bytes));
    const end = await Promise.resolve(writer.end()).catch(error => error.code);
    return {
      end,
      requests,
      mostInFlight,
      // The sizes of the parts, in the order in which the server answered them.
      parts: s3.requests
        .filter(request => request.operation === "UploadPart")
        .map(request => Number(request.headers.get("content-length"))),
    };
  }

  it.concurrent.each(cases)("retry: %s", async (_, make, open) => {
    // Without `retry: 0` the upload sends four requests.
    expect(await upload(make, open, { retry: 0 }, 1, { fail: true })).toEqual({
      end: "InternalError",
      requests: 1,
      mostInFlight: 1,
      parts: [],
    });
  });

  it.concurrent.each(multipartCases)("partSize and queueSize: %s", async (_, make, open) => {
    expect(await upload(make, open, { partSize: 6 * MiB, queueSize: 1 }, 6 * MiB + 1)).toEqual({
      end: 6 * MiB + 1,
      // CreateMultipartUpload, two times UploadPart, CompleteMultipartUpload
      requests: 4,
      mostInFlight: 1,
      // With `queueSize: 1` the second part starts after the answer to the first part.
      parts: [6 * MiB, 1],
    });
  });

  it.concurrent("the parts are 5 MiB when there is no partSize", async () => {
    const [, make] = sources[1];
    const { end, requests, parts } = await upload(make, file => file.writer(), {}, 5 * MiB + 1);
    expect({ end, requests, parts: parts.sort((a, b) => b - a) }).toEqual({
      end: 5 * MiB + 1,
      requests: 4,
      parts: [5 * MiB, 1],
    });
  });
});
