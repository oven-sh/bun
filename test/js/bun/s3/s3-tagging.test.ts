import { S3Client } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUIDv7 } from "bun";
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

  test("writer() sends the tags on CreateMultipartUpload only", async () => {
    const key = randomUUIDv7();
    const client = new S3Client({ ...options, tagging: { state: "staged" } });
    const partSize = 5 * 1024 * 1024;
    const writer = client.file(key).writer({ partSize });
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

  test("a presigned GET ignores a client default tagging", async () => {
    const key = randomUUIDv7();
    const client = new S3Client({ ...options, tagging: { owner: "app" } });
    await client.write(key, "hello");
    const url = client.presign(key);
    expect(url).toEndWith("X-Amz-SignedHeaders=host");
    const res = await fetch(url);
    expect(await res.text()).toBe("hello");
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
    expect(() => client.file("k", { tagging: "state=a\r\nx-amz-acl: public-read" })).toThrow();
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

  test("writer() sends acl and the file's storageClass", async () => {
    const client = new S3Client(options);
    const a = randomUUIDv7();
    const writer = client.file(a).writer({ acl: "public-read" });
    writer.write("hello");
    await writer.end();
    const [withAcl] = server.requests.filter(r => r.key === a);
    expect(withAcl.headers.get("x-amz-acl")).toBe("public-read");

    const b = randomUUIDv7();
    const plain = client.file(b, { storageClass: "STANDARD_IA" }).writer();
    plain.write("hello");
    await plain.end();
    const [withStorageClass] = server.requests.filter(r => r.key === b);
    expect(withStorageClass.headers.get("x-amz-storage-class")).toBe("STANDARD_IA");
  });
});
