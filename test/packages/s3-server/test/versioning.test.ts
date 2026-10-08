// The versions of an object in a bucket without versioning, with versioning and with suspended
// versioning, and object lock, which protects the versions of a bucket with versioning.

import { afterAll, describe, expect, test } from "bun:test";
import { Bucket, DEFAULT_OWNER, ObjectData, type ObjectVersion, type RequestOptions } from "../index.ts";
import { expectStatus, start, toObject, withoutDefaultType, xml, type TestServer } from "./helpers.ts";

type Fields = Record<string, string>;
type Server = TestServer & { now: Date };
type Entry = [type: string, key: string, versionId: string, latest: string, etag?: string];

const B = "/test-bucket";
const LOCKED = "/locked";
const CREATED = new Date("2024-05-06T07:08:09.500Z");
const LAST_MODIFIED = "Mon, 06 May 2024 07:08:09 GMT";
const MODIFIED = "2024-05-06T07:08:09.000Z";
const FUTURE = "2024-06-01T00:00:00.000Z";
const HELLO = '"5d41402abc4b2a76b9719d911017c592"';
const AES256 = { "x-amz-server-side-encryption": "AES256" };
const STORED = { "accept-ranges": "bytes", "etag": HELLO, "last-modified": LAST_MODIFIED, ...AES256 };
const BINARY = { ...STORED, "content-length": "5", "content-type": "binary/octet-stream" };
const ABSENT = Buffer.alloc(32, "A").toString();
const VERSION_ID = /^[A-Za-z0-9._-]{32}$/;
const MALFORMED = { Code: "MalformedXML" };
const NO_KEY = { Code: "NoSuchKey", Key: "missing" };

const md5 = (body: string, encoding: "base64" | "hex" = "base64") =>
  new Bun.CryptoHasher("md5").update(body).digest(encoding);
const etag = (body: string) => `"${md5(body, "hex")}"`;
const version = (versionId: string, subresource?: string, headers: Fields = {}): RequestOptions => ({
  query: subresource === undefined ? { versionId } : { [subresource]: "", versionId },
  headers,
});
const source = (value: string, headers: Fields = {}) => ({ headers: { "x-amz-copy-source": value, ...headers } });
const id = (versionId: string) => ({ "x-amz-version-id": versionId });
const marker = (versionId: string) => ({ "x-amz-delete-marker": "true", ...id(versionId) });
const answer = (status: number, headers: Fields = {}, body: unknown = "") => ({ status, headers, body });
const failed = (status: number, Error: object, headers: Fields = {}) => answer(status, headers, { Error });

const noSuchKey = (Key: string) => ({ Code: "NoSuchKey", Message: "The specified key does not exist.", Key });
const noSuchVersion = (Key: string, VersionId: string) => ({
  Code: "NoSuchVersion",
  Message: "The specified version does not exist.",
  Key,
  VersionId,
});
const notAllowed = {
  Code: "MethodNotAllowed",
  Message: "The specified method is not allowed against this resource.",
  Method: "GET",
  ResourceType: "DeleteMarker",
};

/** The options of a request that sends a document, with the Content-MD5 header that S3 wants for it. */
function doc(subresource: string, body: string, headers: Fields = {}, query: Fields = {}): RequestOptions {
  const named: Fields = subresource === "" ? {} : { [subresource]: "" };
  return { query: { ...named, ...query }, body, headers: { "content-md5": md5(body), ...headers } };
}

const tagging = (key: string, value: string) =>
  `<Tagging><TagSet><Tag><Key>${key}</Key><Value>${value}</Value></Tag></TagSet></Tagging>`;

function remove(objects: [key: string, versionId?: string][]): RequestOptions {
  const items = objects.map(([key, versionId]) => {
    const element = versionId === undefined ? "" : `<VersionId>${versionId}</VersionId>`;
    return `<Object><Key>${key}</Key>${element}</Object>`;
  });
  return doc("delete", `<Delete>${items.join("")}</Delete>`);
}

