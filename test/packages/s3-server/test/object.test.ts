// PutObject, GetObject, HeadObject, DeleteObject, DeleteObjects, CopyObject, GetObjectAttributes,
// RestoreObject and the tags and the ACL of an object. The tests of object lock are in versioning.test.ts.

import { afterAll, describe, expect, test } from "bun:test";
import { isDebug, tls } from "harness";
import type { RequestOptions } from "../index.ts";
import { expectStatus, start, toObject, withoutDefaultType, xml, type TestServer } from "./helpers.ts";

type Fields = Record<string, string>;
type Refused = [name: string, method: string, path: string, options: RequestOptions, status: number, error: Fields];
type Server = TestServer & { now: Date };

const B = "/test-bucket";
const CREATED = new Date("2024-05-06T07:08:09.500Z");
const LAST_MODIFIED = "Mon, 06 May 2024 07:08:09 GMT";
const BEFORE = "Mon, 06 May 2024 07:08:08 GMT";
const AFTER = "Mon, 06 May 2024 07:08:10 GMT";
const LATER = new Date("2024-05-06T08:00:00.000Z");
const HELLO = '"5d41402abc4b2a76b9719d911017c592"';
const OTHER = '"0123456789abcdef0123456789abcdef"';
const SSE = "x-amz-server-side-encryption";
const KMS = `${SSE}-aws-kms-key-id`;
const AES256 = { [SSE]: "AES256" };
const STORED = { "accept-ranges": "bytes", "etag": HELLO, "last-modified": LAST_MODIFIED, ...AES256 };
const BINARY = { ...STORED, "content-length": "5", "content-type": "binary/octet-stream" };
const MIB = 1024 * 1024;
const NO_BUCKET = { Code: "NoSuchBucket", BucketName: "no-such-bucket" };
const NO_KEY = { Code: "NoSuchKey", Key: "missing" };
const MALFORMED = { Code: "MalformedXML" };
const NO_BODY = { Code: "MissingRequestBodyError" };

const md5 = (body: string | Uint8Array, encoding: "base64" | "hex" = "base64") =>
  new Bun.CryptoHasher("md5").update(body).digest(encoding);
const crc32 = (body: string) =>
  Buffer.from(Bun.hash.crc32(body).toString(16).padStart(8, "0"), "hex").toString("base64");
/** A text of that number of characters. */
const text = (size: number, fill = "v") => Buffer.alloc(size * Buffer.byteLength(fill), fill).toString();
const source = (value: string, headers: Fields = {}) => ({ headers: { "x-amz-copy-source": value, ...headers } });
const answer = (status: number, headers: Fields = {}, body: unknown = "") => ({ status, headers, body });
const keysOf = (t: TestServer) => [...t.server.buckets.get(t.bucket)!.objects.keys()];

/** The options of a request that sends a document, with the Content-MD5 header that S3 wants for it. */
function doc(subresource: string, body: string, headers: Fields = {}): RequestOptions {
  const query: Fields = subresource === "" ? {} : { [subresource]: "" };
  return { query, body, headers: { "content-md5": md5(body), ...headers } };
}

function tagging(tags: [key: string, value: string][]): string {
  const items = tags.map(([key, value]) => `<Tag><Key>${key}</Key><Value>${value}</Value></Tag>`);
  return `<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet>${items.join("")}</TagSet></Tagging>`;
}

/** A server with a clock that the test can set. */
function startAt(time: Date): Server {
  const t = { now: time } as Server;
  return Object.assign(t, start({ clock: () => t.now, buckets: ["test-bucket", "other-bucket"] }));
}

/** The response headers without the ones that each response of the server has. */
function headersOf(response: Response): Fields {
  const common = ["date", "server", "x-amz-request-id", "x-amz-id-2"];
  return Object.fromEntries([...response.headers].filter(([name]) => !common.includes(name)));
}

/** The status, the headers and the body of a response. The body of an XML document is an object. */
async function result(pending: Response | Promise<Response>): Promise<{ status: number; headers: Fields; body: any }> {
  const response = withoutDefaultType(await pending);
  const body = await response.text();
  if (response.headers.get("content-type") !== "application/xml" || body === "") {
    return answer(response.status, headersOf(response), body);
  }
  const root = await xml(new Response(body));
  const { RequestId, HostId, ...document } = toObject(root) || {};
  const { "content-length": _length, "content-type": _type, ...headers } = headersOf(response);
  return answer(response.status, headers, { [root.name]: root.children.length === 0 ? root.text : document });
}

const read = (t: TestServer, method: string, key: string, options: RequestOptions = {}) =>
  result(t.client.fetch(method, `${B}/${key}`, options));

async function put(t: TestServer, key: string, body = "hello", headers: Fields = {}, bucket = B): Promise<Response> {
  return expectStatus(await t.client.fetch("PUT", `${bucket}/${key}`, { body, headers }), 200);
}

/** Makes an object of two parts: 5 MiB of `a`, then `tail`. */
async function multipart(t: TestServer, key: string, headers: Fields = {}): Promise<void> {
  const created = await t.client.fetch("POST", `${B}/${key}`, { query: { uploads: "" }, headers });
  const uploadId = toObject(await xml(created)).UploadId;
  const parts: string[] = [];
  for (const [index, body] of [Buffer.alloc(5 * MIB, "a"), Buffer.from("tail")].entries()) {
    const query = { partNumber: String(index + 1), uploadId };
    const part = await t.client.fetch("PUT", `${B}/${key}`, { query, body, payload: "unsigned" });
    const checksum = part.headers.get("x-amz-checksum-crc32");
    const elements = checksum === null ? "" : `<ChecksumCRC32>${checksum}</ChecksumCRC32>`;
    parts.push(`<Part><PartNumber>${index + 1}</PartNumber><ETag>${part.headers.get("etag")}</ETag>${elements}</Part>`);
  }
  const body = `<CompleteMultipartUpload>${parts.join("")}</CompleteMultipartUpload>`;
  await expectStatus(await t.client.fetch("POST", `${B}/${key}`, { query: { uploadId }, body }), 200);
}

/**
 * Tests that the server refuses each request of the table. The error is the
 * document without the IDs of the request, and without the message when the
 * table has none. The requests of a table go to one server, because a request
 * that the server refuses changes nothing. The server has the objects
 * `object`, `public` and `frozen`.
 */
function refuses(rows: Refused[]): void {
  let shared: Promise<{ t: Server; state: () => string; before: string }> | undefined;
  const fixture = async () => {
    const t = startAt(CREATED);
    await put(t, "object", "hello", { "x-amz-tagging": "a=1" });
    await put(t, "public", "hello", { "x-amz-acl": "public-read" });
    await put(t, "frozen", "hello", { "x-amz-storage-class": "GLACIER" });
    const state = () => JSON.stringify([...t.server.buckets.values()].map(bucket => [...bucket.objects]));
    return { t, state, before: state() };
  };
  afterAll(async () => (await shared)?.t.server.stop());

  test.each(rows)("refuses %s", async (_, method, path, options, status, error) => {
    const { t, state, before } = await (shared ??= fixture());
    const response = await result(t.client.fetch(method, path, options));
    const { Message, ...rest } = response.body.Error ?? {};
    const received = "Message" in error ? { Message, ...rest } : rest;
    expect({ status: response.status, error: received }).toEqual({ status, error });
    expect(state()).toBe(before);
  });
}

