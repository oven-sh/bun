import { randomUUIDv7, S3Client } from "bun";
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

    const d = randomUUIDv7();
    await client.write(d, "hello", { tagging: "" });
    expect(storedTags(d)).toEqual({});
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
