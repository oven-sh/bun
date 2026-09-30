import { S3Client, type NetworkSink, type S3File, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { DEFAULT_CREDENTIALS, S3Server, serve, type RequestRecord } from "s3-server";

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
  // The options of the file without an object for writer(), and the options of the call.
  const aclCases = cases.filter(([name]) =>
    ["client.file(key, options).writer()", "client.file(key).writer(options)"].includes(name),
  );

  const headers = (request: RequestRecord) => ({
    "x-amz-acl": request.headers.get("x-amz-acl"),
    "x-amz-storage-class": request.headers.get("x-amz-storage-class"),
    "x-amz-request-payer": request.headers.get("x-amz-request-payer"),
  });

  /**
   * Writes `bytes` bytes with a writer, and gives what the server got. With `fail`, the server answers 500.
   * With `aclsDisabled`, the bucket refuses an ACL that gives access to another account.
   */
  async function upload(
    make: MakeFile,
    open: OpenWriter,
    options: S3Options,
    bytes: number,
    { fail = false, aclsDisabled = false } = {},
  ) {
    const s3 = new S3Server({ buckets: ["bucket"] });
    const bucket = s3.buckets.get("bucket")!;
    if (aclsDisabled) bucket.ownership = "BucketOwnerEnforced";
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
    const sent = (operation: string) => s3.requests.filter(request => request.operation === operation);
    return {
      end,
      requests,
      mostInFlight,
      // The sizes of the parts, in the order in which the server answered them.
      parts: sent("UploadPart").map(request => Number(request.headers.get("content-length"))),
      put: sent("PutObject").map(headers),
      create: sent("CreateMultipartUpload").map(headers),
      stored: bucket.latest("key") !== undefined,
    };
  }

  const options = { acl: "public-read", storageClass: "STANDARD_IA", requestPayer: true } as const;
  const all = { "x-amz-acl": "public-read", "x-amz-storage-class": "STANDARD_IA", "x-amz-request-payer": "requester" };
  const none = { "x-amz-acl": null, "x-amz-storage-class": null, "x-amz-request-payer": null };

  it.concurrent.each(cases)("retry: %s", async (_, make, open) => {
    // Without `retry: 0` the upload sends four requests.
    expect(await upload(make, open, { retry: 0 }, 1, { fail: true })).toEqual({
      end: "InternalError",
      requests: 1,
      mostInFlight: 1,
      parts: [],
      put: [],
      create: [],
      stored: false,
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
      put: [],
      create: [none],
      stored: true,
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

  it.concurrent.each(cases)("acl, storageClass and requestPayer: %s", async (_, make, open) => {
    expect(await upload(make, open, options, 1)).toEqual({
      end: 1,
      requests: 1,
      mostInFlight: 1,
      parts: [],
      put: [all],
      create: [],
      stored: true,
    });
  });

  it.concurrent.each(aclCases)("acl and storageClass in a multipart upload: %s", async (_, make, open) => {
    // Two parts can be in flight, and their order is not fixed.
    const { parts, mostInFlight, ...result } = await upload(make, open, options, 5 * MiB + 1);
    expect({ ...result, parts: parts.sort((a, b) => b - a) }).toEqual({
      end: 5 * MiB + 1,
      requests: 4,
      parts: [5 * MiB, 1],
      put: [],
      create: [all],
      stored: true,
    });
  });

  it.concurrent("an option of the call replaces that of the file, which replaces that of the client", async () => {
    const make: MakeFile = connection =>
      new S3Client({ ...connection, storageClass: "STANDARD", acl: "private" }).file("key", {
        storageClass: "STANDARD_IA",
      });
    expect((await upload(make, file => file.writer(), {}, 1)).put).toEqual([
      { ...none, "x-amz-acl": "private", "x-amz-storage-class": "STANDARD_IA" },
    ]);
    expect((await upload(make, file => file.writer({ storageClass: "GLACIER" }), {}, 1)).put).toEqual([
      { ...none, "x-amz-acl": "private", "x-amz-storage-class": "GLACIER" },
    ]);
  });

  it.concurrent.each(forms)("%s sends no option when there is none", async (_, open) => {
    const [, make] = sources[1];
    expect(await upload(make, open, {}, 1)).toEqual({
      end: 1,
      requests: 1,
      mostInFlight: 1,
      parts: [],
      put: [none],
      create: [],
      stored: true,
    });
  });

  describe("a bucket that has ACLs disabled", () => {
    const refused = { acl: "public-read", retry: 0 } as const;

    it.concurrent.each(aclCases)("refuses one PutObject: %s", async (_, make, open) => {
      expect(await upload(make, open, refused, 1, { aclsDisabled: true })).toEqual({
        end: "AccessControlListNotSupported",
        requests: 1,
        mostInFlight: 1,
        parts: [],
        put: [{ ...none, "x-amz-acl": "public-read" }],
        create: [],
        stored: false,
      });
    });

    it.concurrent.each(aclCases)("refuses CreateMultipartUpload: %s", async (_, make, open) => {
      expect(await upload(make, open, refused, 5 * MiB + 1, { aclsDisabled: true })).toEqual({
        end: "AccessControlListNotSupported",
        requests: 1,
        mostInFlight: 1,
        parts: [],
        put: [],
        create: [{ ...none, "x-amz-acl": "public-read" }],
        stored: false,
      });
    });

    it.concurrent("refuses CreateMultipartUpload, and flush() rejects", async () => {
      await using server = serve({ buckets: ["bucket"] });
      const bucket = server.buckets.get("bucket")!;
      bucket.ownership = "BucketOwnerEnforced";
      const writer = new S3Client(server.clientOptions("bucket")).file("key", refused).writer();
      writer.write(new Uint8Array(5 * MiB + 1));
      const flushed = await Promise.resolve(writer.flush()).catch(error => error.code);
      // end() holds the writer. A writer that is collected before end() fails its upload with `UnknownError`.
      await writer.end();
      expect(flushed).toBe("AccessControlListNotSupported");
      expect(server.requests.map(request => request.operation)).toEqual(["CreateMultipartUpload"]);
      expect(bucket.latest("key")).toBeUndefined();
    });

    it.concurrent.each(["private", "bucket-owner-full-control"] as const)("accepts the ACL %s", async acl => {
      const [, make, open] = aclCases[0];
      expect(await upload(make, open, { acl }, 1, { aclsDisabled: true })).toEqual({
        end: 1,
        requests: 1,
        mostInFlight: 1,
        parts: [],
        put: [{ ...none, "x-amz-acl": acl }],
        create: [],
        stored: true,
      });
    });
  });
});