describe("PutObject", () => {
  test("each metadata header makes the round trip", async () => {
    await using t = startAt(CREATED);
    const metadata = {
      "cache-control": "max-age=60, public",
      "content-disposition": 'attachment; filename="a.txt"',
      "content-encoding": "gzip",
      "content-language": "en-US",
      "content-type": "text/plain; charset=utf-8",
      "expires": "not a date",
      "x-amz-meta-one": "1",
      "x-amz-meta-two-words": "two words",
      "x-amz-storage-class": "STANDARD_IA",
      "x-amz-website-redirect-location": "/other",
    };
    const created = await put(t, "meta", "hello", { ...metadata, "x-amz-tagging": "a=1&b=2" });
    expect(headersOf(created)).toEqual({ "content-length": "0", "etag": HELLO, ...AES256 });
    const headers = { ...STORED, ...metadata, "content-length": "5", "x-amz-tagging-count": "2" };
    expect(await read(t, "GET", "meta")).toEqual(answer(200, headers, "hello"));
    expect(await read(t, "HEAD", "meta")).toEqual(answer(200, headers));
  });

  test("an upload without metadata gets the defaults, also when it replaces an object", async () => {
    await using t = startAt(CREATED);
    // The names and the values of the user metadata have 2048 bytes.
    await put(t, "meta", "", { "x-amz-meta-a": text(2000), "x-amz-meta-b": text(46), "content-type": "text/plain" });
    await put(t, "meta", "");
    const defaults = { ...BINARY, "content-length": "0", "etag": '"d41d8cd98f00b204e9800998ecf8427e"' };
    expect(await read(t, "GET", "meta")).toEqual(answer(200, defaults));
    expect(await read(t, "HEAD", "meta")).toEqual(answer(200, defaults));
    await put(t, "untyped", "", { "content-type": "" });
    expect(await read(t, "GET", "untyped")).toEqual(answer(200, defaults));
    // A key has 1024 bytes at most.
    await put(t, text(1024, "k"), "");
    expect(await read(t, "GET", text(1024, "k"))).toEqual(answer(200, defaults));
  });

  test("Bun.S3Client writes, reads and deletes an object", async () => {
    await using t = start();
    const file = t.s3.file("folder/ünï cødé.txt");
    expect(await file.write("hello", { type: "text/plain", storageClass: "ONEZONE_IA", acl: "public-read" })).toBe(5);
    expect([await file.text(), await file.slice(1, 3).text(), await file.exists()]).toEqual(["hello", "el", true]);
    expect(await file.stat()).toMatchObject({ size: 5, etag: HELLO, type: "text/plain;charset=utf-8" });
    expect(await (await fetch(file.presign({ expiresIn: 60 }))).text()).toBe("hello");
    const stored = { "content-length": "5", "etag": HELLO, "x-amz-storage-class": "ONEZONE_IA" };
    expect(await read(t, "HEAD", "folder/ünï cødé.txt", { anonymous: true })).toMatchObject(answer(200, stored));
    await file.delete();
    expect(await file.exists()).toBe(false);
    await expect(file.text()).rejects.toMatchObject({ code: "NoSuchKey" });
  });

  // S3 reads the bytes of a value as ISO 8859-1 and returns them as an encoded word of RFC 2047.
  test.each([
    ["caf\u00e9", "=?UTF-8?B?Y2Fmw6k=?="],
    ["=?UTF-8?Q?caf=C3=A9?=", "=?UTF-8?B?Y2Fmw6k=?="],
    ["=?UTF-8?B?aGVsbG8=?=", "hello"],
    ["a, b", "a, b"],
  ])("the user metadata value %j comes back as %j", async (sent, received) => {
    await using t = start();
    await put(t, "meta", "", { "x-amz-meta-v": sent });
    expect((await read(t, "HEAD", "meta")).headers["x-amz-meta-v"]).toBe(received);
  });

  // prettier-ignore
  test.each([
    "STANDARD", "REDUCED_REDUNDANCY", "STANDARD_IA", "ONEZONE_IA", "INTELLIGENT_TIERING", "GLACIER", "DEEP_ARCHIVE",
    "GLACIER_IR", "OUTPOSTS", "SNOW", "EXPRESS_ONEZONE", "FSX_OPENZFS",
  ])("the storage class %s", async name => {
    await using t = startAt(CREATED);
    await put(t, "class", "hello", { "x-amz-storage-class": name });
    const headers = name === "STANDARD" ? BINARY : { ...BINARY, "x-amz-storage-class": name };
    expect(await read(t, "HEAD", "class")).toEqual(answer(200, headers));
  });

  const managed = "arn:aws:kms:us-east-1:123456789012:";
  // prettier-ignore
  test.each<[string, Fields, Fields]>([
    ["no header", {}, AES256],
    ["AES256", AES256, AES256],
    ["aws:kms", { [SSE]: "aws:kms" }, { [SSE]: "aws:kms", [KMS]: managed + "alias/aws/s3" }],
    ["aws:kms, the ID of a key and a bucket key", { [SSE]: "aws:kms", [KMS]: "1234abcd", [`${SSE}-bucket-key-enabled`]: "true" },
      { [SSE]: "aws:kms", [KMS]: managed + "key/1234abcd", [`${SSE}-bucket-key-enabled`]: "true" }],
    ["aws:kms:dsse and the ARN of a key", { [SSE]: "aws:kms:dsse", [KMS]: "arn:aws:kms:eu-west-1:1:key/k" },
      { [SSE]: "aws:kms:dsse", [KMS]: "arn:aws:kms:eu-west-1:1:key/k" }],
  ])("the encryption headers of an upload with %s", async (_, headers, encryption) => {
    await using t = startAt(CREATED);
    const created = headersOf(await put(t, "sse", "hello", headers));
    expect(created).toEqual({ "content-length": "0", "etag": HELLO, ...encryption });
    expect(await read(t, "HEAD", "sse")).toEqual(answer(200, { ...BINARY, ...encryption }));
    expect(await read(t, "GET", "sse")).toEqual(answer(200, { ...BINARY, ...encryption }, "hello"));
  });

  // prettier-ignore
  test.each([
    "a b", "ünï/çødé/文字/😀", "/leading", "a//b", "dir/", "tab\there", "line\nfeed", "\u0001control", "a+b%c?d#e&f=g",
    `<'quotes"&>`,
  ])("stores the key %j", async key => {
    await using t = start();
    await put(t, key, "content of " + key);
    expect(keysOf(t)).toEqual([key]);
    expect(await read(t, "GET", key)).toMatchObject({ status: 200, body: "content of " + key });
    expect(await read(t, "DELETE", key)).toEqual(answer(204));
    expect((await read(t, "HEAD", key)).status).toBe(404);
  });

  test("the conditional writes", async () => {
    await using t = start();
    const failed = { Code: "PreconditionFailed" };
    const missing = { Code: "NoSuchKey", Key: "absent" };
    const notImplemented = { Code: "NotImplemented", Header: "If-None-Match" };
    const steps: [headers: Fields, key: string, status: number, error?: Fields][] = [
      [{ "if-none-match": "*" }, "new", 200],
      [{ "if-none-match": "*" }, "new", 412, { ...failed, Condition: "If-None-Match" }],
      [{ "if-none-match": HELLO }, "new", 501, notImplemented],
      [{ "if-none-match": OTHER }, "new", 501, notImplemented],
      [{ "if-match": HELLO }, "new", 200],
      [{ "if-match": HELLO.slice(1, -1) }, "new", 200],
      [{ "if-match": "*" }, "new", 200],
      [{ "if-match": OTHER }, "new", 412, { ...failed, Condition: "If-Match" }],
      [{ "if-match": HELLO }, "absent", 404, missing],
      [{ "if-match": "*" }, "absent", 404, missing],
    ];
    const results: unknown[] = [];
    for (const [headers, key] of steps) {
      const { status, body } = await read(t, "PUT", key, { body: "hello", headers });
      const { Message, ...error } = body.Error ?? {};
      results.push(status === 200 ? [headers, key, status] : [headers, key, status, error]);
    }
    expect(results).toEqual(steps);
    expect(keysOf(t)).toEqual(["new"]);
  });

  const customer = (key: Uint8Array, prefix = SSE) => ({
    [`${prefix}-customer-algorithm`]: "AES256",
    [`${prefix}-customer-key`]: Buffer.from(key).toString("base64"),
    [`${prefix}-customer-key-md5`]: md5(key),
  });
  const customerKey = customer(Buffer.alloc(32, 7));

  test("an object with a customer key needs the key for each request", async () => {
    await using t = start({ tls, clock: () => CREATED });
    const send = (method: string, key: string, headers: Fields, body?: string) => {
      const { url, ...request } = t.client.sign(method, `${B}/${key}`, { headers, body });
      return result(fetch(url, { ...request, tls: { rejectUnauthorized: false } }));
    };
    const other = customer(Buffer.alloc(32, 8));
    const { [`${SSE}-customer-key`]: _key, ...reported } = customerKey;
    const { [SSE]: _algorithm, ...stored } = BINARY;
    const [ALGORITHM, KEY, DIGEST] = Object.keys(customerKey);
    const invalid = (Message: string, ArgumentName: string, ArgumentValue: string, Code = "InvalidArgument") =>
      answer(400, {}, { Error: { Code, Message, ArgumentName, ArgumentValue } });
    const provide = "Requests specifying Server Side Encryption with Customer provided keys must provide ";
    const { [ALGORITHM]: _name, ...noAlgorithm } = customerKey;
    const { [DIGEST]: _digest, ...noDigest } = customerKey;

    const created = { "content-length": "0", "etag": HELLO, ...reported };
    expect(await send("PUT", "secret", customerKey, "hello")).toEqual(answer(200, created));
    expect(await send("GET", "secret", customerKey)).toEqual(answer(200, { ...stored, ...reported }, "hello"));
    expect(await send("HEAD", "secret", customerKey)).toEqual(answer(200, { ...stored, ...reported }));
    const copy = { "x-amz-copy-source": "test-bucket/secret", ...customer(Buffer.alloc(32, 7), "x-amz-copy-source-server-side-encryption") }; // prettier-ignore
    expect(await send("PUT", "plain", copy)).toMatchObject({ status: 200, headers: AES256 });
    expect(await send("GET", "plain", {})).toEqual(answer(200, BINARY, "hello"));

    const Code = "InvalidRequest";
    const needsKey = "The object was stored using a form of Server Side Encryption. The correct parameters must be provided to retrieve the object."; // prettier-ignore
    expect(await send("GET", "secret", {})).toEqual(answer(400, {}, { Error: { Code, Message: needsKey } }));
    expect(await send("HEAD", "secret", {})).toEqual(answer(400, { "content-length": "0" }));
    expect(await send("GET", "secret", other)).toMatchObject({
      status: 403,
      body: { Error: { Code: "AccessDenied" } },
    });
    const noKey = "The encryption parameters are not applicable to this object.";
    expect(await send("GET", "plain", customerKey)).toEqual(answer(400, {}, { Error: { Code, Message: noKey } }));
    // prettier-ignore
    const refused: [Fields, ReturnType<typeof answer>][] = [
      [noAlgorithm, invalid(provide + "a valid encryption algorithm.", ALGORITHM, "null")],
      [{ ...customerKey, [ALGORITHM]: "AES128" }, invalid(expect.any(String), ALGORITHM, "AES128", "InvalidEncryptionAlgorithmError")],
      [{ [ALGORITHM]: "AES256" }, invalid(provide + "an appropriate secret key.", KEY, "null")],
      [noDigest, invalid(provide + "the client calculated MD5 of the secret key.", DIGEST, "null")],
      [{ ...customerKey, [DIGEST]: md5("other") },
        invalid("The calculated MD5 hash of the key did not match the hash that was provided.", DIGEST, md5("other"))],
      [customer(Buffer.alloc(16, 7)), invalid("The secret key was invalid for the specified algorithm.", KEY, "")],
      [{ ...customerKey, [SSE]: "aws:kms" },
        invalid("Server Side Encryption with Customer provided key is incompatible with the encryption method specified", SSE, "aws:kms")],
    ];
    for (const [headers, expected] of refused) expect(await send("PUT", "new", headers, "hello")).toEqual(expected);
    expect(keysOf(t)).toEqual(["secret", "plain"]);
  });
  const tooLong = { Code: "KeyTooLongError", Size: "1025", MaxSizeAllowed: "1024" };
  const upload = (headers: Fields) => ({ body: "x", headers });
  // prettier-ignore
  refuses([
    ["more than 2 KB of user metadata", "PUT", `${B}/new`, upload({ "x-amz-meta-a": text(2000), "x-amz-meta-b": text(47) }),
      400, { Code: "MetadataTooLarge", Size: "2049", MaxSizeAllowed: "2048" }],
    ["the storage class BOGUS", "PUT", `${B}/new`, upload({ "x-amz-storage-class": "BOGUS" }), 400, { Code: "InvalidStorageClass" }],
    ["the storage class glacier", "PUT", `${B}/new`, upload({ "x-amz-storage-class": "glacier" }), 400, { Code: "InvalidStorageClass" }],
    ["a key of 1025 bytes", "PUT", `${B}/${text(1025)}`, {}, 400, tooLong],
    ["a key of 1024 characters and 1025 bytes", "PUT", `${B}/${text(1023)}é`, {}, 400, tooLong],
    ["a read of a key of 1025 bytes", "GET", `${B}/${text(1025)}`, {}, 400, tooLong],
    ["a bucket that does not exist", "PUT", "/no-such-bucket/new", {}, 404, NO_BUCKET],
    ["an encryption algorithm that S3 does not have", "PUT", `${B}/new`, upload({ [SSE]: "AES128" }),
      400, { Code: "InvalidArgument", Message: "The encryption method specified is not supported", ArgumentName: SSE, ArgumentValue: "AES128" }],
    ["a KMS key without aws:kms", "PUT", `${B}/new`, upload({ [KMS]: "1234abcd" }),
      400, { Code: "InvalidArgument", ArgumentName: KMS, ArgumentValue: "1234abcd" }],
    ["a customer key over plain http", "PUT", `${B}/new`, upload(customerKey), 400, { Code: "InvalidRequest",
      Message: "Requests specifying Server Side Encryption with Customer provided keys must be made over a secure connection." }],
    ["a redirect location that is not a path and not a URL", "PUT", `${B}/new`, upload({ "x-amz-website-redirect-location": "a.html" }),
      400, { Code: "InvalidArgument", ArgumentName: "x-amz-website-redirect-location", ArgumentValue: "a.html" }],
  ]);
});