/** A server with a clock that the test can set. It has a bucket without versioning and a bucket with object lock. */
function startAt(time: Date, versioning?: "Enabled" | "Suspended"): Server {
  const t = { now: time } as Server;
  const buckets = [{ name: "test-bucket", versioning }, "other-bucket", { name: "locked", objectLock: true }];
  return Object.assign(t, start({ clock: () => t.now, buckets }));
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

const read = (t: TestServer, method: string, key: string, options: RequestOptions = {}, bucket = B) =>
  result(t.client.fetch(method, `${bucket}/${key}`, options));

/** Uploads an object. Returns the version ID of the response. */
async function put(t: TestServer, key: string, body = "hello", headers: Fields = {}, bucket = B): Promise<string> {
  const response = await t.client.fetch("PUT", `${bucket}/${key}`, doc("", body, headers));
  return (await expectStatus(response, 200)).headers.get("x-amz-version-id") ?? "";
}

async function setVersioning(t: TestServer, status: "Enabled" | "Suspended"): Promise<void> {
  const body = `<VersioningConfiguration><Status>${status}</Status></VersioningConfiguration>`;
  await expectStatus(await t.client.fetch("PUT", B, doc("versioning", body)), 200);
}

/** The versions and the delete markers that ListObjectVersions reports, in the order of the document. */
async function list(t: TestServer): Promise<Entry[]> {
  const root = await xml(await expectStatus(await t.client.fetch("GET", B, { query: { versions: "" } }), 200));
  const entries = root.children.filter(element => element.name === "Version" || element.name === "DeleteMarker");
  return entries.map((element): Entry => {
    const { Key, VersionId, IsLatest, ETag } = toObject(element);
    return ETag === undefined
      ? [element.name, Key, VersionId, IsLatest]
      : [element.name, Key, VersionId, IsLatest, ETag];
  });
}

describe("a bucket without versioning", () => {
  test("has the version null of each object and reports no version ID", async () => {
    await using t = startAt(CREATED);
    expect([await put(t, "key", "first"), await put(t, "key")]).toEqual(["", ""]);
    expect(await list(t)).toEqual([["Version", "key", "null", "true", HELLO]]);
    expect(await read(t, "GET", "key")).toEqual(answer(200, BINARY, "hello"));
    expect(await read(t, "GET", "key", version("null"))).toEqual(answer(200, BINARY, "hello"));
    expect(await read(t, "HEAD", "key", version("null"))).toEqual(answer(200, BINARY));
    expect(await read(t, "GET", "key", version("null", "tagging"))).toEqual(
      answer(200, {}, { Tagging: { TagSet: "" } }),
    );
    const CopyObjectResult = { LastModified: MODIFIED, ETag: HELLO };
    const copied = await read(t, "PUT", "copy", source("test-bucket/key?versionId=null"));
    expect(copied).toEqual(answer(200, AES256, { CopyObjectResult }));
    expect(await read(t, "GET", "key", version(ABSENT))).toEqual(failed(404, noSuchVersion("key", ABSENT)));

    // A delete removes the object. The bucket gets no delete marker.
    expect(await read(t, "DELETE", "key", version(ABSENT))).toEqual(answer(204));
    expect(await read(t, "DELETE", "key")).toEqual(answer(204));
    expect(await read(t, "DELETE", "key")).toEqual(answer(204));
    expect(await read(t, "GET", "key")).toEqual(failed(404, noSuchKey("key")));
    expect(await list(t)).toEqual([["Version", "copy", "null", "true", HELLO]]);
    expect(await read(t, "DELETE", "copy", version("null"))).toEqual(answer(204));
    const Deleted = [{ Key: "gone" }, { Key: "gone", VersionId: "null" }];
    const removed = await result(t.client.fetch("POST", B, remove([["gone"], ["gone", "null"]])));
    expect(removed).toEqual(answer(200, {}, { DeleteResult: { Deleted } }));
    expect(await list(t)).toEqual([]);
  });
});

describe("a bucket with versioning", () => {
  test("each upload makes a version and the newest version is the current one", async () => {
    await using t = startAt(CREATED);
    await put(t, "key", "before");
    await setVersioning(t, "Enabled");
    const ids = [await put(t, "key", "one"), await put(t, "key", "two"), await put(t, "key")];
    expect(ids.map(versionId => VERSION_ID.test(versionId))).toEqual([true, true, true]);
    expect(new Set(ids).size).toBe(3);
    expect(await list(t)).toEqual([
      ["Version", "key", ids[2], "true", HELLO],
      ["Version", "key", ids[1], "false", etag("two")],
      ["Version", "key", ids[0], "false", etag("one")],
      ["Version", "key", "null", "false", etag("before")],
    ]);

    const current = { ...BINARY, ...id(ids[2]) };
    expect(await read(t, "GET", "key")).toEqual(answer(200, current, "hello"));
    expect(await read(t, "HEAD", "key")).toEqual(answer(200, current));
    expect(await read(t, "GET", "key", version(ids[2]))).toEqual(answer(200, current, "hello"));
    const first = { ...BINARY, "content-length": "3", "etag": etag("one"), ...id(ids[0]) };
    expect(await read(t, "GET", "key", version(ids[0]))).toEqual(answer(200, first, "one"));
    expect(await read(t, "HEAD", "key", version(ids[0]))).toEqual(answer(200, first));
    const before = { ...BINARY, "content-length": "6", "etag": etag("before"), ...id("null") };
    expect(await read(t, "GET", "key", version("null"))).toEqual(answer(200, before, "before"));
  });

  test("a delete without a version ID makes a delete marker", async () => {
    await using t = startAt(CREATED, "Enabled");
    const ids = [await put(t, "key", "one"), await put(t, "key")];
    const deleted = await read(t, "DELETE", "key");
    const first = deleted.headers["x-amz-version-id"];
    expect(deleted).toEqual(answer(204, marker(first)));
    expect([VERSION_ID.test(first), ids.includes(first)]).toEqual([true, false]);

    // The key has no object for a request without a version ID. The versions are there.
    expect(await read(t, "GET", "key")).toEqual(failed(404, noSuchKey("key"), marker(first)));
    expect(await read(t, "HEAD", "key")).toEqual(answer(404, { "content-length": "0", ...marker(first) }));
    expect(await read(t, "GET", "key", version(ids[1]))).toEqual(answer(200, { ...BINARY, ...id(ids[1]) }, "hello"));
    // S3 has no content and no metadata for a delete marker.
    const headers = { "allow": "DELETE", "last-modified": LAST_MODIFIED, ...marker(first) };
    expect(await read(t, "GET", "key", version(first))).toEqual(failed(405, notAllowed, headers));
    expect(await read(t, "HEAD", "key", version(first))).toEqual(answer(405, { "content-length": "0", ...headers }));

    const second = (await read(t, "DELETE", "key")).headers["x-amz-version-id"];
    const never = (await read(t, "DELETE", "never")).headers["x-amz-version-id"];
    expect(await list(t)).toEqual([
      ["DeleteMarker", "key", second, "true"],
      ["DeleteMarker", "key", first, "false"],
      ["Version", "key", ids[1], "false", HELLO],
      ["Version", "key", ids[0], "false", etag("one")],
      ["DeleteMarker", "never", never, "true"],
    ]);

    // The delete of the delete markers brings the object back.
    expect(await read(t, "DELETE", "key", version(first))).toEqual(answer(204, marker(first)));
    expect(await read(t, "GET", "key")).toEqual(failed(404, noSuchKey("key"), marker(second)));
    expect(await read(t, "DELETE", "key", version(second))).toEqual(answer(204, marker(second)));
    expect(await read(t, "GET", "key")).toEqual(answer(200, { ...BINARY, ...id(ids[1]) }, "hello"));
  });

  test("a delete with a version ID is permanent", async () => {
    await using t = startAt(CREATED);
    await put(t, "key", "before");
    await setVersioning(t, "Enabled");
    const ids = [await put(t, "key", "one"), await put(t, "key")];

    expect(await read(t, "DELETE", "key", version(ids[1]))).toEqual(answer(204, id(ids[1])));
    expect(await read(t, "GET", "key", version(ids[1]))).toEqual(failed(404, noSuchVersion("key", ids[1])));
    expect(await read(t, "GET", "key")).toMatchObject({ status: 200, body: "one" });
    expect(await read(t, "DELETE", "key", version(ids[1]))).toEqual(answer(204, id(ids[1])));
    expect(await read(t, "DELETE", "key", version(ABSENT))).toEqual(answer(204, id(ABSENT)));
    expect(await read(t, "DELETE", "key", version("null"))).toEqual(answer(204, id("null")));
    expect(await list(t)).toEqual([["Version", "key", ids[0], "true", etag("one")]]);
    expect(await read(t, "DELETE", "key", version(ids[0]))).toEqual(answer(204, id(ids[0])));
    expect(await read(t, "GET", "key")).toEqual(failed(404, noSuchKey("key")));
    expect(t.server.buckets.get(t.bucket)!.isEmpty).toBe(true);
  });

  test("DeleteObjects makes delete markers and removes versions", async () => {
    await using t = startAt(CREATED, "Enabled");
    const ids = [await put(t, "key", "one"), await put(t, "key")];
    const made = (await result(t.client.fetch("POST", B, remove([["key"], ["never"]])))).body.DeleteResult.Deleted;
    const [key, never] = made.map((item: Fields) => item.DeleteMarkerVersionId);
    expect(made).toEqual([
      { Key: "key", DeleteMarker: "true", DeleteMarkerVersionId: key },
      { Key: "never", DeleteMarker: "true", DeleteMarkerVersionId: never },
    ]);
    expect([VERSION_ID.test(key), VERSION_ID.test(never), key === never]).toEqual([true, true, false]);
    expect(await list(t)).toEqual([
      ["DeleteMarker", "key", key, "true"],
      ["Version", "key", ids[1], "false", HELLO],
      ["Version", "key", ids[0], "false", etag("one")],
      ["DeleteMarker", "never", never, "true"],
    ]);

    const objects = remove([["key", key], ["key", ids[0]], ["key", ABSENT], ["key", "not-an-id"]]); // prettier-ignore
    const Deleted = [
      { Key: "key", VersionId: key, DeleteMarker: "true", DeleteMarkerVersionId: key },
      { Key: "key", VersionId: ids[0] },
      { Key: "key", VersionId: ABSENT },
    ];
    // DeleteObjects reports a version ID that has another format as a version that does not exist.
    const Error = { Key: "key", VersionId: "not-an-id", Code: "NoSuchVersion", Message: expect.any(String) };
    expect((await result(t.client.fetch("POST", B, objects))).body).toEqual({ DeleteResult: { Deleted, Error } });
    expect(await list(t)).toEqual([
      ["Version", "key", ids[1], "true", HELLO],
      ["DeleteMarker", "never", never, "true"],
    ]);
  });

  test("the tags, the ACL and the attributes of a version", async () => {
    await using t = startAt(CREATED, "Enabled");
    const ids = [await put(t, "key", "hello", { "x-amz-tagging": "first=1" }), await put(t, "key", "two")];
    const tags = (Key: string, Value: string) => ({ Tagging: { TagSet: { Tag: { Key, Value } } } });
    const done = (versionId: string) => answer(200, { "content-length": "0", ...id(versionId) });

    expect(await read(t, "PUT", "key", doc("tagging", tagging("current", "2")))).toEqual(done(ids[1]));
    const old = doc("tagging", tagging("old", "1"), {}, { versionId: ids[0] });
    expect(await read(t, "PUT", "key", old)).toEqual(done(ids[0]));
    expect(await read(t, "GET", "key", { query: { tagging: "" } })).toEqual(
      answer(200, id(ids[1]), tags("current", "2")),
    );
    expect(await read(t, "GET", "key", version(ids[0], "tagging"))).toEqual(answer(200, id(ids[0]), tags("old", "1")));
    expect(await read(t, "DELETE", "key", version(ids[0], "tagging"))).toEqual(answer(204, id(ids[0])));
    const none = { Tagging: { TagSet: "" } };
    expect(await read(t, "GET", "key", version(ids[0], "tagging"))).toEqual(answer(200, id(ids[0]), none));
    expect((await read(t, "GET", "key")).headers["x-amz-tagging-count"]).toBe("1");

    expect(await read(t, "PUT", "key", version(ids[0], "acl", { "x-amz-acl": "public-read" }))).toEqual(done(ids[0]));
    const grants = async (options: RequestOptions) => {
      const { headers, body } = await read(t, "GET", "key", options);
      return [headers, [body.AccessControlPolicy.AccessControlList.Grant].flat().map(grant => grant.Permission)];
    };
    expect(await grants(version(ids[0], "acl"))).toEqual([id(ids[0]), ["FULL_CONTROL", "READ"]]);
    expect(await grants({ query: { acl: "" } })).toEqual([id(ids[1]), ["FULL_CONTROL"]]);

    const attributes = version(ids[0], "attributes", { "x-amz-object-attributes": "ETag,ObjectSize" });
    const GetObjectAttributesResponse = { ETag: HELLO.slice(1, -1), ObjectSize: "5" };
    const headers = { "last-modified": LAST_MODIFIED, ...id(ids[0]) };
    expect(await read(t, "GET", "key", attributes)).toEqual(answer(200, headers, { GetObjectAttributesResponse }));
  });

  test("a copy of a version, and a copy to the same key", async () => {
    await using t = startAt(CREATED, "Enabled");
    const ids = [await put(t, "key"), await put(t, "key", "two")];
    const copy = async (path: string, from: string) => {
      const { status, headers, body } = await result(t.client.fetch("PUT", path, source(from)));
      const { "x-amz-version-id": made = "", ...rest } = headers;
      return { ...answer(status, rest, body), made: VERSION_ID.test(made) };
    };
    const body = { CopyObjectResult: { LastModified: MODIFIED, ETag: HELLO } };
    const copied = answer(200, { ...AES256, "x-amz-copy-source-version-id": ids[0] }, body);
    const from = `test-bucket/key?versionId=${ids[0]}`;
    expect(await copy(`${B}/copy`, from)).toEqual({ ...copied, made: true });
    expect(await copy("/other-bucket/copy", from)).toEqual({ ...copied, made: false });
    // The copy of an earlier version to its own key makes it the current version again.
    expect(await copy(`${B}/key`, from)).toEqual({ ...copied, made: true });
    expect(await read(t, "GET", "key")).toMatchObject({ status: 200, body: "hello" });
    const tags = (await list(t)).map(([, key, , , tag]) => `${key} ${tag}`);
    expect(tags).toEqual([`copy ${HELLO}`, `key ${HELLO}`, `key ${etag("two")}`, `key ${HELLO}`]);
    // The source in a bucket without versioning has no version ID.
    expect(await copy(`${B}/back`, "other-bucket/copy")).toEqual({ ...answer(200, AES256, body), made: true });

    const deleted = (await read(t, "DELETE", "copy")).headers["x-amz-version-id"];
    const Message = "The source of a copy request may not specifically refer to a delete marker by version id.";
    const byMarker = failed(400, { Code: "InvalidRequest", Message });
    expect(await copy(`${B}/new`, "test-bucket/copy")).toEqual({ ...failed(404, noSuchKey("copy")), made: false });
    expect(await copy(`${B}/new`, `test-bucket/copy?versionId=${deleted}`)).toEqual({ ...byMarker, made: false });
    const absent = failed(404, noSuchVersion("key", ABSENT));
    expect(await copy(`${B}/new`, `test-bucket/key?versionId=${ABSENT}`)).toEqual({ ...absent, made: false });
  });

  describe("a request with a version ID that the key does not have", () => {
    let shared: Promise<{ t: Server; deleted: string }> | undefined;
    const fixture = async () => {
      const t = startAt(CREATED, "Enabled");
      await put(t, "key");
      return { t, deleted: (await read(t, "DELETE", "marked")).headers["x-amz-version-id"] };
    };
    afterAll(async () => (await shared)?.t.server.stop());

    const invalid = (ArgumentValue: string, Message = "Invalid version id specified") => ({
      Code: "InvalidArgument",
      Message,
      ArgumentName: "versionId",
      ArgumentValue,
    });
    test.each<[string, string, RequestOptions]>([
      ["GetObject", "GET", {}],
      ["GetObjectTagging", "GET", { query: { tagging: "" } }],
      ["PutObjectTagging", "PUT", doc("tagging", tagging("a", "1"))],
      ["DeleteObjectTagging", "DELETE", { query: { tagging: "" } }],
      ["GetObjectAcl", "GET", { query: { acl: "" } }],
      ["PutObjectAcl", "PUT", { query: { acl: "" }, headers: { "x-amz-acl": "private" } }],
      ["GetObjectAttributes", "GET", { query: { attributes: "" }, headers: { "x-amz-object-attributes": "ETag" } }],
    ])("%s", async (operation, method, options) => {
      const { t, deleted } = await (shared ??= fixture());
      const request = (key: string, versionId: string) =>
        read(t, method, key, { ...options, query: { ...options.query, versionId } });

      expect(await request("key", ABSENT)).toEqual(failed(404, noSuchVersion("key", ABSENT)));
      expect(await request("missing", ABSENT)).toEqual(failed(404, noSuchVersion("missing", ABSENT)));
      expect(await request("missing", "null")).toEqual(failed(404, noSuchVersion("missing", "null")));
      for (const versionId of ["not-an-id", ABSENT + "A", ABSENT.slice(1), "NULL"]) {
        expect(await request("key", versionId)).toEqual(failed(400, invalid(versionId)));
      }
      expect(await request("key", "")).toEqual(failed(400, invalid("", "Version id cannot be the empty string")));
      if (operation !== "GetObject" && operation !== "GetObjectAttributes") return;
      // The requests that read an object report a delete marker.
      const headers = { "allow": "DELETE", "last-modified": LAST_MODIFIED, ...marker(deleted) };
      expect(await request("marked", deleted)).toEqual(failed(405, notAllowed, headers));
      expect(await read(t, "GET", "marked", options)).toEqual(failed(404, noSuchKey("marked"), marker(deleted)));
      if (operation !== "GetObject") return;
      expect(await read(t, "HEAD", "key", version("not-an-id"))).toEqual(answer(400, { "content-length": "0" }));
      expect(await read(t, "DELETE", "key", version("not-an-id"))).toEqual(failed(400, invalid("not-an-id")));
    });
  });
});

describe("a bucket with suspended versioning", () => {
  test("an upload and a delete replace the version null only", async () => {
    await using t = startAt(CREATED, "Enabled");
    const kept = await put(t, "key", "kept");
    await setVersioning(t, "Suspended");
    expect([await put(t, "key", "first"), await put(t, "key")]).toEqual(["null", "null"]);
    const versions: Entry[] = [
      ["Version", "key", "null", "true", HELLO],
      ["Version", "key", kept, "false", etag("kept")],
    ];
    expect(await list(t)).toEqual(versions);
    expect(await read(t, "GET", "key")).toEqual(answer(200, { ...BINARY, ...id("null") }, "hello"));
    expect(await read(t, "GET", "key", version("null"))).toEqual(answer(200, { ...BINARY, ...id("null") }, "hello"));

    // The delete marker has the version null and takes the place of the object with that version.
    expect(await read(t, "DELETE", "key")).toEqual(answer(204, marker("null")));
    expect(await read(t, "DELETE", "key")).toEqual(answer(204, marker("null")));
    expect(await list(t)).toEqual([["DeleteMarker", "key", "null", "true"], versions[1]]);
    expect(await read(t, "GET", "key")).toEqual(failed(404, noSuchKey("key"), marker("null")));
    expect(await read(t, "GET", "key", version("null"))).toMatchObject({ status: 405, headers: marker("null") });
    expect(await read(t, "GET", "key", version(kept))).toMatchObject({ status: 200, body: "kept" });

    expect(await put(t, "key")).toBe("null");
    expect(await list(t)).toEqual(versions);
    expect(await read(t, "DELETE", "key", version("null"))).toEqual(answer(204, id("null")));
    expect(await read(t, "GET", "key")).toMatchObject({ status: 200, body: "kept" });

    await setVersioning(t, "Enabled");
    const added = await put(t, "key");
    expect(await list(t)).toEqual([["Version", "key", added, "true", HELLO], versions[1]]);
  });
});

describe("the store", () => {
  const owner = DEFAULT_OWNER;
  const time = new Date("2024-05-06T07:08:09.987Z");
  const object = (key: string): Omit<ObjectVersion, "versionId"> => ({
    key,
    deleteMarker: false,
    data: new ObjectData([Buffer.from("hello")]),
    size: 5,
    etag: HELLO.slice(1, -1),
    lastModified: time,
    owner,
    acl: [],
    tags: [],
    contentType: "binary/octet-stream",
    userMetadata: {},
    storageClass: "STANDARD",
    encryption: { algorithm: "AES256" },
  });
  /** Each key with its versions, the newest first: `+` is an object and `-` is a delete marker. */
  const state = (bucket: Bucket) =>
    bucket.sortedKeys().map(key => {
      const versions = bucket.objects.get(key)!.map(item => (item.deleteMarker ? "-" : "+") + item.versionId);
      return [key, ...versions].join(" ");
    });

  test("Bucket.put and Bucket.delete keep the versions of a key, the newest first", () => {
    const bucket = new Bucket("store", owner, "us-east-1", time, []);
    expect([bucket.put(object("b")).versionId, bucket.put(object("b")).versionId]).toEqual(["null", "null"]);
    expect(bucket.put(object("a")).lastModified).toEqual(new Date(MODIFIED));
    expect(state(bucket)).toEqual(["a +null", "b +null"]);
    expect(bucket.delete("a", undefined, owner, time)).toEqual({ deleteMarker: false });
    expect(bucket.delete("a", undefined, owner, time)).toEqual({ deleteMarker: false });

    bucket.versioning = "Enabled";
    const [first, second] = [bucket.put(object("b")).versionId, bucket.put(object("b")).versionId];
    const deleted = bucket.delete("b", undefined, owner, time);
    expect(deleted).toEqual({ deleteMarker: true, versionId: expect.stringMatching(VERSION_ID) });
    expect(state(bucket)).toEqual([`b -${deleted.versionId} +${second} +${first} +null`]);
    expect([bucket.latest("b")!.deleteMarker, bucket.current("b")]).toEqual([true, undefined]);
    expect([bucket.version("b", first)!.versionId, bucket.version("b", ABSENT)]).toEqual([first, undefined]);
    expect(bucket.latest("b")!.lastModified).toEqual(new Date(MODIFIED));

    bucket.versioning = "Suspended";
    expect(bucket.put(object("b")).versionId).toBe("null");
    expect(state(bucket)).toEqual([`b +null -${deleted.versionId} +${second} +${first}`]);
    expect(bucket.delete("b", undefined, owner, time)).toEqual({ deleteMarker: true, versionId: "null" });
    expect(state(bucket)).toEqual([`b -null -${deleted.versionId} +${second} +${first}`]);

    const removed = (versionId: string) => [bucket.delete("b", versionId, owner, time).deleteMarker, ...state(bucket)];
    expect(removed(deleted.versionId!)).toEqual([true, `b -null +${second} +${first}`]);
    expect(removed("null")).toEqual([true, `b +${second} +${first}`]);
    expect(removed("null")).toEqual([false, `b +${second} +${first}`]);
    expect(removed(second)).toEqual([false, `b +${first}`]);
    expect([bucket.current("b")!.versionId, bucket.isEmpty]).toEqual([first, false]);
    expect(removed(first)).toEqual([false]);
    expect(bucket.isEmpty).toBe(true);
  });
});

describe("object lock", () => {
  type Step = [method: string, options: RequestOptions, status: number, body?: unknown];
  const MODE = "x-amz-object-lock-mode";
  const UNTIL = "x-amz-object-lock-retain-until-date";
  const HOLD = "x-amz-object-lock-legal-hold";
  const bypass = { "x-amz-bypass-governance-retention": "true" };
  const retain = (mode: string, until: string, headers?: Fields) =>
    doc("retention", `<Retention><Mode>${mode}</Mode><RetainUntilDate>${until}</RetainUntilDate></Retention>`, headers);
  const hold = (status: string) => doc("legal-hold", `<LegalHold><Status>${status}</Status></LegalHold>`);
  const denied = { Code: "AccessDenied", Message: "Access Denied because object protected by object lock." };
  const refused = { Code: "AccessDenied" };
  const noLock = { Code: "NoSuchObjectLockConfiguration", Key: "object" };
  const retained = (Mode: string, RetainUntilDate: string) => ({ Retention: { Mode, RetainUntilDate } });

  /**
   * Sends the requests for `object` of the bucket with object lock. Compares
   * the status and the document of each response. The error is without the
   * message when the step has none.
   */
  async function run(t: Server, steps: Step[]): Promise<void> {
    const results: unknown[] = [];
    for (const [method, options, , expected] of steps) {
      const { status, body } = await read(t, method, "object", options, LOCKED);
      const { Message, ...error } = body.Error ?? {};
      const document = body.Error === undefined ? body : "Message" in (expected as object) ? body.Error : error;
      results.push(body === "" ? [method, options, status] : [method, options, status, document]);
    }
    expect(results).toEqual(steps);
  }

  test("the retention in GOVERNANCE mode", async () => {
    await using t = startAt(CREATED);
    const made = await put(t, "object", "hello", {}, LOCKED);
    await run(t, [
      ["GET", { query: { retention: "" } }, 404, noLock],
      ["PUT", retain("GOVERNANCE", "2024-06-01T00:00:00Z"), 200],
      ["GET", { query: { retention: "" } }, 200, retained("GOVERNANCE", FUTURE)],
      ["GET", version(made, "retention"), 200, retained("GOVERNANCE", FUTURE)],
      ["DELETE", version(made), 403, denied],
      ["DELETE", version(made, undefined, { "x-amz-bypass-governance-retention": "false" }), 403, denied],
      ["PUT", retain("GOVERNANCE", "2024-05-20T00:00:00Z"), 403, refused],
      ["PUT", retain("COMPLIANCE", FUTURE), 403, refused],
      ["PUT", doc("retention", "<Retention/>"), 403, refused],
      ["PUT", retain("GOVERNANCE", "2024-07-01T00:00:00Z"), 200],
      ["PUT", retain("GOVERNANCE", FUTURE, bypass), 200],
    ]);
    const headers = { ...BINARY, [MODE]: "GOVERNANCE", [UNTIL]: FUTURE, ...id(made) };
    expect(await read(t, "HEAD", "object", {}, LOCKED)).toEqual(answer(200, headers));
    expect(await read(t, "GET", "object", {}, LOCKED)).toEqual(answer(200, headers, "hello"));

    // A delete without a version ID makes a delete marker also for a locked object.
    const deleted = await read(t, "DELETE", "object", {}, LOCKED);
    const marked = deleted.headers["x-amz-version-id"];
    expect(deleted).toEqual(answer(204, marker(marked)));
    expect([VERSION_ID.test(marked), marked === made]).toEqual([true, false]);
    await run(t, [
      ["GET", {}, 404, { Code: "NoSuchKey", Key: "object" }],
      ["DELETE", version(made), 403, denied],
      ["DELETE", version(marked), 204],
      ["GET", {}, 200, "hello"],
      ["PUT", doc("retention", "<Retention/>", bypass), 200],
      ["GET", { query: { retention: "" } }, 404, noLock],
      ["PUT", retain("GOVERNANCE", FUTURE), 200],
      ["DELETE", version(made, undefined, bypass), 204],
      ["GET", version(made), 404, { Code: "NoSuchVersion", Key: "object", VersionId: made }],
    ]);
    expect(t.server.buckets.get("locked")!.isEmpty).toBe(true);
  });

  test("the retention in COMPLIANCE mode", async () => {
    await using t = startAt(CREATED);
    const made = await put(t, "object", "hello", {}, LOCKED);
    await run(t, [
      ["PUT", retain("COMPLIANCE", FUTURE), 200],
      ["DELETE", version(made), 403, denied],
      ["DELETE", version(made, undefined, bypass), 403, denied],
      ["PUT", retain("COMPLIANCE", "2024-05-20T00:00:00Z", bypass), 403, refused],
      ["PUT", retain("GOVERNANCE", FUTURE, bypass), 403, refused],
      ["PUT", doc("retention", "<Retention/>", bypass), 403, refused],
      ["PUT", retain("COMPLIANCE", "2024-06-02T00:00:00Z"), 200],
      ["GET", { query: { retention: "" } }, 200, retained("COMPLIANCE", "2024-06-02T00:00:00.000Z")],
    ]);
    // The lock ends at the date of the retention.
    t.now = new Date("2024-06-02T00:00:00Z");
    await run(t, [["DELETE", version(made), 204]]);
  });

  test("the legal hold", async () => {
    await using t = startAt(CREATED);
    const made = await put(t, "object", "hello", {}, LOCKED);
    await run(t, [
      ["GET", { query: { "legal-hold": "" } }, 404, noLock],
      ["PUT", hold("ON"), 200],
      ["GET", { query: { "legal-hold": "" } }, 200, { LegalHold: { Status: "ON" } }],
      ["DELETE", version(made), 403, denied],
      ["DELETE", version(made, undefined, bypass), 403, denied],
    ]);
    const headers = { ...BINARY, [HOLD]: "ON", ...id(made) };
    expect(await read(t, "HEAD", "object", {}, LOCKED)).toEqual(answer(200, headers));
    await run(t, [
      ["PUT", hold("OFF"), 200],
      ["GET", { query: { "legal-hold": "" } }, 200, { LegalHold: { Status: "OFF" } }],
      ["DELETE", version(made), 204],
    ]);
  });

  // prettier-ignore
  test.each<[string, Fields, Fields, boolean]>([
    ["no lock", {}, {}, false],
    ["a retention", { [MODE]: "GOVERNANCE", [UNTIL]: "2024-06-01T00:00:00Z" }, { [MODE]: "GOVERNANCE", [UNTIL]: FUTURE }, true],
    ["a retention and a legal hold", { [MODE]: "COMPLIANCE", [UNTIL]: "2024-06-01T02:00:00+02:00", [HOLD]: "ON" },
      { [MODE]: "COMPLIANCE", [UNTIL]: FUTURE, [HOLD]: "ON" }, true],
    ["a legal hold", { [HOLD]: "ON" }, { [HOLD]: "ON" }, true],
    ["a legal hold that is off", { [HOLD]: "OFF" }, { [HOLD]: "OFF" }, false],
  ])("an upload with %s", async (_, headers, lock, locked) => {
    await using t = startAt(CREATED);
    const made = await put(t, "object", "hello", headers, LOCKED);
    expect(await read(t, "HEAD", "object", {}, LOCKED)).toEqual(answer(200, { ...BINARY, ...lock, ...id(made) }));
    await run(t, [locked ? ["DELETE", version(made), 403, denied] : ["DELETE", version(made), 204]]);
  });

  test("DeleteObjects removes a locked version only with the bypass of the GOVERNANCE mode", async () => {
    await using t = startAt(CREATED);
    const locks = { governance: { [MODE]: "GOVERNANCE", [UNTIL]: FUTURE }, compliance: { [MODE]: "COMPLIANCE", [UNTIL]: FUTURE }, held: { [HOLD]: "ON" }, free: {} }; // prettier-ignore
    const objects: [string, string][] = [];
    for (const [key, lock] of Object.entries(locks)) objects.push([key, await put(t, key, "hello", lock, LOCKED)]);
    const [governance, compliance, held, free] = objects.map(([Key, VersionId]) => ({ Key, VersionId }));
    const request = remove(objects);
    expect((await result(t.client.fetch("POST", LOCKED, request))).body).toEqual({
      DeleteResult: { Deleted: free, Error: [governance, compliance, held].map(item => ({ ...item, ...denied })) },
    });
    const bypassed = { ...request, headers: { ...request.headers, ...bypass } };
    expect((await result(t.client.fetch("POST", LOCKED, bypassed))).body).toEqual({
      DeleteResult: { Deleted: [governance, free], Error: [compliance, held].map(item => ({ ...item, ...denied })) },
    });
  });

  test("CreateBucket with x-amz-bucket-object-lock-enabled makes a bucket with object lock", async () => {
    await using t = startAt(CREATED);
    const created = await t.client.fetch("PUT", "/made", { headers: { "x-amz-bucket-object-lock-enabled": "true" } });
    expect(created.status).toBe(200);
    const made = await put(t, "object", "hello", { [HOLD]: "ON" }, "/made");
    const kept = await read(t, "PUT", "object", retain("GOVERNANCE", FUTURE), "/made");
    expect(kept).toEqual(answer(200, { "content-length": "0" }));
    const headers = { ...BINARY, [MODE]: "GOVERNANCE", [UNTIL]: FUTURE, [HOLD]: "ON", ...id(made) };
    expect(await read(t, "HEAD", "object", {}, "/made")).toEqual(answer(200, headers));
  });

  test("an upload gets the default retention of the bucket", async () => {
    await using t = startAt(CREATED);
    const rule = (mode: string, period: string) =>
      "<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled>" +
      `<Rule><DefaultRetention><Mode>${mode}</Mode>${period}</DefaultRetention></Rule></ObjectLockConfiguration>`;
    const configure = (document: string) => t.client.fetch("PUT", LOCKED, doc("object-lock", document));
    await expectStatus(await configure(rule("GOVERNANCE", "<Days>30</Days>")), 200);
    await put(t, "days", "hello", {}, LOCKED);
    await put(t, "own", "hello", { [MODE]: "COMPLIANCE", [UNTIL]: FUTURE, [HOLD]: "ON" }, LOCKED);
    await put(t, "hold", "hello", { [HOLD]: "OFF" }, LOCKED);
    await expectStatus(await configure(rule("COMPLIANCE", "<Years>1</Years>")), 200);
    await put(t, "years", "hello", {}, LOCKED);
    await expectStatus(await t.client.fetch("PUT", `${LOCKED}/copy`, source("locked/days")), 200);

    const locks: Record<string, Fields> = {};
    for (const key of ["days", "own", "hold", "years", "copy"]) {
      const { headers } = await t.client.fetch("HEAD", `${LOCKED}/${key}`);
      locks[key] = Object.fromEntries([...headers].filter(([name]) => name.startsWith("x-amz-object-lock-")));
    }
    expect(locks).toEqual({
      days: { [MODE]: "GOVERNANCE", [UNTIL]: "2024-06-05T07:08:09.500Z" },
      own: { [MODE]: "COMPLIANCE", [UNTIL]: FUTURE, [HOLD]: "ON" },
      hold: { [MODE]: "GOVERNANCE", [UNTIL]: "2024-06-05T07:08:09.500Z", [HOLD]: "OFF" },
      years: { [MODE]: "COMPLIANCE", [UNTIL]: "2025-05-06T07:08:09.500Z" },
      copy: { [MODE]: "COMPLIANCE", [UNTIL]: "2025-05-06T07:08:09.500Z" },
    });
  });

  describe("refuses", () => {
    let shared: Promise<{ t: Server; state: () => string; before: string }> | undefined;
    const fixture = async () => {
      const t = startAt(CREATED);
      await put(t, "object");
      await put(t, "object", "hello", {}, LOCKED);
      const state = () => JSON.stringify([...t.server.buckets.values()].map(bucket => [...bucket.objects]));
      return { t, state, before: state() };
    };
    afterAll(async () => (await shared)?.t.server.stop());

    const upload = (headers: Fields) => doc("", "x", headers);
    const noConfiguration = { Code: "InvalidRequest", Message: "Bucket is missing Object Lock Configuration" };
    const argument = (ArgumentName: string, ArgumentValue: string, Message: string) =>
      ({ Code: "InvalidArgument", Message, ArgumentName, ArgumentValue }); // prettier-ignore
    const both = "x-amz-object-lock-retain-until-date and x-amz-object-lock-mode must both be supplied";
    const past = "The retain until date must be in the future!";
    const digest =
      "Content-MD5 OR x-amz-checksum- HTTP header is required for Put Object requests with Object Lock parameters";
    const NO_BODY = { Code: "MissingRequestBodyError" };
    // prettier-ignore
    test.each<[string, string, string, RequestOptions, number, Fields]>([
      ["GetObjectRetention in a bucket without object lock", "GET", `${B}/object`, { query: { retention: "" } }, 400, noConfiguration],
      ["PutObjectRetention in a bucket without object lock", "PUT", `${B}/object`, retain("GOVERNANCE", FUTURE), 400, noConfiguration],
      ["GetObjectLegalHold in a bucket without object lock", "GET", `${B}/object`, { query: { "legal-hold": "" } }, 400, noConfiguration],
      ["PutObjectLegalHold in a bucket without object lock", "PUT", `${B}/object`, hold("ON"), 400, noConfiguration],
      ["an upload with a retention to a bucket without object lock", "PUT", `${B}/new`, upload({ [MODE]: "GOVERNANCE", [UNTIL]: FUTURE }), 400, noConfiguration],
      ["an upload with a legal hold to a bucket without object lock", "PUT", `${B}/new`, upload({ [HOLD]: "ON" }), 400, noConfiguration],
      ["a copy with a legal hold to a bucket without object lock", "PUT", `${B}/new`, source("test-bucket/object", { [HOLD]: "ON" }), 400, noConfiguration],
      ["an upload with a lock and without Content-MD5", "PUT", `${LOCKED}/new`, { body: "x", headers: { [HOLD]: "ON" } }, 400, { Code: "InvalidRequest", Message: digest }],
      ["an upload with a retention mode and without a date", "PUT", `${LOCKED}/new`, upload({ [MODE]: "GOVERNANCE" }), 400, argument(UNTIL, "", both)],
      ["an upload with a retention date and without a mode", "PUT", `${LOCKED}/new`, upload({ [UNTIL]: FUTURE }), 400, argument(MODE, "", both)],
      ["an upload with a retention mode in lower case", "PUT", `${LOCKED}/new`, upload({ [MODE]: "governance", [UNTIL]: FUTURE }),
        400, argument(MODE, "governance", "Unknown wormMode directive.")],
      ["an upload with a retention date that is not ISO 8601", "PUT", `${LOCKED}/new`, upload({ [MODE]: "GOVERNANCE", [UNTIL]: LAST_MODIFIED }),
        400, argument(UNTIL, LAST_MODIFIED, "The retain until date must be provided in ISO 8601 format")],
      ["an upload with a retention date in the past", "PUT", `${LOCKED}/new`, upload({ [MODE]: "GOVERNANCE", [UNTIL]: MODIFIED }), 400, argument(UNTIL, MODIFIED, past)],
      ["an upload with a legal hold that is not ON or OFF", "PUT", `${LOCKED}/new`, upload({ [HOLD]: "on" }),
        400, argument(HOLD, "on", "Legal hold must be either of 'ON' or 'OFF'")],
      ["a retention mode in lower case", "PUT", `${LOCKED}/object`, retain("governance", FUTURE), 400, MALFORMED],
      ["a retention date that is not a date", "PUT", `${LOCKED}/object`, retain("GOVERNANCE", "tomorrow"), 400, MALFORMED],
      ["a retention date in the past", "PUT", `${LOCKED}/object`, retain("GOVERNANCE", MODIFIED), 400, { Code: "InvalidArgument", Message: past }],
      ["a retention document that has no end", "PUT", `${LOCKED}/object`, doc("retention", "<Retention>"), 400, MALFORMED],
      ["PutObjectRetention without a document", "PUT", `${LOCKED}/object`, doc("retention", ""), 400, NO_BODY],
      ["a legal hold that is not ON or OFF", "PUT", `${LOCKED}/object`, hold("on"), 400, MALFORMED],
      ["PutObjectLegalHold without a document", "PUT", `${LOCKED}/object`, doc("legal-hold", ""), 400, NO_BODY],
      ["GetObjectRetention for a key that does not exist", "GET", `${LOCKED}/missing`, { query: { retention: "" } }, 404, NO_KEY],
      ["PutObjectLegalHold for a key that does not exist", "PUT", `${LOCKED}/missing`, hold("ON"), 404, NO_KEY],
    ])("%s", async (_, method, path, options, status, error) => {
      const { t, state, before } = await (shared ??= fixture());
      const response = await result(t.client.fetch(method, path, options));
      const { Message, ...rest } = response.body.Error ?? {};
      const received = "Message" in error ? { Message, ...rest } : rest;
      expect({ status: response.status, error: received }).toEqual({ status, error });
      expect(state()).toBe(before);
    });
  });
});
