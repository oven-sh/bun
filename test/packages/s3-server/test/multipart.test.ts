import { describe, expect, test } from "bun:test";
import { isDebug } from "harness";
import { createHash } from "node:crypto";
import { DEFAULT_OWNER } from "../index.ts";
import { parseXml, start, toObject, type TestServer } from "./helpers.ts";

const MiB = 1024 * 1024;
/** Parts of the smallest size that S3 takes for a part that is not the last one. */
const BIG = Buffer.alloc(5 * MiB, "A");
const SECOND = Buffer.alloc(5 * MiB, "B");
const OWNER = { ID: DEFAULT_OWNER.id, DisplayName: DEFAULT_OWNER.displayName };
const SSE = "x-amz-server-side-encryption";
const TYPE = "x-amz-checksum-type";
/** The time of the fake clock, some seconds after its start. */
const at = (seconds: number) => new Date(Date.UTC(2026, 2, 4, 5, 6, seconds));

const MESSAGES: Record<string, string> = {
  InvalidPart:
    "One or more of the specified parts could not be found.  The part may not have been uploaded, or the specified entity tag may not match the part's entity tag.",
  InvalidPartOrder: "The list of parts was not in ascending order. Parts must be ordered by part number.",
  EntityTooSmall: "Your proposed upload is smaller than the minimum allowed size",
  MalformedXML: "The XML you provided was not well-formed or did not validate against our published schema",
  NoSuchUpload:
    "The specified upload does not exist. The upload ID may be invalid, or the upload may have been aborted or completed.",
  InvalidPartNumber: "The requested partnumber is not satisfiable",
  BadDigest: "The SHA256 you specified did not match the calculated checksum.",
  partNumber: "Part number must be an integer between 1 and 10000, inclusive",
  range:
    "The x-amz-copy-source-range value must be of the form bytes=first-last where first and last are the zero-based offsets of the first and last bytes to copy",
  size: "Range specified is not valid for source object of size: 10",
  objectSize: "The provided 'x-amz-mp-object-size' header does not match what was computed",
  type: "The x-amz-checksum-type header can only be used with the x-amz-checksum-algorithm header.",
  algorithm:
    "Checksum algorithm provided is unsupported. Please try again with any of the valid types: [CRC32, CRC32C, CRC64NVME, SHA1, SHA256]",
  other: "Checksum Type mismatch occurred, expected checksum Type: sha256, actual checksum Type: crc32",
  missing:
    "The upload was created using a sha256 checksum. The complete request must include the checksum for each part. It was missing for part 1 in the request.",
  mode: "The upload was created using the COMPOSITE checksum mode. The complete request must use the same checksum mode.",
};

type Body = string | Uint8Array;
type Fields = Record<string, string>;
type Part = [partNumber: number | string, etag: string, extra?: string];
type Answer = Record<string, any>;

const md5 = (data: Body) => createHash("md5").update(data).digest("hex");
const sha256 = (data: Body) => createHash("sha256").update(data).digest();
const same = (actual: Uint8Array, ...expected: Body[]) =>
  Buffer.from(actual).equals(Buffer.concat(expected.map(item => Buffer.from(item))));
const list = (value: Answer | Answer[] | undefined): Answer[] => (Array.isArray(value) ? value : value ? [value] : []);

/** The entity tag of a multipart object: the MD5 of the binary MD5 digests of the parts, then the number of parts. */
function multipartETag(...parts: Body[]): string {
  const digests = parts.map(part => createHash("md5").update(part).digest());
  return `"${md5(Buffer.concat(digests))}-${parts.length}"`;
}

function values(response: Response, ...headers: string[]): unknown[] {
  return [response.status, ...headers.map(name => response.headers.get(name))];
}

/** The status and the XML document of a response. */
async function answer(response: Response): Promise<Answer> {
  if (response.headers.get("content-type") !== "application/xml") return { status: response.status };
  const root = parseXml(await response.text());
  const { RequestId, HostId, ...document } = toObject(root);
  if (root.name === "Error") {
    expect([RequestId, HostId]).toEqual(values(response, "x-amz-request-id", "x-amz-id-2").slice(1));
  }
  return { status: response.status, root: root.name, ...document };
}

/** What `answer` gives for an error. `MESSAGES` has the messages of the errors of multipart uploads. */
function error(status: number, code: string, fields: Fields = {}): Answer {
  return { status, root: "Error", Code: code, Message: MESSAGES[code] ?? expect.any(String), ...fields };
}
const invalidArgument = (message: string, name: string, value: string) =>
  error(400, "InvalidArgument", { Message: message, ArgumentName: name, ArgumentValue: value });
const invalidRequest = (message: string) => error(400, "InvalidRequest", { Message: message });

/** What `answer` gives for CompleteMultipartUpload. S3 encodes each `/` of the key in the location. */
function result(t: TestServer, key: string, etag: string, checksum: Fields = {}): Answer {
  const Location = `${t.server.url}/${t.bucket}/${encodeURIComponent(key)}`;
  const document = { Location, Bucket: t.bucket, Key: key, ETag: etag, ...checksum };
  return { status: 200, root: "CompleteMultipartUploadResult", ...document };
}

function completeDocument(parts: Part[]): string {
  const items = parts.map(
    ([number, etag, extra = ""]) => `<Part><PartNumber>${number}</PartNumber><ETag>${etag}</ETag>${extra}</Part>`,
  );
  return `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${items.join("")}</CompleteMultipartUpload>`;
}