describe("GetObject and HeadObject", () => {
  // The object is from 07:08:09 and the requests are from 08:00:00.
  test.each<[Fields, number, string]>([
    [{ "if-match": HELLO }, 200, ""],
    [{ "if-match": HELLO.slice(1, -1) }, 200, ""],
    [{ "if-match": "*" }, 200, ""],
    [{ "if-match": `${OTHER}, ${HELLO}` }, 200, ""],
    [{ "if-match": OTHER }, 412, "If-Match"],
    [{ "if-none-match": OTHER }, 200, ""],
    [{ "if-none-match": HELLO }, 304, ""],
    [{ "if-none-match": HELLO.slice(1, -1) }, 304, ""],
    [{ "if-none-match": "*" }, 304, ""],
    [{ "if-none-match": `${OTHER}, ${HELLO}` }, 304, ""],
    [{ "if-modified-since": BEFORE }, 200, ""],
    [{ "if-modified-since": LAST_MODIFIED }, 304, ""],
    [{ "if-modified-since": AFTER }, 304, ""],
    [{ "if-modified-since": "yesterday" }, 200, ""],
    // S3 takes a date after the current time as not valid.
    [{ "if-modified-since": "Mon, 06 May 2024 09:00:00 GMT" }, 200, ""],
    [{ "if-unmodified-since": BEFORE }, 412, "If-Unmodified-Since"],
    [{ "if-unmodified-since": LAST_MODIFIED }, 200, ""],
    [{ "if-unmodified-since": AFTER }, 200, ""],
    [{ "if-unmodified-since": "yesterday" }, 200, ""],
    [{ "if-match": HELLO, "if-unmodified-since": BEFORE }, 200, ""],
    [{ "if-match": OTHER, "if-unmodified-since": AFTER }, 412, "If-Match"],
    [{ "if-none-match": HELLO, "if-modified-since": BEFORE }, 304, ""],
    [{ "if-none-match": OTHER, "if-modified-since": AFTER }, 200, ""],
  ])("the conditions %j are %d", async (headers, status, Condition) => {
    await using t = startAt(CREATED);
    await put(t, "object", "hello", { "cache-control": "no-cache", "expires": "0", "x-amz-meta-a": "1" });
    t.now = LATER;
    const kept = { "etag": HELLO, "last-modified": LAST_MODIFIED, "cache-control": "no-cache", "expires": "0" };
    const full = { ...BINARY, ...kept, "x-amz-meta-a": "1" };
    const failed = { Error: { Code: "PreconditionFailed", Message: expect.any(String), Condition } };
    const expected: Record<number, [get: Fields, body: unknown, head: Fields]> = {
      200: [full, "hello", full],
      304: [kept, "", kept],
      412: [{}, failed, { "content-length": "0" }],
    };
    const [get, body, head] = expected[status];
    expect(await read(t, "GET", "object", { headers })).toEqual(answer(status, get, body));
    expect(await read(t, "HEAD", "object", { headers })).toEqual(answer(status, head));
  });

  const partial = (range: string, body: string) => ({ status: 206, range, body });
  const complete = { status: 200, range: null, body: "0123456789" };
  const invalid = (RangeRequested: string, size: number) => {
    const Error = { Code: "InvalidRange", Message: expect.any(String), RangeRequested, ActualObjectSize: String(size) };
    return { status: 416, range: `bytes */${size}`, body: { Error } };
  };

  test.each<[string, string, { status: number; range: string | null; body: any }]>([
    ["bytes=0-4", "0123456789", partial("bytes 0-4/10", "01234")],
    ["bytes=2-", "0123456789", partial("bytes 2-9/10", "23456789")],
    ["bytes=-3", "0123456789", partial("bytes 7-9/10", "789")],
    ["bytes=9-9", "0123456789", partial("bytes 9-9/10", "9")],
    ["bytes=5-100", "0123456789", partial("bytes 5-9/10", "56789")],
    ["bytes=-100", "0123456789", partial("bytes 0-9/10", "0123456789")],
    ["bytes=10-", "0123456789", invalid("bytes=10-", 10)],
    ["bytes=10-20", "0123456789", invalid("bytes=10-20", 10)],
    ["bytes=-0", "0123456789", invalid("bytes=-0", 10)],
    ["bytes=0-", "", invalid("bytes=0-", 0)],
    ["bytes=-3", "", invalid("bytes=-3", 0)],
    ["bytes=40-50", "", invalid("bytes=40-50", 0)],
    // S3 serves one range. It answers a request that it cannot use with the complete object.
    ["bytes=0-1,4-5", "0123456789", complete],
    ["bytes=5-2", "0123456789", complete],
    ["bytes=a-b", "0123456789", complete],
    ["bytes=-", "0123456789", complete],
    ["items=0-4", "0123456789", complete],
    ["0-4", "0123456789", complete],
  ])("the range %j of %j", async (range, content, expected) => {
    await using t = startAt(CREATED);
    await put(t, "object", content);
    const get = await read(t, "GET", "object", { headers: { range } });
    const head = await read(t, "HEAD", "object", { headers: { range } });
    const served = (headers: Fields): string | null => headers["content-range"] ?? null;
    expect({ status: get.status, range: served(get.headers), body: get.body }).toEqual(expected);
    expect({ status: head.status, range: served(head.headers), body: head.body }).toEqual({ ...expected, body: "" });
    if (get.status === 416) return;
    const headers = { ...BINARY, "etag": `"${md5(content, "hex")}"`, "content-length": String(get.body.length) };
    expect(get.headers).toEqual(get.status === 206 ? { ...headers, "content-range": expected.range! } : headers);
    expect(head.headers).toEqual(get.headers);
  });

  test("partNumber=1 of an object that is not from a multipart upload is the complete object", async () => {
    await using t = startAt(CREATED);
    await put(t, "object");
    const headers = { ...BINARY, "content-range": "bytes 0-4/5" };
    expect(await read(t, "GET", "object", { query: { partNumber: "1" } })).toEqual(answer(206, headers, "hello"));
    expect(await read(t, "HEAD", "object", { query: { partNumber: "1" } })).toEqual(answer(206, headers));
  });

  test("the response-* parameters replace headers of the response", async () => {
    await using t = startAt(CREATED);
    const own = { "content-type": "text/plain", "cache-control": "no-cache" };
    await put(t, "object", "hello", own);
    const query = {
      "response-cache-control": "no-store",
      "response-content-disposition": 'attachment; filename="caf\u00e9.txt"',
      "response-content-encoding": "identity",
      "response-content-language": "de",
      "response-content-type": "text/html",
      "response-expires": "Thu, 01 Dec 1994 16:00:00 GMT",
    };
    const replaced = Object.fromEntries(Object.entries(query).map(([name, value]) => [name.slice(9), value]));
    const headers = { ...BINARY, ...replaced };
    expect(await read(t, "GET", "object", { query })).toEqual(answer(200, headers, "hello"));
    expect(await read(t, "HEAD", "object", { query })).toEqual(answer(200, headers));
    const presigned = t.client.presign("GET", `${B}/object`, { query });
    expect(await result(fetch(presigned))).toEqual(answer(200, headers, "hello"));
    const ranged = { ...headers, "content-length": "2", "content-range": "bytes 1-2/5" };
    expect(await read(t, "GET", "object", { query, headers: { range: "bytes=1-2" } })).toEqual(
      answer(206, ranged, "el"),
    );
    expect(await read(t, "GET", "object")).toEqual(answer(200, { ...BINARY, ...own }, "hello"));
    const empty = { query: { "response-content-type": "" } };
    expect(await read(t, "GET", "object", empty)).toEqual(answer(200, { ...BINARY, ...own }, "hello"));
  });

  const checksum = { "x-amz-checksum-crc32": crc32("hello"), "x-amz-checksum-type": "FULL_OBJECT" };
  test.each<[string, Fields, Fields]>([
    ["without the mode", {}, {}],
    ["with the mode", { "x-amz-checksum-mode": "ENABLED" }, checksum],
    ["with the mode in lower case", { "x-amz-checksum-mode": "enabled" }, checksum],
    ["with the mode and a range", { "x-amz-checksum-mode": "ENABLED", "range": "bytes=0-9" }, {}],
  ])("the checksum of the object %s", async (_, headers, reported) => {
    await using t = startAt(CREATED);
    const created = await put(t, "object", "hello", { "x-amz-checksum-crc32": crc32("hello") });
    expect(headersOf(created)).toEqual({ "content-length": "0", "etag": HELLO, ...AES256, ...checksum });
    const [status, range] = "range" in headers ? [206, { "content-range": "bytes 0-4/5" }] : [200, {}];
    expect(await read(t, "GET", "object", { headers })).toEqual(
      answer(status, { ...BINARY, ...range, ...reported }, "hello"),
    );
    expect(await read(t, "HEAD", "object", { headers })).toEqual(answer(status, { ...BINARY, ...range, ...reported }));
    await put(t, "plain");
    expect(await read(t, "GET", "plain", { headers })).toEqual(answer(status, { ...BINARY, ...range }, "hello"));
  });

  const restore = (days: number) => doc("restore", `<RestoreRequest><Days>${days}</Days></RestoreRequest>`);

  test.each(["GLACIER", "DEEP_ARCHIVE"])("an object in %s has no content before RestoreObject", async StorageClass => {
    await using t = startAt(CREATED);
    await put(t, "archive", "hello", { "x-amz-storage-class": StorageClass });
    const Message = "The operation is not valid for the object's storage class";
    const archived = answer(403, {}, { Error: { Code: "InvalidObjectState", Message, StorageClass } });
    const headers = { ...BINARY, "x-amz-storage-class": StorageClass };
    const restored = (date: string) => ({
      ...headers,
      "x-amz-restore": `ongoing-request="false", expiry-date="${date}"`,
    });
    expect(await read(t, "GET", "archive")).toEqual(archived);
    expect(await read(t, "HEAD", "archive")).toEqual(answer(200, headers));

    // The copy of the object that S3 restores expires at the first midnight after the 2 days.
    expect(await read(t, "POST", "archive", restore(2))).toEqual(answer(202, { "content-length": "0" }));
    expect(await read(t, "HEAD", "archive")).toEqual(answer(200, restored("Thu, 09 May 2024 00:00:00 GMT")));
    expect(await read(t, "GET", "archive")).toEqual(answer(200, restored("Thu, 09 May 2024 00:00:00 GMT"), "hello"));
    expect((await read(t, "PUT", "copy", source("test-bucket/archive"))).status).toBe(200);
    expect(await read(t, "POST", "archive", restore(1))).toEqual(answer(200, { "content-length": "0" }));
    expect(await read(t, "HEAD", "archive")).toEqual(answer(200, restored("Wed, 08 May 2024 00:00:00 GMT")));

    t.now = new Date("2024-05-08T00:00:00Z");
    expect(await read(t, "GET", "archive")).toEqual(archived);
    expect(await read(t, "HEAD", "archive")).toEqual(answer(200, headers));
    expect(await read(t, "POST", "archive", restore(1))).toEqual(answer(202, { "content-length": "0" }));
  });

  test("an object in GLACIER_IR has content, and a public object has content for each sender", async () => {
    await using t = startAt(CREATED);
    const options = { "x-amz-storage-class": "GLACIER_IR", "x-amz-acl": "public-read", "x-amz-tagging": "a=1" };
    await put(t, "instant", "hello", options);
    const headers = { ...BINARY, "x-amz-storage-class": "GLACIER_IR" };
    // The tag count is for a sender that can read the tags.
    expect(await read(t, "GET", "instant", { anonymous: true })).toEqual(answer(200, headers, "hello"));
    expect(await read(t, "GET", "instant")).toEqual(answer(200, { ...headers, "x-amz-tagging-count": "1" }, "hello"));
  });

  const notArchived = "Restore is not allowed for the object's current storage class";
  // prettier-ignore
  refuses([
    ["a key that does not exist", "GET", `${B}/missing`, {}, 404, { ...NO_KEY, Message: "The specified key does not exist." }],
    ["a key that does not exist, without a document for HEAD", "HEAD", `${B}/missing`, {}, 404, {}],
    ["a bucket that does not exist", "GET", "/no-such-bucket/object", {}, 404, { ...NO_BUCKET, Message: "The specified bucket does not exist" }],
    ["a bucket that does not exist, without a document for HEAD", "HEAD", "/no-such-bucket/object", {}, 404, {}],
    ["a part that the object does not have", "GET", `${B}/object`, { query: { partNumber: "2" } },
      416, { Code: "InvalidPartNumber", PartNumberRequested: "2", ActualPartCount: "1" }],
    ["the part number 0", "GET", `${B}/object`, { query: { partNumber: "0" } },
      400, { Code: "InvalidArgument", ArgumentName: "partNumber", ArgumentValue: "0" }],
    ["a range together with a part number", "GET", `${B}/object`, { query: { partNumber: "1" }, headers: { range: "bytes=0-1" } },
      400, { Code: "InvalidRequest", Message: "Cannot specify both Range header and partNumber query parameter" }],
    ["a response-* parameter without a signature", "GET", `${B}/public`, { anonymous: true, query: { "response-content-type": "text/html" } },
      400, { Code: "InvalidRequest", Message: "Request specific response headers cannot be used for anonymous GET requests." }],
    ["a response-* parameter with a character that ISO 8859-1 does not have", "GET", `${B}/object`, { query: { "response-content-language": "文" } },
      400, { Code: "InvalidArgument", Message: "Header value cannot be represented using ISO-8859-1.", ArgumentName: "response-content-language", ArgumentValue: "文" }],
    ["the header that selects the encryption of an upload", "GET", `${B}/object`, { headers: AES256 }, 400, { Code: "InvalidArgument",
      Message: "x-amz-server-side-encryption header is not supported for this operation.", ArgumentName: SSE, ArgumentValue: "AES256" }],
    ["the header that selects the encryption of an upload, for HEAD", "HEAD", `${B}/object`, { headers: AES256 }, 400, {}],
    ["RestoreObject for an object in STANDARD", "POST", `${B}/object`, restore(1),
      403, { Code: "InvalidObjectState", Message: notArchived, StorageClass: "STANDARD" }],
    ["RestoreObject without the number of days", "POST", `${B}/frozen`, doc("restore", "<RestoreRequest></RestoreRequest>"), 400, MALFORMED],
    ["RestoreObject without a document", "POST", `${B}/frozen`, doc("restore", ""), 400, NO_BODY],
    ["RestoreObject for a key that does not exist", "POST", `${B}/missing`, restore(1), 404, NO_KEY],
  ]);
});

