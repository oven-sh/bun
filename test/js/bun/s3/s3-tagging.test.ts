import { randomUUIDv7, S3Client, type S3File, type S3Options } from "bun";
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { serve, type S3Server, type Tag } from "s3-server";

// The S3 server of test/packages/s3-server verifies the SigV4 signature of
// each request, refuses an unsigned x-amz-* header, and keeps the tags of an
// object. So these tests prove that x-amz-tagging is signed and reaches S3.

const bucket = "buntest";
let server: S3Server;
let options: ReturnType<S3Server["clientOptions"]>;

beforeAll(() => {
  server = serve({ buckets: [bucket] });
  options = server.clientOptions(bucket);
});
afterAll(() => server.stop());

function storedTags(key: string): Record<string, string> {
  const version = server.buckets.get(bucket)!.current(key);
  expect(version).toBeDefined();
  return Object.fromEntries(version!.tags.map((tag: Tag) => [tag.key, tag.value]));
}

function requestsFor(key: string) {
  return server.requests.filter(r => r.key === key).map(r => [r.operation, r.headers.get("x-amz-tagging")]);
}

describe("s3 tagging", () => {
  test("write() with a record URL-encodes the tags", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    await client.write(key, "hello", { tagging: { state: "staged", "owner name": "a+b=c/d" } });
    expect(storedTags(key)).toEqual({ state: "staged", "owner name": "a+b=c/d" });
    expect(requestsFor(key)).toEqual([["PutObject", "state=staged&owner%20name=a%2Bb%3Dc%2Fd"]]);
  });

  test("write() with a pre-encoded string sends it as given", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    await client.write(key, "hello", { tagging: "state=staged&kind=doc" });
    expect(storedTags(key)).toEqual({ state: "staged", kind: "doc" });
  });

  test("S3File.write(), Bun.write() and static write() send the tags", async () => {
    const client = new S3Client(options);
    const a = randomUUIDv7();
    await client.file(a).write("hello", { tagging: { via: "file.write" } });
    expect(storedTags(a)).toEqual({ via: "file.write" });

    const b = randomUUIDv7();
    await Bun.write(client.file(b), "hello", { tagging: { via: "Bun.write" } });
    expect(storedTags(b)).toEqual({ via: "Bun.write" });

    const c = randomUUIDv7();
    await S3Client.write(c, "hello", { ...options, tagging: { via: "static" } });
    expect(storedTags(c)).toEqual({ via: "static" });

    const d = randomUUIDv7();
    await client.file(d, { tagging: { via: "file options" } }).write("hello");
    expect(storedTags(d)).toEqual({ via: "file options" });
  });

  test("a client default applies to every write and an empty record clears it", async () => {
    const client = new S3Client({ ...options, tagging: { owner: "app" } });
    const a = randomUUIDv7();
    await client.write(a, "hello");
    expect(storedTags(a)).toEqual({ owner: "app" });

    const b = randomUUIDv7();
    await client.write(b, "hello", { tagging: { state: "staged" } });
    expect(storedTags(b)).toEqual({ state: "staged" });

    const c = randomUUIDv7();
    await client.write(c, "hello", { tagging: {} });
    expect(storedTags(c)).toEqual({});
    expect(requestsFor(c)).toEqual([["PutObject", null]]);

    const d = randomUUIDv7();
    await client.write(d, "hello", { tagging: "" });
    expect(storedTags(d)).toEqual({});
    expect(requestsFor(d)).toEqual([["PutObject", null]]);
  });

  test("a record value is any string and the string form is ASCII", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    await client.write(key, "hello", { tagging: { owner: "José" } });
    expect(storedTags(key)).toEqual({ owner: "José" });
    expect(() => client.file("k", { tagging: "owner=José" })).toThrow("printable ASCII");
  });

  test("writer() sends the tags on the single PUT", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    const writer = client.file(key).writer({ tagging: { state: "staged" } });
    writer.write("hello");
    await writer.end();
    expect(storedTags(key)).toEqual({ state: "staged" });
    expect(requestsFor(key)).toEqual([["PutObject", "state=staged"]]);
  });

  test("writer() without options sends the file's tags on the single PUT", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    const writer = client.file(key, { tagging: { via: "file" } }).writer();
    writer.write("hello");
    await writer.end();
    expect(storedTags(key)).toEqual({ via: "file" });
    expect(requestsFor(key)).toEqual([["PutObject", "via=file"]]);
  });

  const partSize = 5 * 1024 * 1024;
  test.each([
    ["writer({ partSize })", (client: S3Client, key: string) => client.file(key).writer({ partSize })],
    ["the client's partSize and a bare writer()", (client: S3Client, key: string) => client.file(key).writer()],
  ])("a multipart upload with %s sends the client's tags on CreateMultipartUpload only", async (_, open) => {
    const key = randomUUIDv7();
    const client = new S3Client({ ...options, partSize, tagging: { state: "staged" } });
    const writer = open(client, key);
    writer.write(Buffer.alloc(partSize, "a"));
    writer.write(Buffer.alloc(1024, "b"));
    await writer.end();
    expect(storedTags(key)).toEqual({ state: "staged" });
    const requests = requestsFor(key);
    expect(requests).toContainEqual(["CreateMultipartUpload", "state=staged"]);
    expect(requests.filter(([op]) => op !== "CreateMultipartUpload")).toEqual([
      ["UploadPart", null],
      ["UploadPart", null],
      ["CompleteMultipartUpload", null],
    ]);
  });

  test("fetch() with an s3:// URL sends the tags for a buffered and a streamed body", async () => {
    const a = randomUUIDv7();
    const buffered = await fetch(`s3://${a}`, {
      method: "PUT",
      body: "hello",
      s3: { ...options, tagging: { via: "fetch" } },
    });
    expect(buffered.status).toBe(200);
    expect(storedTags(a)).toEqual({ via: "fetch" });

    const b = randomUUIDv7();
    const streamed = await fetch(`s3://${b}`, {
      method: "PUT",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }),
      s3: { ...options, tagging: { via: "fetch stream" } },
    });
    expect(streamed.status).toBe(200);
    expect(storedTags(b)).toEqual({ via: "fetch stream" });

    const read = await fetch(`s3://${a}`, { s3: { ...options, tagging: { via: "ignored" } } });
    expect(await read.text()).toBe("hello");
    expect(requestsFor(a).at(-1)).toEqual(["GetObject", null]);
  });

  test("a presigned PUT signs x-amz-tagging as a header", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    const url = client.presign(key, { method: "PUT", tagging: { state: "staged", n: "1" } });
    expect(url).toContain("X-Amz-SignedHeaders=host%3Bx-amz-tagging");
    expect(url).not.toContain("staged");

    const without = await fetch(url, { method: "PUT", body: "hello" });
    expect(without.status).toBe(403);

    const wrong = await fetch(url, { method: "PUT", body: "hello", headers: { "x-amz-tagging": "state=final" } });
    expect(wrong.status).toBe(403);

    const ok = await fetch(url, { method: "PUT", body: "hello", headers: { "x-amz-tagging": "state=staged&n=1" } });
    expect(ok.status).toBe(200);
    expect(storedTags(key)).toEqual({ state: "staged", n: "1" });
  });

  test("a presigned PUT signs only host and x-amz-tagging when every other option is set", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    const url = client.presign(key, {
      method: "PUT",
      acl: "public-read",
      storageClass: "STANDARD_IA",
      requestPayer: true,
      contentDisposition: "attachment",
      tagging: { state: "staged" },
    });
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toBe("host;x-amz-tagging");
    const res = await fetch(url, { method: "PUT", body: "hello", headers: { "x-amz-tagging": "state=staged" } });
    expect(res.status).toBe(200);
    expect(storedTags(key)).toEqual({ state: "staged" });
  });

  test("a presigned GET, HEAD or DELETE ignores tagging", async () => {
    const key = randomUUIDv7();
    const client = new S3Client({ ...options, tagging: { owner: "app" } });
    await client.write(key, "hello");

    const plain = client.presign(key);
    expect(new URL(plain).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(await (await fetch(plain)).text()).toBe("hello");

    const tagging = { state: "staged" };
    const get = client.presign(key, { method: "GET", tagging });
    expect(new URL(get).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(await (await fetch(get)).text()).toBe("hello");

    const head = client.presign(key, { method: "HEAD", tagging });
    expect(new URL(head).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect((await fetch(head, { method: "HEAD" })).status).toBe(200);

    const del = client.presign(key, { method: "DELETE", tagging });
    expect(new URL(del).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect((await fetch(del, { method: "DELETE" })).status).toBe(204);
  });

  test("a presigned PUT signs tagging only when the presign call passes it", async () => {
    const key = randomUUIDv7();
    const client = new S3Client({ ...options, tagging: { owner: "app" } });

    // The client and file defaults tag what the client writes, not what a
    // third party uploads with a URL it cannot read the tags from.
    for (const url of [
      client.presign(key, { method: "PUT" }),
      client.presign(key, { method: "PUT", tagging: "" }),
      client.file(key, { tagging: { owner: "file" } }).presign({ method: "PUT" }),
    ]) {
      expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
      expect((await fetch(url, { method: "PUT", body: "hello" })).status).toBe(200);
      expect(storedTags(key)).toEqual({});
    }

    const tagged = client.presign(key, { method: "PUT", tagging: { state: "staged" } });
    expect(new URL(tagged).searchParams.get("X-Amz-SignedHeaders")).toBe("host;x-amz-tagging");
    const res = await fetch(tagged, { method: "PUT", body: "hello", headers: { "x-amz-tagging": "state=staged" } });
    expect(res.status).toBe(200);
    expect(storedTags(key)).toEqual({ state: "staged" });
  });

  test("a tagging value larger than the signer's stack buffer signs", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    // 10 tags, 128 character keys and 256 character values with spaces:
    // about 6.4 KB once encoded, more than the 4 KB the signer keeps on the stack.
    const tagging: Record<string, string> = {};
    const value = Buffer.alloc(128, "a ").toString() + Buffer.alloc(128, "b ").toString();
    for (let i = 0; i < 10; i++) tagging[`k${i}`.padEnd(128, "a")] = value;
    await client.write(key, "hello", { tagging });
    expect(storedTags(key)).toEqual(tagging);
    expect(requestsFor(key)[0][1]!.length).toBeGreaterThan(4096);
  });

  test("rejects a value that is not a record or a string", () => {
    const client = new S3Client(options);
    // @ts-expect-error
    expect(() => client.file("k", { tagging: 1 })).toThrow(TypeError);
    // @ts-expect-error
    expect(() => client.file("k", { tagging: { state: 1 } })).toThrow('tagging["state"] must be a string');
    expect(() => client.file("k", { tagging: "state=a b" })).toThrow("tagging must be a URL-encoded query string");
    expect(() => client.file("k", { tagging: "state=a\r\nx-amz-acl: public-read" })).toThrow(
      "tagging must be a URL-encoded query string",
    );
  });
});

describe("s3 write headers carried by the shared path", () => {
  // These entry points dropped some of the write headers before tagging was
  // added. They pass through the same carrier as tagging now.
  test("fetch() with a buffered body sends acl, storageClass and requestPayer", async () => {
    const key = randomUUIDv7();
    const res = await fetch(`s3://${key}`, {
      method: "PUT",
      body: "hello",
      headers: { "content-disposition": "attachment" },
      s3: { ...options, acl: "public-read", storageClass: "STANDARD_IA", requestPayer: true },
    });
    expect(res.status).toBe(200);
    const [request] = server.requests.filter(r => r.key === key);
    expect(request.operation).toBe("PutObject");
    expect(request.headers.get("x-amz-acl")).toBe("public-read");
    expect(request.headers.get("x-amz-storage-class")).toBe("STANDARD_IA");
    expect(request.headers.get("x-amz-request-payer")).toBe("requester");
    expect(request.headers.get("content-disposition")).toBe("attachment");
  });

  test("a header value signs as S3 reads it: outer whitespace trimmed, inner runs as one space", async () => {
    const client = new S3Client(options);
    const disposition = '  attachment;   filename="a \t b.txt"  ';
    const a = randomUUIDv7();
    await client.write(a, "hello", { contentDisposition: disposition });
    const b = randomUUIDv7();
    const res = await fetch(`s3://${b}`, {
      method: "PUT",
      body: "hello",
      headers: { "content-disposition": disposition },
      s3: options,
    });
    expect(res.status).toBe(200);
    for (const key of [a, b]) {
      const [request] = server.requests.filter(r => r.key === key);
      expect(request.status).toBe(200);
      expect(request.headers.get("content-disposition")).toBe(disposition.trim());
    }
  });

  test("Bun.write() from a file uses the call's partSize over the client's", async () => {
    const partSize = 5 * 1024 * 1024;
    using dir = tempDir("s3-tagging", {});
    const path = join(String(dir), "big.bin");
    await Bun.write(path, Buffer.alloc(partSize + 1024, "a"));
    const client = new S3Client({ ...options, partSize: 8 * 1024 * 1024 });

    const single = randomUUIDv7();
    await Bun.write(client.file(single), Bun.file(path));
    expect(requestsFor(single).map(([op]) => op)).toEqual(["PutObject"]);

    const multi = randomUUIDv7();
    await Bun.write(client.file(multi), Bun.file(path), { partSize });
    expect(requestsFor(multi).map(([op]) => op)).toEqual([
      "CreateMultipartUpload",
      "UploadPart",
      "UploadPart",
      "CompleteMultipartUpload",
    ]);
  });

  test("a bare writer() retries as often as the client's retry says", async () => {
    let puts = 0;
    using failing = Bun.serve({
      port: 0,
      fetch: () => {
        puts++;
        return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
      },
    });
    for (const retry of [0, 2]) {
      puts = 0;
      const client = new S3Client({ ...options, endpoint: failing.url.href, retry });
      const writer = client.file(randomUUIDv7()).writer();
      writer.write("hello");
      await expect(writer.end()).rejects.toMatchObject({ code: "InternalError" });
      expect(puts).toBe(retry + 1);
    }
  });

  test("fetch() with a GET sends requestPayer and no write header", async () => {
    const key = randomUUIDv7();
    const client = new S3Client(options);
    await client.write(key, "hello");
    const res = await fetch(`s3://${key}`, {
      s3: { ...options, acl: "public-read", storageClass: "STANDARD_IA", requestPayer: true, tagging: { a: "b" } },
    });
    expect(await res.text()).toBe("hello");
    const [, request] = server.requests.filter(r => r.key === key);
    expect(request.operation).toBe("GetObject");
    expect(request.headers.get("x-amz-request-payer")).toBe("requester");
    expect(request.headers.get("x-amz-acl")).toBeNull();
    expect(request.headers.get("x-amz-storage-class")).toBeNull();
    expect(request.headers.get("x-amz-tagging")).toBeNull();
  });

  test("writer() sends acl and the file's acl and storageClass", async () => {
    const client = new S3Client(options);
    const a = randomUUIDv7();
    const writer = client.file(a).writer({ acl: "public-read" });
    writer.write("hello");
    await writer.end();
    const [withAcl] = server.requests.filter(r => r.key === a);
    expect(withAcl.headers.get("x-amz-acl")).toBe("public-read");

    const b = randomUUIDv7();
    const plain = client.file(b, { acl: "private", storageClass: "STANDARD_IA" }).writer();
    plain.write("hello");
    await plain.end();
    const [fromFile] = server.requests.filter(r => r.key === b);
    expect(fromFile.headers.get("x-amz-acl")).toBe("private");
    expect(fromFile.headers.get("x-amz-storage-class")).toBe("STANDARD_IA");
  });
});

describe("s3 header defaults of a file or a client", () => {
  // contentDisposition, contentEncoding and tagging given to file() or to a
  // client are the defaults of each upload. The upload call wins for each key.

  let dir: ReturnType<typeof tempDir>;
  let localFile: string;
  let source: S3File;
  beforeAll(async () => {
    dir = tempDir("s3-header-defaults", { "local.txt": "hello" });
    localFile = join(String(dir), "local.txt");
    source = new S3Client(options).file(randomUUIDv7());
    await source.write("hello");
  });
  afterAll(() => dir[Symbol.dispose]());

  // Each option of S3Options that is a header of an upload, except `type`: the
  // content type belongs to the Blob and has its own rules.
  // name: [value of the option, header of the request, value of the header]
  const headerOptions = {
    contentDisposition: [
      'attachment; filename="report.csv"',
      "content-disposition",
      'attachment; filename="report.csv"',
    ],
    contentEncoding: ["identity", "content-encoding", "identity"],
    acl: ["public-read", "x-amz-acl", "public-read"],
    storageClass: ["STANDARD_IA", "x-amz-storage-class", "STANDARD_IA"],
    requestPayer: [true, "x-amz-request-payer", "requester"],
    tagging: ["owner=app", "x-amz-tagging", "owner=app"],
  } as const;
  type Name = keyof typeof headerOptions;
  const names = Object.keys(headerOptions) as Name[];
  const given = (only: readonly Name[] = names) =>
    Object.fromEntries(only.map(name => [name, headerOptions[name][0]])) as S3Options;

  /** The headers of the upload of `key` that `only` names, and which of them the signature covers. */
  function uploaded(key: string, only: readonly Name[]) {
    return server.requests
      .filter(r => r.key === key && (r.operation === "PutObject" || r.operation === "CreateMultipartUpload"))
      .map(({ status, headers }) => {
        const signed = /SignedHeaders=([^,]*)/.exec(headers.get("authorization") ?? "")?.[1].split(";") ?? [];
        return {
          status,
          ...Object.fromEntries(only.map(name => [name, headers.get(headerOptions[name][1])])),
          signed: only.filter(name => signed.includes(headerOptions[name][1])),
        };
      });
  }
  const expected = (only: readonly Name[]) => [
    { status: 200, ...Object.fromEntries(only.map(name => [name, headerOptions[name][2]])), signed: [...only] },
  ];

  const streamOf = (text: string) =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });

  async function writeWithWriter(s3file: S3File, data: string | Uint8Array, writerOptions?: S3Options) {
    const writer = writerOptions === undefined ? s3file.writer() : s3file.writer(writerOptions);
    writer.write(data);
    await writer.end();
  }

  // A 1x1 PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  // The bucket is in the URL.
  const forUrl = (o: S3Options): S3Options => ({ ...options, bucket: undefined, ...o });

  // Where the options are given: each makes the file that a row writes.
  const files: Record<string, (key: string, o: S3Options) => S3File> = {
    "new S3Client(o).file(key)": (key, o) => new S3Client({ ...options, ...o }).file(key),
    "client.file(key, o)": (key, o) => new S3Client(options).file(key, o),
    "S3Client.file(key, o)": (key, o) => S3Client.file(key, { ...options, ...o }),
    'Bun.file("s3://bucket/key", o)': (key, o) => Bun.file(`s3://${bucket}/${key}`, forUrl(o)) as unknown as S3File,
  };

  // How a file is written without an option on the call.
  const uploads: Record<string, (s3file: S3File) => unknown> = {
    "write(string)": s3file => s3file.write("hello"),
    "write(empty string)": s3file => s3file.write(""),
    "write(Blob)": s3file => s3file.write(new Blob(["hello"])),
    "write(Bun.file())": s3file => s3file.write(Bun.file(localFile)),
    "write(another S3 file)": s3file => s3file.write(source),
    "write(Response of a stream)": s3file => s3file.write(new Response(streamOf("hello"))),
    "write(string, {})": s3file => s3file.write("hello", {}),
    "Bun.write(file, string)": s3file => Bun.write(s3file, "hello"),
    "Bun.write(file, ReadableStream)": s3file => Bun.write(s3file, streamOf("hello")),
    "writer()": s3file => writeWithWriter(s3file, "hello"),
    "writer({})": s3file => writeWithWriter(s3file, "hello", {}),
    "slice().write(string)": s3file => s3file.slice(0, 3).write("hello"),
    // The declared type of the first parameter is `string`. The function also takes an S3 file.
    "S3Client.write(file, string)": s3file => (S3Client.write as any)(s3file, "hello"),
    "Bun.Image.write(file)": s3file => new Bun.Image(png).png().write(s3file),
  };

  // An upload that takes the options itself. These rows pass without a default.
  const calls: Record<string, (key: string, o: S3Options) => unknown> = {
    "new S3Client(o).write(key, string)": (key, o) => new S3Client({ ...options, ...o }).write(key, "hello"),
    "file.write(string, o)": (key, o) => new S3Client(options).file(key).write("hello", o),
    "file.write(empty string, o)": (key, o) => new S3Client(options).file(key).write("", o),
    "file.write(Blob, o)": (key, o) => new S3Client(options).file(key).write(new Blob(["hello"]), o),
    "file.write(Bun.file(), o)": (key, o) => new S3Client(options).file(key).write(Bun.file(localFile), o),
    "file.write(another S3 file, o)": (key, o) => new S3Client(options).file(key).write(source, o),
    "file.write(Response of a stream, o)": (key, o) =>
      new S3Client(options).file(key).write(new Response(streamOf("hello")), o),
    // The declared type of the options of Bun.write() has no S3 option.
    "Bun.write(file, string, o)": (key, o) => (Bun.write as any)(new S3Client(options).file(key), "hello", o),
    "Bun.write(file, ReadableStream, o)": (key, o) =>
      (Bun.write as any)(new S3Client(options).file(key), streamOf("hello"), o),
    "file.writer(o)": (key, o) => writeWithWriter(new S3Client(options).file(key), "hello", o),
    "file.slice().write(string, o)": (key, o) => new S3Client(options).file(key).slice(0, 3).write("hello", o),
    "client.write(key, string, o)": (key, o) => new S3Client(options).write(key, "hello", o),
    "S3Client.write(key, string, o)": (key, o) => S3Client.write(key, "hello", { ...options, ...o }),
    "S3Client.write(file, string, o)": (key, o) => (S3Client.write as any)(new S3Client(options).file(key), "hello", o),
    'Bun.write("s3://bucket/key", string, o)': (key, o) =>
      (Bun.write as any)(`s3://${bucket}/${key}`, "hello", forUrl(o)),
  };
  // fetch() takes Content-Disposition and Content-Encoding from `headers`, not from `s3`.
  const fetchNames = names.filter(name => name !== "contentDisposition" && name !== "contentEncoding");
  const fetches: Record<string, (key: string, o: S3Options) => unknown> = {
    'fetch("s3://bucket/key", { method: "PUT", body: string, s3: o })': async (key, o) =>
      void (await (await fetch(`s3://${bucket}/${key}`, { method: "PUT", body: "hello", s3: forUrl(o) })).text()),
    'fetch("s3://bucket/key", { method: "PUT", body: ReadableStream, s3: o })': async (key, o) =>
      void (await (
        await fetch(`s3://${bucket}/${key}`, { method: "PUT", body: streamOf("hello"), s3: forUrl(o) })
      ).text()),
  };

  type Upload = (key: string, o: S3Options) => unknown;
  const rows: [row: string, sent: readonly Name[], upload: Upload][] = [
    ...Object.entries(files).flatMap(([place, file]) =>
      Object.entries(uploads).map(
        ([name, upload]) =>
          [`${place} > ${name}`, names, (key: string, o: S3Options) => upload(file(key, o))] as [
            string,
            Name[],
            Upload,
          ],
      ),
    ),
    ...Object.entries(calls).map(([name, upload]) => [name, names, upload] as [string, Name[], Upload]),
    ...Object.entries(fetches).map(([name, upload]) => [name, fetchNames, upload] as [string, Name[], Upload]),
  ];

  test.each(rows)("%s sends every option", async (_, sent, upload) => {
    const key = randomUUIDv7();
    await upload(key, given(sent));
    expect(uploaded(key, sent)).toEqual(expected(sent));
  });

  // One option at a time: a default that is alone is kept and merged alone.
  const alone: [string, Upload][] = [
    ...Object.entries(files).map(
      ([place, file]) =>
        [`${place} > write(string)`, (key: string, o: S3Options) => file(key, o).write("hello")] as [string, Upload],
    ),
    ["file.write(string, o)", calls["file.write(string, o)"]],
  ];
  test.each(alone)("%s sends each option when it is the only one", async (_, upload) => {
    const got: Record<string, unknown> = {};
    const want: Record<string, unknown> = {};
    for (const name of names) {
      const key = randomUUIDv7();
      await upload(key, given([name]));
      got[name] = uploaded(key, names);
      want[name] = [
        {
          status: 200,
          ...Object.fromEntries(names.map(other => [other, other === name ? headerOptions[name][2] : null])),
          signed: [name],
        },
      ];
    }
    expect(got).toEqual(want);
  });

  const partSize = 5 * 1024 * 1024;
  const multipart: [string, Upload][] = [
    [
      "client.file(key, o).writer()",
      (key, o) => writeWithWriter(new S3Client(options).file(key, o), Buffer.alloc(partSize + 1, "a")),
    ],
    [
      "client.file(key).writer(o)",
      (key, o) => writeWithWriter(new S3Client(options).file(key), Buffer.alloc(partSize + 1, "a"), o),
    ],
  ];
  test.each(multipart)(
    "a multipart upload with %s sends every option with CreateMultipartUpload only",
    async (_, upload) => {
      const key = randomUUIDv7();
      await upload(key, given());
      expect(uploaded(key, names)).toEqual(expected(names));
      // The later requests of the upload carry requestPayer and none of the object headers.
      const objectHeaders = names.filter(name => name !== "requestPayer").map(name => headerOptions[name][1]);
      expect(
        server.requests
          .filter(r => r.key === key && r.operation !== "CreateMultipartUpload")
          .map(r => [r.operation, ...objectHeaders.map(header => r.headers.get(header))])
          .sort(),
      ).toEqual([
        ["CompleteMultipartUpload", null, null, null, null, null],
        ["UploadPart", null, null, null, null, null],
        ["UploadPart", null, null, null, null, null],
      ]);
    },
  );

  const content = {
    contentDisposition: 'attachment; filename="report.csv"',
    contentEncoding: "identity",
  } as const satisfies S3Options;

  /** The two headers of each request for `key`, and which of them the signature covers. */
  function sentFor(key: string) {
    return server.requests
      .filter(r => r.key === key)
      .map(({ operation, headers }) => {
        const signed = /SignedHeaders=([^,]*)/.exec(headers.get("authorization") ?? "")?.[1].split(";") ?? [];
        return {
          operation,
          "content-disposition": headers.get("content-disposition"),
          "content-encoding": headers.get("content-encoding"),
          signed: ["content-disposition", "content-encoding"].filter(name => signed.includes(name)),
        };
      });
  }

  const sent = (
    operation: string,
    contentDisposition: string | null = content.contentDisposition,
    contentEncoding: string | null = content.contentEncoding,
  ) => ({
    operation,
    "content-disposition": contentDisposition,
    "content-encoding": contentEncoding,
    signed: [...(contentDisposition ? ["content-disposition"] : []), ...(contentEncoding ? ["content-encoding"] : [])],
  });

  test("a value of the upload wins over the file, and a value of the file wins over the client", async () => {
    const client = new S3Client({ ...options, ...content, contentDisposition: "inline" });
    const key = randomUUIDv7();
    const s3file = client.file(key, { contentDisposition: "attachment" });
    const ofUpload = { contentDisposition: 'attachment; filename="upload.csv"' };

    await s3file.write("hello");
    await s3file.write("hello", ofUpload);
    await writeWithWriter(s3file, "hello", ofUpload);
    // The options of an upload do not stay on the file.
    await writeWithWriter(s3file, "hello");
    expect(sentFor(key)).toEqual([
      sent("PutObject", "attachment"),
      sent("PutObject", ofUpload.contentDisposition),
      sent("PutObject", ofUpload.contentDisposition),
      sent("PutObject", "attachment"),
    ]);

    // The options of a file do not stay on the client.
    const other = randomUUIDv7();
    await client.file(other).write("hello");
    expect(sentFor(other)).toEqual([sent("PutObject", "inline")]);
  });

  test("an empty string sends no header, and undefined or null keeps the default", async () => {
    const client = new S3Client({ ...options, ...content });
    const key = randomUUIDv7();
    const s3file = client.file(key);

    await s3file.write("hello", { contentDisposition: "" });
    await writeWithWriter(s3file, "hello", { contentEncoding: "" });
    await client.write(key, "hello", { contentEncoding: "" });
    await client.file(key, { contentDisposition: "" }).write("hello");
    await writeWithWriter(client.file(key, { contentDisposition: "", contentEncoding: "" }), "hello");
    // The empty string of one upload does not stay on the file.
    await s3file.write("hello");
    // The declared type has no `null`.
    await s3file.write("hello", { contentDisposition: undefined, contentEncoding: null } as any);
    await client.file(key, { contentDisposition: null, contentEncoding: undefined } as any).write("hello");

    expect(sentFor(key)).toEqual([
      sent("PutObject", null, content.contentEncoding),
      sent("PutObject", content.contentDisposition, null),
      sent("PutObject", content.contentDisposition, null),
      sent("PutObject", null, content.contentEncoding),
      sent("PutObject", null, null),
      sent("PutObject"),
      sent("PutObject"),
      sent("PutObject"),
    ]);
  });

  test("contentDisposition, contentEncoding and tagging merge per key", async () => {
    const client = new S3Client({ ...options, ...content, tagging: { owner: "app" } });

    // The file gives one value and keeps the other two of the client.
    const a = randomUUIDv7();
    await client.file(a, { contentDisposition: "inline" }).write("hello");
    expect(sentFor(a)).toEqual([sent("PutObject", "inline")]);
    expect(storedTags(a)).toEqual({ owner: "app" });

    // The file clears the tags. The upload gives another encoding.
    const b = randomUUIDv7();
    await client.file(b, { tagging: {} }).write("hello", { contentEncoding: "gzip" });
    expect(sentFor(b)).toEqual([sent("PutObject", content.contentDisposition, "gzip")]);
    expect(storedTags(b)).toEqual({});

    // The file gives the tags. The upload clears the disposition.
    const c = randomUUIDv7();
    await writeWithWriter(client.file(c, { tagging: { owner: "file" } }), "hello", { contentDisposition: "" });
    expect(sentFor(c)).toEqual([sent("PutObject", null)]);
    expect(storedTags(c)).toEqual({ owner: "file" });

    // A file that clears all three sends none, and the client keeps its values.
    const d = randomUUIDv7();
    await client.file(d, { contentDisposition: "", contentEncoding: "", tagging: "" }).write("hello");
    expect(sentFor(d)).toEqual([sent("PutObject", null, null)]);
    expect(storedTags(d)).toEqual({});
    const e = randomUUIDv7();
    await client.write(e, "hello");
    expect(sentFor(e)).toEqual([sent("PutObject")]);
    expect(storedTags(e)).toEqual({ owner: "app" });
  });

  // The rule for each key, for every (client, file, call) triple of not given, empty and a value.
  const mergeKeys = [
    ["contentDisposition", "content-disposition", ["inline", "attachment", 'attachment; filename="u.txt"']],
    ["contentEncoding", "content-encoding", ["identity", "gzip", "br"]],
    ["tagging", "x-amz-tagging", ["level=client", "level=file", "level=call"]],
  ] as const;
  const states = ["not given", "empty", "value"] as const;
  const triple = (i: number) => [states[Math.floor(i / 9) % 3], states[Math.floor(i / 3) % 3], states[i % 3]];
  // Each key walks the 27 triples in another order, so the keys are never in step.
  const tripleOf = (row: number, k: number) => triple((row * [1, 2, 4][k] + [0, 5, 11][k]) % 27);

  test.each(Array.from({ length: 27 }, (_, row) => row))(
    "merge row %i: the call, then the file, then the client, for each key",
    async row => {
      const level = (l: number) => {
        const o: Record<string, string> = {};
        mergeKeys.forEach(([name, , values], k) => {
          const state = tripleOf(row, k)[l];
          if (state === "empty") o[name] = "";
          if (state === "value") o[name] = values[l];
        });
        return o;
      };
      const [clientOptions, fileOptions, callOptions] = [level(0), level(1), level(2)];
      const want = mergeKeys.map(([, , values], k) => {
        const t = tripleOf(row, k);
        return t.lastIndexOf("value") > t.lastIndexOf("empty") ? values[t.lastIndexOf("value")] : null;
      });
      const key = randomUUIDv7();
      const s3file = new S3Client({ ...options, ...clientOptions }).file(key, fileOptions);
      if (Object.keys(callOptions).length === 0 && row % 2) await writeWithWriter(s3file, "x");
      else await s3file.write("x", callOptions);
      expect(
        server.requests.filter(r => r.key === key).map(r => mergeKeys.map(([, header]) => r.headers.get(header))),
      ).toEqual([want]);
    },
  );

  // The destination decides. The header defaults of a source that is an S3 file are not copied.
  const ofSource = { contentDisposition: "inline", contentEncoding: "x-source", tagging: { owner: "source" } } as const;
  const sources: [string, (client: S3Client, key: string) => Blob][] = [
    ["a file of a client with values", (_, key) => new S3Client({ ...options, ...ofSource }).file(key)],
    ["client.file(key, options)", (client, key) => client.file(key, ofSource)],
    ["a slice of such a file", (client, key) => client.file(key, ofSource).slice(0, 3)],
  ];
  test.each(sources)("an upload from %s sends the values of the destination only", async (_, sourceOf) => {
    const client = new S3Client(options);
    const from = randomUUIDv7();
    await client.write(from, "hello");

    // The destination has no value: the values of the source are not sent.
    const a = randomUUIDv7();
    await client.file(a).write(sourceOf(client, from) as S3File);
    const b = randomUUIDv7();
    await client.write(b, sourceOf(client, from) as S3File);
    // The destination has its own values: they win for each key.
    const c = randomUUIDv7();
    await client.file(c, { ...content, tagging: { owner: "destination" } }).write(sourceOf(client, from) as S3File);

    expect({ a: sentFor(a), b: sentFor(b), c: sentFor(c) }).toEqual({
      a: [sent("PutObject", null, null)],
      b: [sent("PutObject", null, null)],
      c: [sent("PutObject")],
    });
    expect({ a: storedTags(a), b: storedTags(b), c: storedTags(c) }).toEqual({
      a: {},
      b: {},
      c: { owner: "destination" },
    });
    // The reads of the source send none of them.
    expect(
      server.requests
        .filter(r => r.key === from && r.operation === "GetObject")
        .map(r => [
          r.headers.get("content-disposition"),
          r.headers.get("content-encoding"),
          r.headers.get("x-amz-tagging"),
        ]),
    ).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
  });

  test("only uploads use the values of file() and of the client", async () => {
    const client = new S3Client({ ...options, ...content });
    const key = randomUUIDv7();
    const s3file = client.file(key, content);
    await s3file.write("hello");
    const upload = server.requests.at(-1)!;

    expect(await s3file.exists()).toBe(true);
    await s3file.stat();
    expect(await s3file.text()).toBe("hello");
    await client.list({ prefix: key });
    await s3file.delete();

    expect(
      server.requests.slice(server.requests.lastIndexOf(upload) + 1).map(r => ({
        operation: r.operation,
        "content-disposition": r.headers.get("content-disposition"),
        "content-encoding": r.headers.get("content-encoding"),
      })),
    ).toEqual(
      ["HeadObject", "HeadObject", "GetObject", "ListObjectsV2", "DeleteObject"].map(operation => ({
        operation,
        "content-disposition": null,
        "content-encoding": null,
      })),
    );
  });

  // What a presigned URL takes from a file or a client: requestPayer, with options also acl and
  // storageClass, and no header default. These rows pass before the defaults exist: they pin the rule.
  const presignDefaults = {
    ...given(),
    type: "text/x-probe",
  } as const satisfies S3Options;
  const taken = (url: string) => {
    const query = new URL(url).searchParams;
    return Object.fromEntries(
      [
        "X-Amz-Acl",
        "x-amz-storage-class",
        "x-amz-request-payer",
        "response-content-disposition",
        "response-content-type",
        "X-Amz-SignedHeaders",
      ].map(name => [name, query.get(name)]),
    );
  };
  const bare = {
    "X-Amz-Acl": null,
    "x-amz-storage-class": null,
    "x-amz-request-payer": "requester",
    "response-content-disposition": null,
    "response-content-type": null,
    "X-Amz-SignedHeaders": "host",
  };
  const withOptions = { ...bare, "X-Amz-Acl": "public-read", "x-amz-storage-class": "STANDARD_IA" };
  const presigns: [string, () => string, Record<string, string | null>][] = [
    ["client.file(key, o).presign()", () => new S3Client(options).file("k", presignDefaults).presign(), bare],
    [
      "client.file(key, o).presign({})",
      () => new S3Client(options).file("k", presignDefaults).presign({}),
      withOptions,
    ],
    [
      "client.file(key, o).presign({ method })",
      () => new S3Client(options).file("k", presignDefaults).presign({ method: "PUT" }),
      withOptions,
    ],
    [
      "client.file(key, o).presign({ contentDisposition })",
      () => new S3Client(options).file("k", presignDefaults).presign({ contentDisposition: "inline" }),
      { ...withOptions, "response-content-disposition": "inline" },
    ],
    [
      "S3Client.file(key, o).presign({ expiresIn })",
      () => S3Client.file("k", { ...options, ...presignDefaults }).presign({ expiresIn: 60 }),
      withOptions,
    ],
    [
      "new S3Client(o).file(key).presign()",
      () => new S3Client({ ...options, ...presignDefaults }).file("k").presign(),
      bare,
    ],
    [
      "new S3Client(o).file(key).presign({ method })",
      () => new S3Client({ ...options, ...presignDefaults }).file("k").presign({ method: "PUT" }),
      withOptions,
    ],
    ["new S3Client(o).presign(key)", () => new S3Client({ ...options, ...presignDefaults }).presign("k"), bare],
    [
      "new S3Client(o).presign(key, { method })",
      () => new S3Client({ ...options, ...presignDefaults }).presign("k", { method: "PUT" }),
      withOptions,
    ],
  ];
  test.each(presigns)("%s takes no header default", (_, presign, want) => {
    expect(taken(presign())).toEqual(want);
  });

  test("file() copies the values: a later change of the options object has no effect", async () => {
    const key = randomUUIDv7();
    const fileOptions: S3Options = { ...content };
    const s3file = new S3Client(options).file(key, fileOptions);
    fileOptions.contentDisposition = "inline";
    fileOptions.contentEncoding = "gzip";

    await s3file.write("hello");

    expect(sentFor(key)).toEqual([sent("PutObject")]);
  });

  test("a default that is a 16-bit string is sent and signed", async () => {
    const wide = Buffer.from("inline", "utf16le").toString("utf16le");
    const key = randomUUIDv7();
    await new S3Client({ ...options, contentEncoding: wide }).file(key, { contentDisposition: wide }).write("hello");
    expect(sentFor(key)).toEqual([sent("PutObject", "inline", "inline")]);
    expect(server.requests.find(r => r.key === key)!.status).toBe(200);
  });

  test("a file that clears every default keeps no value", () => {
    const withDefaults = new S3Client({ ...options, ...content, tagging: "a=1" });
    const plain = estimateShallowMemoryUsageOf(new S3Client(options).file("k"));
    const cleared = withDefaults.file("k", { contentDisposition: "", contentEncoding: "", tagging: "" });
    expect(estimateShallowMemoryUsageOf(cleared)).toBe(plain);
    expect(estimateShallowMemoryUsageOf(new S3Client(options).file("k", { contentDisposition: "" }))).toBe(plain);
    expect(estimateShallowMemoryUsageOf(withDefaults.file("k"))).toBeGreaterThan(plain);
  });

  test.each(["contentDisposition", "contentEncoding"] as const)(
    "a %s that is not a string or has a line break is rejected where it is given",
    async option => {
      const client = new S3Client(options);
      const invalidType = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" });
      expect(() => client.file("k", { [option]: 123 } as any)).toThrow(invalidType);
      expect(() => client.file("k", { [option]: false } as any)).toThrow(invalidType);
      expect(() => new S3Client({ ...options, [option]: 123 } as any)).toThrow(invalidType);
      expect(() => client.file("k").writer({ [option]: 123 } as any)).toThrow(invalidType);
      await expect(client.file("k").write("hello", { [option]: 123 } as any)).rejects.toMatchObject({
        code: "ERR_INVALID_ARG_TYPE",
      });
      const lineBreak = new RegExp(`^${option} must not contain .*CR/LF`);
      expect(() => client.file("k", { [option]: "a\r\nx-amz-acl: public-read" })).toThrow(lineBreak);
      expect(() => new S3Client({ ...options, [option]: "a\nb" })).toThrow(lineBreak);
    },
  );
});