function uploads(t: TestServer, key: string, bucket = t.bucket) {
  const path = `/${bucket}/${key}`;
  const { client } = t;
  const numbered = (partNumber: number | string, uploadId: string) => ({ partNumber: `${partNumber}`, uploadId });
  const self = {
    start: (headers?: Fields) => client.fetch("POST", path, { query: { uploads: "" }, headers }),
    create: async (headers?: Fields): Promise<string> => (await answer(await self.start(headers))).UploadId,
    part: (uploadId: string, partNumber: number | string, body: Body, headers?: Fields) =>
      client.fetch("PUT", path, { query: numbered(partNumber, uploadId), body, headers, payload: "unsigned" }),
    copy: (uploadId: string, partNumber: number | string, source: string, range?: string) => {
      const headers = { "x-amz-copy-source": source, ...(range ? { "x-amz-copy-source-range": range } : {}) };
      return client.fetch("PUT", path, { query: numbered(partNumber, uploadId), headers });
    },
    prepare: async (parts: Record<number, Body>, headers?: Fields): Promise<string> => {
      const uploadId = await self.create(headers);
      for (const number in parts) expect((await self.part(uploadId, number, parts[number])).status).toBe(200);
      return uploadId;
    },
    complete: (uploadId: string, parts: Part[] | string, headers?: Fields) => {
      const body = Array.isArray(parts) ? completeDocument(parts) : parts;
      return client.fetch("POST", path, { query: { uploadId }, body, headers });
    },
    abort: (uploadId: string) => client.fetch("DELETE", path, { query: { uploadId } }),
    parts: (uploadId: string, query: Fields = {}) => client.fetch("GET", path, { query: { uploadId, ...query } }),
    get: (query?: Fields, headers?: Fields, method = "GET") => client.fetch(method, path, { query, headers }),
    put: (body: Body) => client.fetch("PUT", path, { body, payload: "unsigned" }),
  };
  return self;
}

const listUploads = (t: TestServer, query: Fields = {}, bucket = t.bucket) =>
  t.client.fetch("GET", `/${bucket}`, { query: { uploads: "", ...query } });
const checksumHeaders = (algorithm: string, type: string): Fields => ({
  ...(algorithm ? { "x-amz-checksum-algorithm": algorithm } : {}),
  ...(type ? { [TYPE]: type } : {}),
});
const one: Part = [1, md5("one")];