describe("DeleteObject and DeleteObjects", () => {
  const remove = (keys: string[], quiet?: boolean) =>
    `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${quiet === undefined ? "" : `<Quiet>${quiet}</Quiet>`}` +
    keys.map(key => `<Object><Key>${Bun.escapeHTML(key)}</Key></Object>`).join("") +
    "</Delete>";
  const many = (count: number) => Array.from({ length: count }, (_, index) => `key-${index}`);

  test("DeleteObject is 204 for a key that exists and for a key that does not", async () => {
    await using t = start();
    await put(t, "object");
    expect(await read(t, "DELETE", "object")).toEqual(answer(204));
    expect(await read(t, "DELETE", "object")).toEqual(answer(204));
    expect(keysOf(t)).toEqual([]);
  });

  test("DeleteObjects reports each key, also a key that does not exist", async () => {
    await using t = start();
    const keys = ["a", `<b> & "c" 'd'`, "e f/ü", "quiet", "kept"];
    for (const key of keys) await put(t, key);
    const Deleted = [{ Key: keys[0] }, { Key: "missing" }, { Key: keys[1] }, { Key: keys[2] }];
    const normal = doc("delete", remove(Deleted.map(({ Key }) => Key)));
    expect(await result(t.client.fetch("POST", B, normal))).toEqual(answer(200, {}, { DeleteResult: { Deleted } }));
    // A checksum header is as good as Content-MD5.
    const body = remove(["quiet", "missing"], true);
    const quiet = { query: { delete: "" }, body, headers: { "x-amz-checksum-crc32": crc32(body) } };
    expect(await result(t.client.fetch("POST", B, quiet))).toEqual(answer(200, {}, { DeleteResult: "" }));
    expect(keysOf(t)).toEqual(["kept"]);
  });

  // A debug build of Bun needs too much time to read and to write the documents of 1000 keys.
  test.skipIf(isDebug)("DeleteObjects takes 1000 keys", async () => {
    await using t = start();
    const response = await t.client.fetch("POST", B, doc("delete", remove(many(1000))));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text.match(/<Deleted><Key>[^<]+<\/Key><\/Deleted>/g)).toHaveLength(1000);
  });

  // prettier-ignore
  refuses([
    ["DeleteObject for a bucket that does not exist", "DELETE", "/no-such-bucket/object", {}, 404, NO_BUCKET],
    ["DeleteObjects for a bucket that does not exist", "POST", "/no-such-bucket", doc("delete", remove(["object"])), 404, NO_BUCKET],
    ["DeleteObjects without Content-MD5 and without a checksum", "POST", B, { query: { delete: "" }, body: remove(["object"]) },
      400, { Code: "InvalidRequest", Message: "Missing required header for this request: Content-MD5" }],
    ["DeleteObjects with the Content-MD5 of other content", "POST", B, doc("delete", remove(["object"]), { "content-md5": md5("other") }),
      400, { Code: "BadDigest", CalculatedDigest: md5(remove(["object"])), ExpectedDigest: md5("other") }],
    ["DeleteObjects without keys", "POST", B, doc("delete", remove([])), 400, MALFORMED],
    ["DeleteObjects with 1001 keys", "POST", B, doc("delete", remove(["object", ...many(1000)])), 400, MALFORMED],
    ["DeleteObjects with a document that has no end", "POST", B, doc("delete", "<Delete><Object><Key>object</Key></Object>"), 400, MALFORMED],
    ["DeleteObjects with another document", "POST", B, doc("delete", "<Remove><Object><Key>object</Key></Object></Remove>"), 400, MALFORMED],
    ["DeleteObjects with an object that has no key", "POST", B, doc("delete", "<Delete><Object><ETag>x</ETag></Object></Delete>"), 400, MALFORMED],
    ["DeleteObjects without a document", "POST", B, doc("delete", ""), 400, NO_BODY],
  ]);
});

