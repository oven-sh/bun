import { S3Client, type NetworkSink, type S3File, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { DEFAULT_CREDENTIALS, S3Server, serve, type RequestRecord } from "s3-server";

// An upload uses the options of the client, of the file and of the call.
describe("s3 - upload options", () => {
  const MiB = 1024 * 1024;
  // How long the server waits for a part that a correct upload does not send.
  const PATIENCE = 100;

  type MakeFile = (connection: S3Options, options: S3Options) => S3File;
  /** Sends `body` to the file, and gives what the upload gives. */
  type Send = (file: S3File, options: S3Options, body: Buffer) => number | Promise<number>;
  type Case = [name: string, make: MakeFile, send: Send];

  const writer =
    (open: (file: S3File, options: S3Options) => NetworkSink): Send =>
    (file, options, body) => {
      const sink = open(file, options);
      sink.write(body);
      return sink.end();
    };
  const writeLocalFile: Send = async (file, options, body) => {
    using dir = tempDir("s3-upload-options", { body });
    return await file.write(Bun.file(join(String(dir), "body")), options);
  };

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
  const forms: [string, Send][] = [
    ["writer()", writer(file => file.writer())],
    ["writer(undefined)", writer(file => file.writer(undefined))],
    ["writer(null)", writer(file => file.writer(null as unknown as undefined))],
    ["writer({})", writer(file => file.writer({}))],
  ];
  // The file of the last case has other options than the call.
  const others = { partSize: 7 * MiB, queueSize: 3, retry: 2, acl: "private", storageClass: "GLACIER" } as const;
  const cases: Case[] = [
    ...sources.flatMap(([source, make]) => forms.map(([form, send]): Case => [`${source}.${form}`, make, send])),
    [
      "client.file(key).writer(options)",
      connection => new S3Client(connection).file("key"),
      writer((file, options) => file.writer(options)),
    ],
    [
      "client.file(key, others).write(Bun.file(path), options)",
      connection => new S3Client(connection).file("key", others),
      writeLocalFile,
    ],
  ];
  const named = (...names: string[]) => cases.filter(([name]) => names.includes(name));
  // The cases that send 6 MiB.
  const multipartCases = named(
    "new S3Client(options).file(key).writer()",
    "client.file(key, options).writer()",
    "client.file(key, options).writer({})",
    "client.file(key, others).write(Bun.file(path), options)",
  );
  // The options of the file without an object for writer(), and the options of the call.
  const aclCases = named("client.file(key, options).writer()", "client.file(key).writer(options)");

  const headers = (request: RequestRecord) => ({
    "x-amz-acl": request.headers.get("x-amz-acl"),
    "x-amz-storage-class": request.headers.get("x-amz-storage-class"),
    "x-amz-request-payer": request.headers.get("x-amz-request-payer"),
  });

  /**
   * Sends `bytes` bytes, and gives what the server got.
   * - `fail`: the server answers 500 to each request.
   * - `aclsDisabled`: the bucket refuses an ACL that gives access to another account.
   * - `partsInFlight`: the server does not answer the first UploadPart before it has that number of them. For 1,
   *   no signal tells the server that no second part comes. It waits `PATIENCE` ms for one.
   */
  async function upload(
    make: MakeFile,
    send: Send,
    options: S3Options,
    bytes: number,
    {
      fail = false,
      aclsDisabled = false,
      partsInFlight,
    }: { fail?: boolean; aclsDisabled?: boolean; partsInFlight?: 1 | 2 } = {},
  ) {
    const s3 = new S3Server({ buckets: ["bucket"] });
    const bucket = s3.buckets.get("bucket")!;
    if (aclsDisabled) bucket.ownership = "BucketOwnerEnforced";
    let requests = 0;
    let inFlight = 0;
    let mostInFlight = 0;
    let parts = 0;
    const secondPart = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        requests++;
        mostInFlight = Math.max(mostInFlight, ++inFlight);
        try {
          if (fail) return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
          if (partsInFlight !== undefined && new URL(request.url).searchParams.has("partNumber")) {
            if (++parts === 2) secondPart.resolve();
            else if (partsInFlight === 2) await secondPart.promise;
            else await Promise.race([secondPart.promise, Bun.sleep(PATIENCE)]);
          }
          return await s3.fetch(request);
        } finally {
          inFlight--;
        }
      },
    });
    const connection = { ...DEFAULT_CREDENTIALS, bucket: "bucket", endpoint: `http://127.0.0.1:${server.port}` };
    const end = await Promise.resolve(send(make(connection, options), options, Buffer.alloc(bytes))).catch(
      error => error.code,
    );
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

  it.concurrent.each(cases)("acl, storageClass and requestPayer: %s", async (_, make, send) => {
    expect(await upload(make, send, options, 1)).toEqual({
      end: 1,
      requests: 1,
      mostInFlight: 1,
      parts: [],
      put: [all],
      create: [],
      stored: true,
    });
  });

  it.concurrent.each(cases)("retry: %s", async (_, make, send) => {
    // Without `retry: 0` the upload sends four requests.
    expect(await upload(make, send, { retry: 0 }, 1, { fail: true })).toEqual({
      end: "InternalError",
      requests: 1,
      mostInFlight: 1,
      parts: [],
      put: [],
      create: [],
      stored: false,
    });
  });

  // Each of the cases with 6 MiB moves its bytes in this process. They run one at a time: in parallel, each one
  // takes as long as all of them.
  it.each(multipartCases)("partSize and queueSize: %s", async (_, make, send) => {
    const multipart = { ...options, partSize: 6 * MiB, queueSize: 1 };
    expect(await upload(make, send, multipart, 6 * MiB + 1, { partsInFlight: 1 })).toEqual({
      end: 6 * MiB + 1,
      // CreateMultipartUpload, two times UploadPart, CompleteMultipartUpload
      requests: 4,
      mostInFlight: 1,
      parts: [6 * MiB, 1],
      put: [],
      create: [all],
      stored: true,
    });
  });

  // The control for `mostInFlight: 1`: the server sees two parts in flight when the writer sends them.
  it("queueSize 2: client.file(key, options).writer()", async () => {
    const [[, make, send]] = aclCases;
    const { parts, ...rest } = await upload(make, send, { partSize: 6 * MiB, queueSize: 2 }, 6 * MiB + 1, {
      partsInFlight: 2,
    });
    expect({ ...rest, parts: parts.sort((a, b) => b - a) }).toEqual({
      end: 6 * MiB + 1,
      requests: 4,
      mostInFlight: 2,
      parts: [6 * MiB, 1],
      put: [],
      create: [none],
      stored: true,
    });
  });

  it.concurrent("an option of the call replaces that of the file, which replaces that of the client", async () => {
    const make: MakeFile = connection =>
      new S3Client({ ...connection, storageClass: "STANDARD", acl: "private" }).file("key", {
        storageClass: "STANDARD_IA",
      });
    const atFile = writer(file => file.writer());
    expect((await upload(make, atFile, {}, 1)).put).toEqual([
      { ...none, "x-amz-acl": "private", "x-amz-storage-class": "STANDARD_IA" },
    ]);
    const atCall = writer(file => file.writer({ storageClass: "GLACIER" }));
    expect((await upload(make, atCall, {}, 1)).put).toEqual([
      { ...none, "x-amz-acl": "private", "x-amz-storage-class": "GLACIER" },
    ]);
  });

  it.concurrent.each(forms)("%s sends no option when there is none", async (_, send) => {
    const [, make] = sources[1];
    expect(await upload(make, send, {}, 1)).toEqual({
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

    it.concurrent.each(aclCases)("refuses one PutObject: %s", async (_, make, send) => {
      expect(await upload(make, send, refused, 1, { aclsDisabled: true })).toEqual({
        end: "AccessControlListNotSupported",
        requests: 1,
        mostInFlight: 1,
        parts: [],
        put: [{ ...none, "x-amz-acl": "public-read" }],
        create: [],
        stored: false,
      });
    });

    it.concurrent.each(aclCases)("refuses CreateMultipartUpload: %s", async (_, make, send) => {
      expect(await upload(make, send, refused, 5 * MiB + 1, { aclsDisabled: true })).toEqual({
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
      const sink = new S3Client(server.clientOptions("bucket")).file("key", refused).writer();
      sink.write(new Uint8Array(5 * MiB + 1));
      const flushed = await Promise.resolve(sink.flush()).catch(error => error.code);
      // end() holds the writer. A writer that is collected before end() fails its upload with `UnknownError`.
      await sink.end();
      expect(flushed).toBe("AccessControlListNotSupported");
      expect(server.requests.map(request => request.operation)).toEqual(["CreateMultipartUpload"]);
      expect(bucket.latest("key")).toBeUndefined();
    });

    it.concurrent.each(["private", "bucket-owner-full-control"] as const)("accepts the ACL %s", async acl => {
      const [[, make, send]] = aclCases;
      expect(await upload(make, send, { acl }, 1, { aclsDisabled: true })).toEqual({
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