describe("multipart upload", () => {
  test("Bun.S3Client writes an object in parts", async () => {
    await using t = start();
    const file = t.s3.file("folder/big file.bin");
    const writer = file.writer({ partSize: 5 * MiB, queueSize: 2, type: "application/x-test" });
    writer.write(BIG);
    writer.write(SECOND);
    writer.write("tail");
    await writer.end();

    const operations = t.server.requests.map(request => `${request.status} ${request.operation}`).sort();
    const parts = ["200 UploadPart", "200 UploadPart", "200 UploadPart"];
    expect(operations).toEqual(["200 CompleteMultipartUpload", "200 CreateMultipartUpload", ...parts]);
    const { size, etag, type } = await file.stat();
    const expected = { size: 10 * MiB + 4, etag: multipartETag(BIG, SECOND, "tail"), type: "application/x-test" };
    expect({ size, etag, type }).toEqual(expected);
    expect(same(await file.bytes(), BIG, SECOND, "tail")).toBe(true);
    expect(await file.slice(5 * MiB - 2, 5 * MiB + 2).text()).toBe("AABB");
    expect(t.server.buckets.get(t.bucket)!.uploads.size).toBe(0);
  });

  test("the object has the metadata of CreateMultipartUpload and the parts of CompleteMultipartUpload", async () => {
    let now = at(0);
    await using t = start({ clock: () => now });
    const key = "folder/a key.txt";
    const upload = uploads(t, key);
    const content = { "content-type": "text/x-test", "content-encoding": "identity", "cache-control": "max-age=60" };
    const disposition = { "content-disposition": 'attachment; filename="a.txt"' };
    const metadata = { ...content, ...disposition, "x-amz-meta-color": "blue", "x-amz-storage-class": "STANDARD_IA" };

    const started = await upload.start({ ...metadata, "x-amz-tagging": "a=1&b=2", "x-amz-acl": "public-read" });
    expect(values(started, SSE, "x-amz-checksum-algorithm")).toEqual([200, "AES256", null]);
    const { UploadId: uploadId, ...initiated } = await answer(started);
    expect(initiated).toEqual({ status: 200, root: "InitiateMultipartUploadResult", Bucket: t.bucket, Key: key });

    now = at(60);
    const sent: Record<number, Body> = { 1: BIG, 5: SECOND, 7: "not in the list", 9: "an earlier part 9" };
    for (const number in sent) {
      const response = await upload.part(uploadId, number, sent[number]);
      expect(values(response, "etag", "content-length", SSE)).toEqual([200, `"${md5(sent[number])}"`, "0", "AES256"]);
    }
    // A part that is sent again replaces the earlier one.
    expect((await upload.part(uploadId, 9, "tail")).status).toBe(200);
    const listed = list((await answer(await upload.parts(uploadId))).Part);
    expect(listed.map(part => [part.PartNumber, part.ETag])).toEqual(
      Object.entries({ ...sent, 9: "tail" }).map(([number, content]) => [number, `"${md5(content)}"`]),
    );

    now = at(120);
    // S3 takes an entity tag with quotes and without quotes. The object gets the parts of the list only.
    const etags = [`"${md5(BIG)}"`, md5(SECOND), `&quot;${md5("tail")}&quot;`];
    const parts = etags.map((etag, index): Part => [[1, 5, 9][index], etag]);
    const completed = await upload.complete(uploadId, parts);
    expect(values(completed, SSE, "x-amz-version-id")).toEqual([200, "AES256", null]);
    const etag = multipartETag(BIG, SECOND, "tail");
    expect(await answer(completed)).toEqual(result(t, key, etag));

    const size = 10 * MiB + 4;
    const object = await upload.get();
    // The time of the object is the time when the upload started.
    const stored = { etag, "last-modified": at(0).toUTCString(), "content-length": `${size}` };
    const properties = { ...metadata, ...stored, "x-amz-tagging-count": "2" };
    expect(values(object, ...Object.keys(properties))).toEqual([200, ...Object.values(properties)]);
    expect(same(await object.bytes(), BIG, SECOND, "tail")).toBe(true);
    const tags = ["a", "b"].map((name, index) => ({ Key: name, Value: `${index + 1}` }));
    expect((await answer(await upload.get({ tagging: "" }))).TagSet.Tag).toEqual(tags);
    const everyone = { URI: "http://acs.amazonaws.com/groups/global/AllUsers" };
    expect((await answer(await upload.get({ acl: "" }))).AccessControlList.Grant).toEqual(
      [OWNER, everyone].map((Grantee, index) => ({ Grantee, Permission: ["FULL_CONTROL", "READ"][index] })),
    );

    // The object has the parts 1, 2 and 3. A request reads one of them, or a range with bytes of two of them.
    const across = `${10 * MiB - 2}-${10 * MiB + 1}`;
    const reads: [query: Fields, headers: Fields, range: string, count: string | null, content: Body][] = [
      [{ partNumber: "2" }, {}, `${5 * MiB}-${10 * MiB - 1}`, "3", SECOND],
      [{ partNumber: "3" }, {}, `${10 * MiB}-${size - 1}`, "3", "tail"],
      [{}, { range: `bytes=${across}` }, across, null, "BBta"],
    ];
    for (const [query, headers, range, count, content] of reads) {
      for (const method of ["GET", "HEAD"]) {
        const response = await upload.get(query, headers, method);
        const expected = [206, `bytes ${range}/${size}`, `${content.length}`, count, etag];
        expect(values(response, "content-range", "content-length", "x-amz-mp-parts-count", "etag")).toEqual(expected);
        expect(same(await response.bytes(), method === "GET" ? content : "")).toBe(true);
      }
    }
    const above = { PartNumberRequested: "4", ActualPartCount: "3" };
    expect(await answer(await upload.get({ partNumber: "4" }))).toEqual(error(416, "InvalidPartNumber", above));
    expect(await answer(await upload.get({ partNumber: "4" }, {}, "HEAD"))).toEqual({ status: 416 });
  });

  const invalidPart = (partNumber: string, etag: string) => ({ UploadId: "", PartNumber: partNumber, ETag: etag });
  const part = (content: string, root = "CompleteMultipartUpload") => `<${root}><Part>${content}</Part></${root}>`;
  const tooSmall = { ProposedSize: "3", MinSizeAllowed: `${5 * MiB}`, PartNumber: "1", ETag: md5("one") };
  const zero = { Message: "PartNumber must be >= 1", ArgumentName: "PartNumber", ArgumentValue: "0" };

  test.each<[name: string, body: Part[] | string, code: string, details: Fields]>([
    ["a part number that was not sent", [[4, md5("one")]], "InvalidPart", invalidPart("4", md5("one"))],
    ["a part number above 10000", [[10001, md5("one")]], "InvalidPart", invalidPart("10001", md5("one"))],
    ["the entity tag of another part", [[1, `"${md5("two")}"`]], "InvalidPart", invalidPart("1", md5("two"))],
    ["an empty entity tag", [[1, ""]], "InvalidPart", invalidPart("1", "")],
    ["part numbers that descend", [[2, md5("two")], one], "InvalidPartOrder", { UploadId: "" }],
    ["the same part twice", [one, one], "InvalidPartOrder", { UploadId: "" }],
    ["a part below 5 MiB that is not the last one", [one, [3, md5("three")]], "EntityTooSmall", tooSmall],
    ["the part number 0", [[0, md5("one")]], "InvalidArgument", zero],
    ["a request without a document", "", "MalformedXML", {}],
    ["a document that is not XML", "PartNumber=1", "MalformedXML", {}],
    ["another root element", part(`<PartNumber>1</PartNumber><ETag>x</ETag>`, "Parts"), "MalformedXML", {}],
    ["an empty list of parts", completeDocument([]), "MalformedXML", {}],
    ["a part without PartNumber", part(`<ETag>${md5("one")}</ETag>`), "MalformedXML", {}],
    ["a part without ETag", part("<PartNumber>1</PartNumber>"), "MalformedXML", {}],
    ["a part number that is not a number", [["one", md5("one")]], "MalformedXML", {}],
  ])("CompleteMultipartUpload refuses %s", async (_, body, code, details) => {
    await using t = start();
    const upload = uploads(t, "key");
    const uploadId = await upload.prepare({ 1: "one", 2: "two", 3: "three" });
    if ("UploadId" in details) details = { ...details, UploadId: uploadId };

    expect(await answer(await upload.complete(uploadId, body))).toEqual(error(400, code, details));
    // The upload is in progress as before.
    expect(list((await answer(await upload.parts(uploadId))).Part).length).toBe(3);
    expect((await upload.get()).status).toBe(404);
  });

  const prepared = (key: string, end?: "complete" | "abort") => async (t: TestServer) => {
    const uploadId = await uploads(t, key).prepare({ 1: "one" });
    if (end === "abort") expect((await uploads(t, key).abort(uploadId)).status).toBe(204);
    if (end === "complete") expect((await uploads(t, key).complete(uploadId, [one])).status).toBe(200);
    return uploadId;
  };
  const unknown = async () => "0".repeat(64);

  test.each<[name: string, bucket: string, prepare: (t: TestServer) => Promise<string>, code: string, again: number]>([
    ["an upload ID that does not exist", "test-bucket", unknown, "NoSuchUpload", 404],
    ["the ID of an upload for another key", "test-bucket", prepared("another"), "NoSuchUpload", 404],
    ["an upload that AbortMultipartUpload ended", "test-bucket", prepared("key", "abort"), "NoSuchUpload", 404],
    // S3 answers the request that completed an upload again.
    ["an upload that is complete", "test-bucket", prepared("key", "complete"), "NoSuchUpload", 200],
    ["a bucket that does not exist", "no-such-bucket", unknown, "NoSuchBucket", 404],
  ])("each operation has the error for %s", async (_, bucket, prepare, code, again) => {
    await using t = start();
    await t.s3.write("source", "0123456789");
    const upload = uploads(t, "key", bucket);
    const uploadId = await prepare(t);
    const expected = error(404, code, code === "NoSuchUpload" ? { UploadId: uploadId } : { BucketName: bucket });

    expect(await answer(await upload.part(uploadId, 1, "one"))).toEqual(expected);
    expect(await answer(await upload.copy(uploadId, 1, `${t.bucket}/source`))).toEqual(expected);
    expect(await answer(await upload.parts(uploadId))).toEqual(expected);
    expect((await upload.complete(uploadId, [one])).status).toBe(again);
    expect(await answer(await upload.abort(uploadId))).toEqual(expected);
    if (code === "NoSuchUpload") return;
    expect(await answer(await upload.start())).toEqual(expected);
    expect(await answer(await listUploads(t, {}, bucket))).toEqual(expected);
  });

  test("CompleteMultipartUpload answers again for the same list of parts, while the object is there", async () => {
    await using t = start();
    const upload = uploads(t, "key");
    const uploadId = await upload.prepare({ 1: "", 2: "two" });
    // One part only can have each size.
    const first = await answer(await upload.complete(uploadId, [[1, md5("")]]));
    expect(first).toEqual(result(t, "key", multipartETag("")));
    expect(await t.s3.file("key").text()).toBe("");

    // The condition was true for the first request.
    const again = await upload.complete(uploadId, [[1, `"${md5("")}"`]], { "if-none-match": "*" });
    expect(await answer(again)).toEqual(first);
    const gone = error(404, "NoSuchUpload", { UploadId: uploadId });
    expect(await answer(await upload.complete(uploadId, [[2, md5("two")]]))).toEqual(gone);
    await t.s3.write("key", "another object");
    expect(await answer(await upload.complete(uploadId, [[1, md5("")]]))).toEqual(gone);
  });

  test.each(["0", "10001", "-1", "1.5", "one", ""])("the part number %p is not valid", async partNumber => {
    await using t = start();
    await t.s3.write("source", "0123456789");
    const upload = uploads(t, "key");
    const uploadId = await upload.create();
    const expected = invalidArgument(MESSAGES.partNumber, "partNumber", partNumber);
    expect(await answer(await upload.part(uploadId, partNumber, "one"))).toEqual(expected);
    expect(await answer(await upload.copy(uploadId, partNumber, `${t.bucket}/source`))).toEqual(expected);
  });

  test("ListParts lists the parts in ascending order and in pages", async () => {
    let now = at(0);
    await using t = start({ clock: () => now });
    const upload = uploads(t, "folder/key");
    const uploadId = await upload.create({ "x-amz-storage-class": "ONEZONE_IA" });
    const names = { root: "ListPartsResult", Bucket: t.bucket, Key: "folder/key", UploadId: uploadId };
    const owners = { Initiator: OWNER, Owner: OWNER, StorageClass: "ONEZONE_IA" };
    const result = { status: 200, ...names, ...owners, PartNumberMarker: "0", MaxParts: "1000", IsTruncated: "false" };
    expect(await answer(await upload.parts(uploadId))).toEqual({ ...result, NextPartNumberMarker: "0" });

    const content = (number: number) => Buffer.alloc(number, "x");
    for (const number of [8, 1, 5, 3, 2]) {
      now = at(number);
      expect((await upload.part(uploadId, number, content(number))).status).toBe(200);
    }
    const Part = [1, 2, 3, 5, 8].map(number => ({
      PartNumber: `${number}`,
      LastModified: at(number).toISOString(),
      ETag: `"${md5(content(number))}"`,
      Size: `${number}`,
    }));
    const all = { ...result, NextPartNumberMarker: "8", Part };
    expect(await answer(await upload.parts(uploadId, { "max-parts": "5000" }))).toEqual(all);

    const pages: string[] = [];
    for (const [marker, maximum] of Object.entries({ 0: "2", 2: "2", 5: "2", 8: "2", 3: "0" })) {
      const page = await answer(await upload.parts(uploadId, { "max-parts": maximum, "part-number-marker": marker }));
      const numbers = list(page.Part).map(item => item.PartNumber);
      pages.push(`${page.PartNumberMarker}: ${numbers} next ${page.NextPartNumberMarker} ${page.IsTruncated}`);
      expect(page.MaxParts).toBe(maximum);
    }
    const zero = "3:  next 3 false";
    expect(pages).toEqual(["0: 1,2 next 2 true", "2: 3,5 next 5 true", zero, "5: 8 next 8 false", "8:  next 8 false"]);
  });

  test("ListMultipartUploads lists by key and then by the time of the start", async () => {
    let now = at(0);
    await using t = start({ clock: () => now });
    const next = (key: string, uploadId: string) => ({ NextKeyMarker: key, NextUploadIdMarker: uploadId });
    const markers = { KeyMarker: "", UploadIdMarker: "", ...next("", ""), Prefix: "" };
    const limits = { MaxUploads: "1000", IsTruncated: "false" };
    const result = { status: 200, root: "ListMultipartUploadsResult", Bucket: t.bucket, ...markers, ...limits };
    expect(await answer(await listUploads(t))).toEqual(result);

    const keys = ["b", "c d", "a/2", "b", "a/1"];
    const ids: string[] = [];
    for (const key of keys) {
      now = at(ids.length);
      ids.push(await uploads(t, key).create());
    }
    const [b1, cd, a2, b2, a1] = ids;
    const all = [a1, a2, b1, b2, cd];
    const entry = (uploadId: string, encoded: boolean) => ({
      Key: encoded ? keys[ids.indexOf(uploadId)].replace(" ", "+") : keys[ids.indexOf(uploadId)],
      UploadId: uploadId,
      Initiator: OWNER,
      Owner: OWNER,
      StorageClass: "STANDARD",
      Initiated: at(ids.indexOf(uploadId)).toISOString(),
    });
    const last = next("c d", cd);
    const one = { MaxUploads: "1", IsTruncated: "true", Delimiter: "/" };
    const url = { EncodingType: "url" };

    // The uploads and the common prefixes of the answer, and the fields that are not as in `result`.
    const cases: [query: Fields, uploads: string[], prefixes: string[], fields: Fields][] = [
      [{}, all, [], last],
      [{ prefix: "a/" }, [a1, a2], [], { Prefix: "a/", ...next("a/2", a2) }],
      [{ delimiter: "/" }, [b1, b2, cd], ["a/"], { Delimiter: "/", ...last }],
      [{ "max-uploads": "3" }, [a1, a2, b1], [], { MaxUploads: "3", IsTruncated: "true", ...next("b", b1) }],
      [{ "key-marker": "b", "upload-id-marker": b1 }, [b2, cd], [], { KeyMarker: "b", UploadIdMarker: b1, ...last }],
      [{ "key-marker": "b" }, [cd], [], { KeyMarker: "b", ...last }],
      // S3 ignores an upload ID marker that has no key marker.
      [{ "upload-id-marker": b1 }, all, [], last],
      [{ "max-uploads": "5000" }, all, [], last],
      [{ "max-uploads": "0" }, [], [], { MaxUploads: "0" }],
      [{ delimiter: "/", "max-uploads": "1" }, [], ["a/"], { ...one, ...next("a/", "") }],
      [
        { delimiter: "/", "max-uploads": "1", "key-marker": "a/" },
        [b1],
        [],
        { ...one, KeyMarker: "a/", ...next("b", b1) },
      ],
      [{ "encoding-type": "url", "key-marker": "b *" }, [cd], [], { ...url, KeyMarker: "b+*", ...next("c+d", cd) }],
      [
        { "encoding-type": "url", prefix: "c ", delimiter: "d" },
        [],
        ["c+d"],
        { ...url, Prefix: "c+", Delimiter: "d", ...next("c+d", "") },
      ],
    ];
    for (const [query, uploadIds, prefixes, fields] of cases) {
      const { Upload, CommonPrefixes, ...rest } = await answer(await listUploads(t, query));
      expect({ query, uploads: list(Upload), prefixes: list(CommonPrefixes).map(item => item.Prefix), rest }).toEqual({
        query,
        uploads: uploadIds.map(uploadId => entry(uploadId, "encoding-type" in query)),
        prefixes,
        rest: { ...result, ...fields },
      });
    }
  });

  const between = (name: string) => `Argument ${name} must be an integer between 0 and 2147483647`;
  test.each<[name: string, value: string, message: string]>([
    ["max-parts", "-1", between("max-parts")],
    ["max-parts", "two", between("max-parts")],
    ["part-number-marker", "x", between("part-number-marker")],
    ["max-uploads", "-1", between("max-uploads")],
    ["encoding-type", "base64", "Invalid Encoding Method specified in Request"],
  ])("the list parameter %s=%s is not valid", async (name, value, message) => {
    await using t = start();
    const upload = uploads(t, "key");
    const query = { [name]: value };
    const response = name.includes("part") ? upload.parts(await upload.create(), query) : listUploads(t, query);
    expect(await answer(await response)).toEqual(invalidArgument(message, name, value));
  });

  test("UploadPartCopy makes a part from an object, from a range and from a version", async () => {
    let now = at(0);
    await using t = start({ clock: () => now });
    t.server.createBucket({ name: "versioned", versioning: "Enabled" });
    const source = Buffer.concat([BIG, Buffer.from("0123456789")]);
    expect((await uploads(t, "folder/the source").put(source)).status).toBe(200);
    const versions: string[] = [];
    for (const content of ["first", "second"]) {
      versions.push((await uploads(t, "source", "versioned").put(content)).headers.get("x-amz-version-id")!);
    }
    const upload = uploads(t, "key");
    const uploadId = await upload.create();

    now = at(30);
    const copies: [partNumber: number, source: string, range: string, content: Body, version?: string][] = [
      [1, `/${t.bucket}/folder/the%20source`, `bytes=0-${5 * MiB - 1}`, BIG],
      [2, `${t.bucket}/folder/the%20source`, "", source],
      [4, `${t.bucket}/folder%2Fthe+source`, `bytes=${5 * MiB + 2}-${5 * MiB + 5}`, "2345"],
      [5, `versioned/source?versionId=${versions[0]}`, "", "first", versions[0]],
      [6, "versioned/source", "bytes=1-2", "ec", versions[1]],
    ];
    for (const [partNumber, from, range, content, version = null] of copies) {
      const response = await upload.copy(uploadId, partNumber, from, range);
      expect(values(response, "x-amz-copy-source-version-id", SSE)).toEqual([200, version, "AES256"]);
      const copied = { LastModified: at(30).toISOString(), ETag: `"${md5(content)}"` };
      expect(await answer(response)).toEqual({ status: 200, root: "CopyPartResult", ...copied });
    }
    expect((await upload.part(uploadId, 3, SECOND)).status).toBe(200);

    const contents = [BIG, source, SECOND, "2345"];
    const parts = contents.map((content, index): Part => [index + 1, md5(content)]);
    expect(await answer(await upload.complete(uploadId, parts))).toEqual(result(t, "key", multipartETag(...contents)));
    expect(same(await (await upload.get()).bytes(), ...contents)).toBe(true);
  });

  const range = (message: string) => (value: string) => invalidArgument(message, "x-amz-copy-source-range", value);
  const noVersion = "0".repeat(32);
  test.each<[source: string, range: string, expected: (range: string) => Answer]>([
    ...["0-2", "bytes=0", "bytes=-2", "bytes=a-z", "bytes=0-z", "bytes=a-", "bytes=0-2,3-5"].map(
      (value): [string, string, (range: string) => Answer] => ["test-bucket/source", value, range(MESSAGES.range)],
    ),
    ["test-bucket/source", "bytes=0-10", range(MESSAGES.size)],
    ["test-bucket/source", "bytes=10-12", range(MESSAGES.size)],
    ["test-bucket/source", "bytes=5-2", range(MESSAGES.size)],
    ["test-bucket/missing", "", () => error(404, "NoSuchKey", { Key: "missing" })],
    ["test-bucket/missing", "bytes=0-2", () => error(404, "NoSuchKey", { Key: "missing" })],
    ["no-such-bucket/source", "", () => error(404, "NoSuchBucket", { BucketName: "no-such-bucket" })],
    [
      `test-bucket/source?versionId=${noVersion}`,
      "",
      () => error(404, "NoSuchVersion", { Key: "source", VersionId: noVersion }),
    ],
  ])("UploadPartCopy from %p with the range %p is an error", async (source, value, expected) => {
    await using t = start();
    await t.s3.write("source", "0123456789");
    const upload = uploads(t, "key");
    const uploadId = await upload.create();
    expect(await answer(await upload.copy(uploadId, 1, source, value))).toEqual(expected(value));
    expect((await answer(await upload.parts(uploadId))).Part).toBeUndefined();
  });

  const withType = (type: string, algorithm: string) =>
    `The ${type} checksum type cannot be used with the ${algorithm} checksum algorithm.`;
  test.each<[algorithm: string, type: string, message: string]>([
    ["SHA1", "FULL_OBJECT", withType("FULL_OBJECT", "sha1")],
    ["SHA256", "FULL_OBJECT", withType("FULL_OBJECT", "sha256")],
    ["CRC64NVME", "COMPOSITE", withType("COMPOSITE", "crc64nvme")],
    ["", "COMPOSITE", MESSAGES.type],
    ["", "FULL_OBJECT", MESSAGES.type],
    ["CRC32", "PARTS", "Value for x-amz-checksum-type header is invalid."],
    ["MD4", "", MESSAGES.algorithm],
  ])("CreateMultipartUpload refuses the checksum algorithm %p with the type %p", async (algorithm, type, message) => {
    await using t = start();
    const response = await uploads(t, "key").start(checksumHeaders(algorithm, type));
    expect(await answer(response)).toEqual(invalidRequest(message));
    expect(t.server.buckets.get(t.bucket)!.uploads.size).toBe(0);
  });

  // The checksums of 5 MiB of "A" are from the s3-tests suite.
  const sha1 = ["iIaTCGbm+vdVjNqIMF2S0T7ibMk=", "+/XyoodbO7Zbjjsj5swB1YyjBEc="];
  const sha256s = ["275VF5loJr1YYawit0XSHREhkFXYkkPKGuoK0x9VKxI=", "DGL4du8d6oMN6fMsL0tG3W101Q0ViW4J71ovzUrH4dc="];
  // Bun has no function for CRC32C and CRC64NVME. The server computes them in
  // JavaScript, and a debug build of Bun runs that too slowly for 5 MiB.
  const inJavaScript = (algorithm: string) => algorithm === "CRC32C" || algorithm === "CRC64NVME";
  describe.each<[algorithm: string, requested: string, type: string, parts: string[], object: string]>([
    ["CRC32", "", "COMPOSITE", ["JRTCyQ==", "fDe0XQ=="], "ar6UVw==-2"],
    ["CRC32", "FULL_OBJECT", "FULL_OBJECT", ["JRTCyQ==", "fDe0XQ=="], "gPNU7Q=="],
    ["CRC32C", "COMPOSITE", "COMPOSITE", ["MDaLrw==", "B21LrQ=="], "9nmlxg==-2"],
    ["CRC32C", "FULL_OBJECT", "FULL_OBJECT", ["MDaLrw==", "B21LrQ=="], "LZbOwA=="],
    ["CRC64NVME", "", "FULL_OBJECT", ["L/E4WYn8v98=", "sAra2CkCEgw="], "UpfGsWmSCEg="],
    ["SHA1", "", "COMPOSITE", sha1, "l89BPfYtRdlTXZSsCsWMB0Elnjg=-2"],
    ["SHA256", "", "COMPOSITE", sha256s, "2kYaKgwMh4G97NB7sxufv13cvQqUqNgjK75WsW6s16Q=-2"],
  ])("%s with the type %p", (algorithm, requested, type, checksums, checksum) => {
    test.skipIf(isDebug && inJavaScript(algorithm))(`gives a ${type} checksum`, () => check());

    async function check() {
      await using t = start();
      const upload = uploads(t, "key");
      const header = `x-amz-checksum-${algorithm.toLowerCase()}`;
      const element = `Checksum${algorithm}`;
      const chosen = { ChecksumAlgorithm: algorithm, ChecksumType: type };
      const contents = [BIG, "tail"];

      const started = await upload.start(checksumHeaders(algorithm, requested));
      expect(values(started, "x-amz-checksum-algorithm", TYPE)).toEqual([200, algorithm, type]);
      const uploadId: string = (await answer(started)).UploadId;
      // The server checks the checksum of the first part. It computes the checksum of the second part.
      for (const [index, content] of contents.entries()) {
        const response = await upload.part(uploadId, index + 1, content, index ? {} : { [header]: checksums[0] });
        expect(values(response, "etag", header)).toEqual([200, `"${md5(content)}"`, checksums[index]]);
      }
      const listed = contents.map((content, index) => ({ Size: `${content.length}`, [element]: checksums[index] }));
      expect(await answer(await upload.parts(uploadId))).toMatchObject({ ...chosen, Part: listed });
      expect((await answer(await listUploads(t))).Upload).toMatchObject(chosen);

      const parts = contents.map((content, index): Part => {
        return [index + 1, md5(content), `<${element}>${checksums[index]}</${element}>`];
      });
      const completed = await upload.complete(uploadId, parts, { [header]: checksum, [TYPE]: type });
      const checksumOf = { [element]: checksum, ChecksumType: type };
      expect(await answer(completed)).toEqual(result(t, "key", multipartETag(...contents), checksumOf));

      const mode = { "x-amz-checksum-mode": "ENABLED" };
      expect(values(await upload.get({}, {}, "HEAD"), header, TYPE)).toEqual([200, null, null]);
      expect(values(await upload.get({}, mode, "HEAD"), header, TYPE)).toEqual([200, checksum, type]);
      expect(values(await upload.get({ partNumber: "2" }, mode), header, TYPE)).toEqual([206, checksums[1], type]);
      const attributes = { "x-amz-object-attributes": "Checksum,ObjectParts" };
      expect(await answer(await upload.get({ attributes: "" }, attributes))).toMatchObject({
        Checksum: checksumOf,
        ObjectParts: { PartsCount: "2", Part: listed.map((item, index) => ({ PartNumber: `${index + 1}`, ...item })) },
      });
    }
  });

  test("an upload with a checksum algorithm checks the checksums of the parts and of the object", async () => {
    await using t = start();
    const upload = uploads(t, "key");
    const uploadId = await upload.create({ "x-amz-checksum-algorithm": "SHA256" });
    const header = (data: Body) => ({ "x-amz-checksum-sha256": sha256(data).toString("base64") });
    const element = (data: Body) => `<ChecksumSHA256>${sha256(data).toString("base64")}</ChecksumSHA256>`;
    const crc32 = "emyG8Q==";
    const other = invalidRequest(MESSAGES.other);
    const badDigest = error(400, "BadDigest");
    const badPart = error(400, "InvalidPart", { UploadId: uploadId, PartNumber: "1", ETag: md5("one") });
    const badOrder = error(400, "InvalidPartOrder", { UploadId: uploadId });

    expect(await answer(await upload.part(uploadId, 1, "one", header("two")))).toEqual(badDigest);
    // The checksum is correct. Its algorithm is not the one of the upload.
    expect(await answer(await upload.part(uploadId, 1, "one", { "x-amz-checksum-crc32": crc32 }))).toEqual(other);
    for (const [index, content] of ["one", "two", "three"].entries()) {
      expect((await upload.part(uploadId, index + 1, content, header(content))).status).toBe(200);
    }
    // The checksum of a part can come after the content, in a trailing header.
    const query = { partNumber: "3", uploadId };
    const trailing = (trailers: Fields) =>
      t.client.fetch("PUT", "/test-bucket/key", {
        query,
        body: "three",
        payload: "streaming-unsigned-trailer",
        trailers,
      });
    expect(await answer(await trailing({ "x-amz-checksum-crc32": "RsXY9Q==" }))).toEqual(other);
    expect(values(await trailing(header("three")), "x-amz-checksum-sha256")).toEqual([
      200,
      ...Object.values(header("three")),
    ]);

    const first: Part = [1, md5("one"), element("one")];
    const refused: [parts: Part[], headers: Fields, expected: Answer][] = [
      [[[1, md5("one"), element("two")]], {}, badPart],
      [[[1, md5("one"), `<ChecksumCRC32>${crc32}</ChecksumCRC32>`]], {}, badPart],
      [[one], {}, invalidRequest(MESSAGES.missing)],
      // With a checksum algorithm, the part numbers start at 1 and have no gaps.
      [[first, [3, md5("three"), element("three")]], {}, badOrder],
      [[[2, md5("two"), element("two")]], {}, badOrder],
      [[first], header("one"), badDigest],
      [[first], { "x-amz-checksum-sha256": "bad" }, badDigest],
      [[first], { [TYPE]: "FULL_OBJECT" }, error(400, "BadDigest", { Message: MESSAGES.mode })],
      [[first], { "x-amz-checksum-crc32": crc32 }, other],
    ];
    for (const [parts, headers, expected] of refused) {
      expect(await answer(await upload.complete(uploadId, parts, headers))).toEqual(expected);
    }
    const composite = `${sha256(sha256("one")).toString("base64")}-1`;
    const completed = await upload.complete(uploadId, [first], {
      "x-amz-checksum-sha256": composite,
      [TYPE]: "COMPOSITE",
    });
    const checksum = { ChecksumSHA256: composite, ChecksumType: "COMPOSITE" };
    expect(await answer(completed)).toEqual(result(t, "key", multipartETag("one"), checksum));
  });

  const exists = error(412, "PreconditionFailed", { Condition: "If-None-Match" });
  const otherSize = invalidRequest(MESSAGES.objectSize);
  test.each<[name: string, headers: Fields, object: boolean, expected: Answer | undefined]>([
    ["x-amz-mp-object-size has the size of the object", { "x-amz-mp-object-size": "3" }, false, undefined],
    ["x-amz-mp-object-size has another size", { "x-amz-mp-object-size": "4" }, false, otherSize],
    ["If-None-Match is * and the key has no object", { "if-none-match": "*" }, false, undefined],
    ["If-None-Match is * and the key has an object", { "if-none-match": "*" }, true, exists],
  ])("CompleteMultipartUpload when %s", async (_, headers, object, expected) => {
    await using t = start();
    const upload = uploads(t, "key");
    const uploadId = await upload.prepare({ 1: "one" });
    if (object) await t.s3.write("key", "the object");
    const done = result(t, "key", multipartETag("one"));

    expect(await answer(await upload.complete(uploadId, [one], headers))).toEqual(expected ?? done);
    const content = (await t.s3.file("key").exists()) ? await t.s3.file("key").text() : undefined;
    expect(content).toBe(expected ? (object ? "the object" : undefined) : "one");
    // A request that S3 refused leaves the upload in progress.
    if (expected) expect(await answer(await upload.complete(uploadId, [one]))).toEqual(done);
  });

  test.each(["Enabled", "Suspended", undefined] as const)("the versioning %p of the bucket", async state => {
    await using t = start();
    const bucket = t.server.createBucket({ name: "other", versioning: state });
    const upload = uploads(t, "key", "other");
    const reported: (string | null)[] = [];
    for (const content of ["first", "second"]) {
      const uploadId = await upload.prepare({ 1: content });
      reported.push((await upload.complete(uploadId, [[1, md5(content)]])).headers.get("x-amz-version-id"));
    }
    const stored = bucket.objects.get("key")!.map(version => `${version.versionId} "${version.etag}"`);
    // A bucket that never had versioning does not report a version. With suspended versioning the version is null.
    const id = { Enabled: expect.stringMatching(/^[A-Za-z0-9]{32}$/), Suspended: "null", none: null }[state ?? "none"];
    expect(reported).toEqual([id, id]);
    const both = [`${reported[1]} ${multipartETag("second")}`, `${reported[0]} ${multipartETag("first")}`];
    expect(stored).toEqual(state === "Enabled" ? both : [`null ${multipartETag("second")}`]);
  });

  test("AbortMultipartUpload removes the upload and its parts", async () => {
    await using t = start();
    const upload = uploads(t, "key");
    const uploadId = await upload.prepare({ 1: "one", 2: "two" });
    const other = await upload.prepare({ 1: "other" });

    const response = await upload.abort(uploadId);
    expect(values(response, "content-length", "content-type")).toEqual([204, null, null]);
    expect(await response.text()).toBe("");
    expect(list((await answer(await listUploads(t))).Upload).map(item => item.UploadId)).toEqual([other]);
    expect([...t.server.buckets.get(t.bucket)!.uploads.keys()]).toEqual([other]);
    expect(await answer(await upload.parts(uploadId))).toEqual(error(404, "NoSuchUpload", { UploadId: uploadId }));
    expect(await answer(await upload.get())).toEqual(error(404, "NoSuchKey", { Key: "key" }));
  });

  test("DeleteBucket removes a bucket that has uploads in progress and no objects", async () => {
    await using t = start();
    const upload = uploads(t, "key");
    const uploadId = await upload.prepare({ 1: "one" });
    expect((await t.client.fetch("DELETE", `/${t.bucket}`)).status).toBe(204);
    expect(await answer(await upload.parts(uploadId))).toEqual(error(404, "NoSuchBucket", { BucketName: t.bucket }));
  });
});