describe("CopyObject", () => {
  const properties = {
    "cache-control": "max-age=1",
    "content-disposition": "inline",
    "content-encoding": "identity",
    "content-language": "en",
    "content-type": "text/plain",
    "expires": "Wed, 21 Oct 2015 07:28:00 GMT",
    "x-amz-meta-a": "1",
  };
  const others = {
    "x-amz-acl": "public-read",
    "x-amz-checksum-crc32": crc32("hello"),
    "x-amz-storage-class": "STANDARD_IA",
    "x-amz-tagging": "a=1",
    "x-amz-website-redirect-location": "/other",
  };
  const copied = { ...STORED, "last-modified": "Mon, 06 May 2024 08:00:00 GMT", "content-length": "5" };
  const tagged = { ...properties, "x-amz-tagging-count": "1" };
  const replaced = { "content-type": "image/png", "x-amz-meta-b": "2" };
  const standard = { "content-type": "binary/octet-stream" };
  const kms = { [SSE]: "aws:kms", [KMS]: "arn:aws:kms:eu-west-1:1:key/k" };
  const placed = { "x-amz-storage-class": "ONEZONE_IA", "x-amz-website-redirect-location": "/new" };
  const result200 = (ETag: string, LastModified: string, checksum: Fields = {}) =>
    answer(200, AES256, { CopyObjectResult: { LastModified, ETag, ...checksum } });

  // The storage class, the redirect location and the ACL of the copy are from the request and not from the source.
  // prettier-ignore
  test.each<[string, Fields, Fields, string]>([
    ["no directive", {}, tagged, "a=1"],
    ["the directive COPY and new metadata", { "x-amz-metadata-directive": "COPY", ...replaced }, tagged, "a=1"],
    ["the directive REPLACE and new metadata", { "x-amz-metadata-directive": "REPLACE", ...replaced }, { ...replaced, "x-amz-tagging-count": "1" }, "a=1"],
    ["the directive REPLACE and no metadata", { "x-amz-metadata-directive": "REPLACE" }, { ...standard, "x-amz-tagging-count": "1" }, "a=1"],
    ["the tagging directive COPY and new tags", { "x-amz-tagging-directive": "COPY", "x-amz-tagging": "b=2" }, tagged, "a=1"],
    ["the tagging directive REPLACE and new tags", { "x-amz-tagging-directive": "REPLACE", "x-amz-tagging": "b=2&c=3" }, { ...properties, "x-amz-tagging-count": "2" }, "b=2&c=3"],
    ["the tagging directive REPLACE and no tags", { "x-amz-tagging-directive": "REPLACE" }, properties, ""],
    ["a storage class, a redirect location and an ACL", { ...placed, "x-amz-acl": "authenticated-read" }, { ...tagged, ...placed }, "a=1"],
    ["SSE-KMS", kms, { ...tagged, ...kms }, "a=1"],
  ])("a copy with %s", async (_, headers, expected, tags) => {
    await using t = startAt(CREATED);
    await put(t, "source", "hello", { ...properties, ...others });
    t.now = LATER;
    const checksum = { ChecksumType: "FULL_OBJECT", ChecksumCRC32: crc32("hello") };
    const made = result200(HELLO, "2024-05-06T08:00:00.000Z", checksum);
    if (SSE in headers) made.headers = kms;
    expect(await read(t, "PUT", "copy", source("test-bucket/source", headers))).toEqual(made);
    expect(await read(t, "GET", "copy")).toEqual(answer(200, { ...copied, ...expected }, "hello"));
    const { Grant } = (await read(t, "GET", "copy", { query: { acl: "" } })).body.AccessControlPolicy.AccessControlList;
    const permissions = "x-amz-acl" in headers ? ["FULL_CONTROL", "READ"] : ["FULL_CONTROL"];
    expect([Grant].flat().map(grant => grant.Permission)).toEqual(permissions);
    const { Tag = [] } = (await read(t, "GET", "copy", { query: { tagging: "" } })).body.Tagging.TagSet;
    expect([Tag].flat().map((tag: Fields) => `${tag.Key}=${tag.Value}`).join("&")).toBe(tags);
    expect((await read(t, "HEAD", "source")).headers).toMatchObject({ ...properties, "last-modified": LAST_MODIFIED });
  });

  // prettier-ignore
  test.each<[string, Fields, Fields]>([
    ["new metadata", { "x-amz-metadata-directive": "REPLACE", "x-amz-meta-b": "2" }, { ...standard, "x-amz-meta-b": "2" }],
    ["a storage class", { "x-amz-storage-class": "STANDARD" }, properties],
    ["a redirect location", { "x-amz-website-redirect-location": "/new" }, { ...properties, "x-amz-website-redirect-location": "/new" }],
    ["an encryption", AES256, properties],
  ])("a copy of an object to itself with %s", async (_, headers, expected) => {
    await using t = startAt(CREATED);
    await put(t, "object", "hello", properties);
    t.now = LATER;
    const made = result200(HELLO, "2024-05-06T08:00:00.000Z");
    expect(await read(t, "PUT", "object", source("/test-bucket/object", headers))).toEqual(made);
    expect(await read(t, "GET", "object")).toEqual(answer(200, { ...copied, ...expected }, "hello"));
  });

  test.each([
    ["a b", "test-bucket/a b"],
    ["a b", "/test-bucket/a%20b"],
    ["a b", "test-bucket/a+b"],
    ["a+b", "test-bucket/a%2Bb"],
    ["ünï/çødé 文字", "/test-bucket/%C3%BCn%C3%AF/%C3%A7%C3%B8d%C3%A9%20%E6%96%87%E5%AD%97"],
    ["ünï/çødé 文字", `test-bucket/${encodeURIComponent("ünï/çødé 文字")}`],
    ["a%b?c&d=e", "/test-bucket/a%25b%3Fc%26d%3De"],
    ["a b", "/test-bucket/a%20b?versionId=null"],
    ["from-other", "other-bucket/from-other"],
  ])("the object %j is the source %j", async (key, value) => {
    await using t = startAt(CREATED);
    await put(t, key, key, {}, value.includes("other-bucket") ? "/other-bucket" : B);
    const made = result200(`"${md5(key, "hex")}"`, "2024-05-06T07:08:09.000Z");
    expect(await read(t, "PUT", "copy", source(value))).toEqual(made);
    expect(await read(t, "GET", "copy")).toMatchObject({ status: 200, body: key });
  });

  // A copy has no 304. A condition that fails is 412 in each case.
  test.each<[Fields, number, string]>([
    [{ "if-match": HELLO }, 200, ""],
    [{ "if-match": OTHER }, 412, "If-Match"],
    [{ "if-none-match": OTHER }, 200, ""],
    [{ "if-none-match": HELLO }, 412, "If-None-Match"],
    [{ "if-modified-since": BEFORE }, 200, ""],
    [{ "if-modified-since": AFTER }, 412, "If-Modified-Since"],
    [{ "if-modified-since": "Mon, 06 May 2024 09:00:00 GMT" }, 200, ""],
    [{ "if-unmodified-since": AFTER }, 200, ""],
    [{ "if-unmodified-since": BEFORE }, 412, "If-Unmodified-Since"],
    [{ "if-match": HELLO, "if-unmodified-since": BEFORE }, 200, ""],
    [{ "if-none-match": HELLO, "if-modified-since": BEFORE }, 412, "If-None-Match"],
  ])("the conditions %j for the source are %d", async (conditions, status, condition) => {
    await using t = startAt(CREATED);
    await put(t, "source");
    t.now = LATER;
    const headers = Object.entries(conditions).map(([name, value]) => [`x-amz-copy-source-${name}`, value]);
    const Condition = `x-amz-copy-source-${condition}`;
    const failed = answer(412, {}, { Error: { Code: "PreconditionFailed", Message: expect.any(String), Condition } });
    expect(await read(t, "PUT", "copy", source("test-bucket/source", Object.fromEntries(headers)))).toEqual(
      status === 200 ? result200(HELLO, "2024-05-06T08:00:00.000Z") : failed,
    );
    expect(keysOf(t)).toEqual(status === 200 ? ["source", "copy"] : ["source"]);
  });

  test("the entity tag of the copy of an object from a multipart upload is the MD5 of the content", async () => {
    await using t = startAt(CREATED);
    await multipart(t, "parts");
    const content = Buffer.concat([Buffer.alloc(5 * MIB, "a"), Buffer.from("tail")]);
    const digests = [md5(content.subarray(0, 5 * MIB), "hex"), md5("tail", "hex")].map(hex => Buffer.from(hex, "hex"));
    const size = { "content-length": String(content.length) };
    const parts = { ...size, "etag": `"${md5(Buffer.concat(digests), "hex")}-2` + '"' };
    expect(await read(t, "HEAD", "parts")).toEqual(answer(200, { ...BINARY, ...parts }));
    const etag = `"${md5(content, "hex")}"`;
    expect(await read(t, "PUT", "copy", source("test-bucket/parts"))).toEqual(
      result200(etag, "2024-05-06T07:08:09.000Z"),
    );
    // The copy has one part.
    const whole = { ...BINARY, ...size, etag, "content-range": `bytes 0-${content.length - 1}/${content.length}` };
    expect(await read(t, "HEAD", "copy", { query: { partNumber: "1" } })).toEqual(answer(206, whole));
  });

  const invalidSource = (ArgumentValue: string) => ({
    Code: "InvalidArgument",
    Message: "Copy Source must mention the source bucket and key: sourcebucket/sourcekey",
    ArgumentName: "x-amz-copy-source",
    ArgumentValue,
  });
  const toItself = {
    Code: "InvalidRequest",
    Message:
      "This copy request is illegal because it is trying to copy an object to itself without changing the object's metadata, storage class, website redirect location or encryption attributes.",
  };
  const directive = (name: string, ArgumentValue: string, Message: string) =>
    [source("test-bucket/object", { [name]: ArgumentValue }), 400, { Code: "InvalidArgument", Message, ArgumentName: name, ArgumentValue }] as const; // prettier-ignore
  // prettier-ignore
  refuses([
    ["a copy of an object to itself", "PUT", `${B}/object`, source("test-bucket/object"), 400, toItself],
    ["a copy of an object to itself with the directive COPY", "PUT", `${B}/object`, source("/test-bucket/object", { "x-amz-metadata-directive": "COPY", "x-amz-meta-b": "2" }), 400, toItself],
    ["a copy of an object to itself with new tags only", "PUT", `${B}/object`, source("/test-bucket/object", { "x-amz-tagging-directive": "REPLACE", "x-amz-tagging": "b=2" }), 400, toItself],
    ["a copy of an object to itself with an ACL only", "PUT", `${B}/object`, source("/test-bucket/object", { "x-amz-acl": "public-read" }), 400, toItself],
    ["a metadata directive that S3 does not have", "PUT", `${B}/copy`, ...directive("x-amz-metadata-directive", "MERGE", "Unknown metadata directive.")],
    ["a metadata directive in lower case", "PUT", `${B}/copy`, ...directive("x-amz-metadata-directive", "replace", "Unknown metadata directive.")],
    ["a tagging directive that S3 does not have", "PUT", `${B}/copy`, ...directive("x-amz-tagging-directive", "MERGE", "Unknown tagging directive.")],
    ["a source key that does not exist", "PUT", `${B}/copy`, source("test-bucket/missing"), 404, NO_KEY],
    ["a source bucket that does not exist", "PUT", `${B}/copy`, source("no-such-bucket/object"), 404, NO_BUCKET],
    ["a destination bucket that does not exist", "PUT", "/no-such-bucket/copy", source("test-bucket/object"), 404, NO_BUCKET],
    ...["/test-bucket", "test-bucket/", "/", "test-bucket/object?partNumber=1", "test-bucket/%FF"].map((value): Refused =>
      [`the source ${value}`, "PUT", `${B}/copy`, source(value), 400, invalidSource(value)]),
    ["a source in GLACIER", "PUT", `${B}/copy`, source("test-bucket/frozen"),
      403, { Code: "InvalidObjectState", Message: "Operation is not valid for the source object's storage class", StorageClass: "GLACIER" }],
    ["a destination that exists, with If-None-Match", "PUT", `${B}/public`, source("test-bucket/object", { "if-none-match": "*" }),
      412, { Code: "PreconditionFailed", Condition: "If-None-Match" }],
  ]);
});

describe("GetObjectAttributes", () => {
  const ALL = "ETag,Checksum,ObjectParts,StorageClass,ObjectSize";
  const names = (value: string, headers: Fields = {}) => ({
    query: { attributes: "" },
    headers: { "x-amz-object-attributes": value, ...headers },
  });
  const attributes = async (t: TestServer, key: string, value: string, headers?: Fields) =>
    (await read(t, "GET", key, names(value, headers))).body.GetObjectAttributesResponse;
  const Checksum = { ChecksumCRC32: crc32("hello"), ChecksumType: "FULL_OBJECT" };
  const ETag = HELLO.slice(1, -1);

  // An element is there for an attribute that the request names and that the object has.
  test.each<[string, object | string, object | string]>([
    [
      ALL,
      { ETag, Checksum, StorageClass: "GLACIER", ObjectSize: "5" },
      { ETag, StorageClass: "STANDARD", ObjectSize: "5" },
    ],
    ["ETag", { ETag }, { ETag }],
    ["Checksum", { Checksum }, ""],
    ["ObjectParts", "", ""],
    ["StorageClass", { StorageClass: "GLACIER" }, { StorageClass: "STANDARD" }],
    ["ObjectSize, ETag", { ETag, ObjectSize: "5" }, { ETag, ObjectSize: "5" }],
  ])("the attributes %s", async (value, checked, plain) => {
    await using t = startAt(CREATED);
    await put(t, "object", "hello", { "x-amz-checksum-crc32": crc32("hello"), "x-amz-storage-class": "GLACIER" });
    await put(t, "plain");
    const headers = { "last-modified": LAST_MODIFIED };
    const response = await read(t, "GET", "object", names(value));
    expect(response).toEqual(answer(200, headers, { GetObjectAttributesResponse: checked }));
    expect(await attributes(t, "plain", value)).toEqual(plain);
  });

  test("the parts of an object from a multipart upload", async () => {
    await using t = startAt(CREATED);
    await multipart(t, "plain");
    await multipart(t, "checked", { "x-amz-checksum-algorithm": "CRC32" });
    const etag = (await read(t, "HEAD", "plain")).headers.etag.slice(1, -1);
    const ObjectSize = String(5 * MIB + 4);
    // S3 lists the parts of an object that has checksums only.
    const plain = { ETag: etag, ObjectParts: { PartsCount: "2" }, StorageClass: "STANDARD", ObjectSize };
    expect(await attributes(t, "plain", ALL)).toEqual(plain);

    const parts = [
      { PartNumber: "1", Size: String(5 * MIB), ChecksumCRC32: crc32(text(5 * MIB, "a")) },
      { PartNumber: "2", Size: "4", ChecksumCRC32: crc32("tail") },
    ];
    const page = (marker: number, next: number, MaxParts: number, IsTruncated: boolean, Part?: object) => {
      const [PartNumberMarker, NextPartNumberMarker] = [String(marker), String(next)];
      const list = {
        PartNumberMarker,
        NextPartNumberMarker,
        MaxParts: String(MaxParts),
        IsTruncated: String(IsTruncated),
      };
      return { ObjectParts: { PartsCount: "2", ...list, ...(Part ? { Part } : {}) } };
    };
    const marker = (value: number) => ({ "x-amz-part-number-marker": String(value) });
    expect(await attributes(t, "checked", "ObjectParts")).toEqual(page(0, 2, 1000, false, parts));
    expect(await attributes(t, "checked", "ObjectParts", { "x-amz-max-parts": "1" })).toEqual(
      page(0, 1, 1, true, parts[0]),
    );
    expect(await attributes(t, "checked", "ObjectParts", { "x-amz-max-parts": "1", ...marker(1) })).toEqual(
      page(1, 2, 1, false, parts[1]),
    );
    expect(await attributes(t, "checked", "ObjectParts", marker(2))).toEqual(page(2, 2, 1000, false));
  });

  const invalidName = (ArgumentValue: string) => ({
    Code: "InvalidArgument",
    Message: "Invalid attribute name specified.",
    ArgumentName: "x-amz-object-attributes",
    ArgumentValue,
  });
  // prettier-ignore
  refuses([
    ["a request without x-amz-object-attributes", "GET", `${B}/object`, { query: { attributes: "" } },
      400, { Code: "InvalidRequest", Message: "Missing required header for this request: x-amz-object-attributes" }],
    ["an attribute that S3 does not have", "GET", `${B}/object`, names("ETag,Owner"), 400, invalidName("ETag,Owner")],
    ["an attribute in lower case", "GET", `${B}/object`, names("etag"), 400, invalidName("etag")],
    ["a list of attributes without a name", "GET", `${B}/object`, names(","), 400, invalidName(",")],
    ["the attributes of a key that does not exist", "GET", `${B}/missing`, names("ETag"), 404, NO_KEY],
    ["the attributes in a bucket that does not exist", "GET", "/no-such-bucket/object", names("ETag"), 404, NO_BUCKET],
  ]);
});

describe("the tags and the ACL of an object", () => {
  const tags = { query: { tagging: "" } };
  const acl = { query: { acl: "" } };
  const tagSet = (list: [string, string][]) => {
    const Tag = list.map(([Key, Value]) => ({ Key, Value }));
    return { Tagging: { TagSet: Tag.length === 0 ? "" : { Tag: Tag.length === 1 ? Tag[0] : Tag } } };
  };
  const done = answer(200, { "content-length": "0" });

  test("PutObjectTagging, GetObjectTagging and DeleteObjectTagging", async () => {
    await using t = startAt(CREATED);
    await put(t, "object");
    expect(await read(t, "GET", "object", tags)).toEqual(answer(200, {}, tagSet([])));

    const ten = Array.from({ length: 7 }, (_, index): [string, string] => [`key-${index}`, `value-${index}`]);
    ten.push(["b c+d-e=f.g_h:i/j@k", "2 + 2 = 4"], ["empty", ""], [text(128, "𝒜"), text(256, "文")]);
    expect(await read(t, "PUT", "object", doc("tagging", tagging(ten)))).toEqual(done);
    expect(await read(t, "GET", "object", tags)).toEqual(answer(200, {}, tagSet(ten)));
    expect(await read(t, "GET", "object")).toEqual(answer(200, { ...BINARY, "x-amz-tagging-count": "10" }, "hello"));
    expect(await read(t, "HEAD", "object")).toEqual(answer(200, { ...BINARY, "x-amz-tagging-count": "10" }));

    expect(await read(t, "PUT", "object", doc("tagging", tagging([["only", "one"]])))).toEqual(done);
    expect(await read(t, "GET", "object", tags)).toEqual(answer(200, {}, tagSet([["only", "one"]])));
    expect(await read(t, "DELETE", "object", tags)).toEqual(answer(204));
    expect(await read(t, "GET", "object", tags)).toEqual(answer(200, {}, tagSet([])));
    expect(await read(t, "GET", "object")).toEqual(answer(200, BINARY, "hello"));
    expect(await read(t, "PUT", "object", doc("tagging", tagging([])))).toEqual(done);
  });

  // prettier-ignore
  test.each<[string, [string, string][]]>([
    ["a=1&b=2", [["a", "1"], ["b", "2"]]],
    ["a&b=", [["a", ""], ["b", ""]]],
    ["a%20b=c%2Bd&e+f=g=h", [["a b", "c+d"], ["e f", "g=h"]]],
    ["%C3%BC=%E6%96%87", [["ü", "文"]]],
  ])("the tags of the header x-amz-tagging: %s", async (header, list) => {
    await using t = start();
    await put(t, "object", "hello", { "x-amz-tagging": header });
    expect(await read(t, "GET", "object", tags)).toEqual(answer(200, {}, tagSet(list)));
  });

  test("PutObjectAcl takes the document of GetObjectAcl", async () => {
    await using t = start();
    await put(t, "object");
    const owner = t.server.credentials.owner;
    const Owner = { ID: owner.id, DisplayName: owner.displayName };
    const everyone = { Grantee: { URI: "http://acs.amazonaws.com/groups/global/AllUsers" }, Permission: "READ" };
    const grants = [{ Grantee: Owner, Permission: "FULL_CONTROL" }, everyone];
    const policy = (Grant: object) => answer(200, {}, { AccessControlPolicy: { Owner, AccessControlList: { Grant } } });
    expect(await read(t, "GET", "object", acl)).toEqual(policy(grants[0]));
    expect(await read(t, "PUT", "object", { ...acl, headers: { "x-amz-acl": "public-read" } })).toEqual(done);
    expect(await read(t, "GET", "object", acl)).toEqual(policy(grants));

    const document = await (await t.client.fetch("GET", `${B}/object`, acl)).text();
    expect(await read(t, "PUT", "object", { ...acl, headers: { "x-amz-acl": "private" } })).toEqual(done);
    expect(await read(t, "GET", "object", acl)).toEqual(policy(grants[0]));
    expect(await read(t, "PUT", "object", doc("acl", document))).toEqual(done);
    expect(await read(t, "GET", "object", acl)).toEqual(policy(grants));
  });

  const tag = (key: string, value: string) => doc("tagging", tagging([[key, value]]));
  const invalidKey = (TagKey: string) => ({
    Code: "InvalidTag",
    Message: "The TagKey you have provided is invalid",
    TagKey,
  });
  const invalidValue = (TagValue: string) =>
    ({ Code: "InvalidTag", Message: "The TagValue you have provided is invalid", TagKey: "k", TagValue }); // prettier-ignore
  const eleven = Array.from({ length: 11 }, (_, index): [string, string] => [`key-${index}`, ""]);
  const header = (value: string) => ({ headers: { "x-amz-tagging": value } });
  const invalidHeader = (ArgumentValue: string) => ({
    Code: "InvalidArgument",
    Message:
      "The header 'x-amz-tagging' shall be encoded as UTF-8 then URLEncoded URL query parameters without tag name duplicates.",
    ArgumentName: "x-amz-tagging",
    ArgumentValue,
  });
  // prettier-ignore
  refuses([
    ["11 tags", "PUT", `${B}/object`, doc("tagging", tagging(eleven)), 400, { Code: "BadRequest", Message: "Object tags cannot be greater than 10" }],
    ["two tags with the same key", "PUT", `${B}/object`, doc("tagging", tagging([["a", "1"], ["a", "2"]])),
      400, { Code: "InvalidTag", Message: "Cannot provide multiple Tags with the same key", TagKey: "a" }],
    ["a tag key of 129 characters", "PUT", `${B}/object`, tag(text(129), ""), 400, invalidKey(text(129))],
    ["a tag without a key", "PUT", `${B}/object`, tag("", "v"), 400, invalidKey("")],
    ["a tag value of 257 characters", "PUT", `${B}/object`, tag("k", text(257)), 400, invalidValue(text(257))],
    ...["a,b", "a;b", "a?b", "a!b", "a*b", "a#b", "a%b", "a(b)", "a\tb", "😀"].flatMap((bad): Refused[] => [
      [`the tag key ${JSON.stringify(bad)}`, "PUT", `${B}/object`, tag(bad, "v"), 400, invalidKey(bad)],
      [`the tag value ${JSON.stringify(bad)}`, "PUT", `${B}/object`, tag("k", bad), 400, invalidValue(bad)],
    ]),
    ...["aws:cost", "AWS:cost"].map((TagKey): Refused => [`the tag key ${TagKey}`, "PUT", `${B}/object`, tag(TagKey, "v"),
      400, { Code: "InvalidTag", Message: "System tags cannot be added/updated by requester", TagKey }]),
    ["a tagging document that has no end", "PUT", `${B}/object`, doc("tagging", "<Tagging><TagSet>"), 400, MALFORMED],
    ["a tagging document without a tag set", "PUT", `${B}/object`, doc("tagging", "<Tagging></Tagging>"), 400, MALFORMED],
    ["a tag without a value element", "PUT", `${B}/object`, doc("tagging", "<Tagging><TagSet><Tag><Key>a</Key></Tag></TagSet></Tagging>"), 400, MALFORMED],
    ["another document for the tags", "PUT", `${B}/object`, doc("tagging", "<Tags><TagSet></TagSet></Tags>"), 400, MALFORMED],
    ["PutObjectTagging without a document", "PUT", `${B}/object`, doc("tagging", ""), 400, NO_BODY],
    ["PutObjectTagging for a key that does not exist", "PUT", `${B}/missing`, tag("a", "1"), 404, NO_KEY],
    ["GetObjectTagging for a key that does not exist", "GET", `${B}/missing`, tags, 404, NO_KEY],
    ["DeleteObjectTagging for a key that does not exist", "DELETE", `${B}/missing`, tags, 404, NO_KEY],
    ["GetObjectTagging in a bucket that does not exist", "GET", "/no-such-bucket/object", tags, 404, NO_BUCKET],
    ["GetObjectAcl for a key that does not exist", "GET", `${B}/missing`, acl, 404, NO_KEY],
    ["an upload with the same tag key two times", "PUT", `${B}/new`, header("a=1&a=2"), 400, invalidHeader("a=1&a=2")],
    ["an upload with a tag that has no key", "PUT", `${B}/new`, header("=1"), 400, invalidHeader("=1")],
    ["an upload with a tag that is not UTF-8", "PUT", `${B}/new`, header("a=%FF"), 400, invalidHeader("a=%FF")],
    ["an upload with 11 tags", "PUT", `${B}/new`, header(eleven.map(([key]) => `${key}=`).join("&")), 400, { Code: "BadRequest" }],
    ["an upload with a tag key that is not valid", "PUT", `${B}/new`, header("a,b=1"), 400, invalidKey("a,b")],
    ["an upload with the tag key aws:cost", "PUT", `${B}/new`, header("aws:cost=1"), 400, { Code: "InvalidTag", TagKey: "aws:cost" }],
  ]);
});
