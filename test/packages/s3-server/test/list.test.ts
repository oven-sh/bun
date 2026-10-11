// ListObjects, ListObjectsV2 and ListObjectVersions.

import { describe, expect, test } from "bun:test";
import { isDebug } from "harness";
import { ObjectData, type ObjectVersion } from "../index.ts";
import { expectError, expectStatus, start, toObject, xml, type TestServer } from "./helpers.ts";

/** The parameters of a request: an object, or a text such as `prefix=a/&delimiter=/` for plain values. */
type Query = string | Record<string, string>;

/** Each operation is a GET of the bucket with these parameters. */
const OPERATIONS = ["", "list-type=2", "versions"];
const VERSIONED = { buckets: [{ name: "test-bucket", versioning: "Enabled" as const }] };

const TIME = new Date("2024-05-06T07:08:09.123Z");
/** S3 lists the time of an object in whole seconds. */
const LISTED = "2024-05-06T07:08:09.000Z";
const FOLDERS = "asdf boo/ boo//double boo/bar boo/baz/xyzzy boo/baz/zap bop cquux/bla cquux/thud";
const TREE = `${FOLDERS} d--e--f d--g dir/`.split(" ");
const ROOT = "asdf [boo/] bop [cquux/] d--e--f d--g [dir/]";

const md5 = (text: string) => new Bun.CryptoHasher("md5").update(text).digest("hex");
const utf8 = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const many = (value: any): any[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
/** The keys in an order that has nothing to do with the order of the list. */
const scrambled = (keys: string[]) => keys.toSorted((a, b) => Bun.hash.crc32(a) - Bun.hash.crc32(b));
const fromText = (query: Query) => (typeof query === "string" ? Object.fromEntries(new URLSearchParams(query)) : query);
const merge = (...queries: Query[]): Record<string, string> => Object.assign({}, ...queries.map(fromText));

/** Puts objects into the store without a request, in the order of the list. */
function seed(t: TestServer, keys: string[], fields: Partial<ObjectVersion> = {}): void {
  const bucket = t.server.buckets.get(t.bucket)!;
  const common = { deleteMarker: false, lastModified: TIME, owner: bucket.owner, acl: [], tags: [], userMetadata: {} };
  const metadata = { contentType: "text/plain", storageClass: "STANDARD" } as const;
  const encryption = { algorithm: "AES256" } as const;
  for (const key of keys) {
    const content = { data: new ObjectData([Buffer.from(key)]), size: Buffer.byteLength(key), etag: md5(key) };
    bucket.put({ key, ...content, ...common, ...metadata, encryption, ...fields });
  }
}

/** The version IDs of a key in the store, the newest first. */
function versionIds(t: TestServer, key: string): string[] {
  return (t.server.buckets.get(t.bucket)!.objects.get(key) ?? []).map(version => version.versionId);
}

function ownerOf(t: TestServer): { ID: string; DisplayName: string } {
  const { id, displayName } = t.server.credentials.owner;
  return { ID: id, DisplayName: displayName };
}

function get(t: TestServer, ...queries: Query[]): Promise<Response> {
  return t.client.fetch("GET", "/" + t.bucket, { query: merge(...queries) });
}

/** The response document of a list request as an object. */
async function list(t: TestServer, ...queries: Query[]): Promise<any> {
  return toObject(await xml(await expectStatus(await get(t, ...queries), 200)));
}

/** Puts the common prefixes, in brackets, between the entries. The result is the sequence of S3 as one text. */
function sequence(entries: [key: string, label: string][], prefixes: string[]): string {
  const out: string[] = [];
  let e = 0;
  let p = 0;
  while (e < entries.length || p < prefixes.length) {
    const entry = p === prefixes.length || (e < entries.length && utf8(entries[e][0], prefixes[p]) < 0);
    out.push(entry ? entries[e++][1] : `[${prefixes[p++]}]`);
  }
  return out.join(" ");
}

const keysOf = (result: any): string[] => many(result.Contents ?? result.Version).map(item => item.Key);
const prefixesOf = (result: any): string[] => many(result.CommonPrefixes).map(item => item.Prefix);

/** The keys and the common prefixes of a response, for example `asdf [boo/] bop`. */
function summary(result: any): string {
  const keys = keysOf(result).map((key): [string, string] => [key, key]);
  return sequence(keys, prefixesOf(result));
}

describe("list", () => {
  test("the keys are in the order of their UTF-8 bytes", async () => {
    const ascii = "0 9 A Z _ a a! a/ a0 aA aa z ~".split(" ");
    // JavaScript puts a character above U+FFFF before U+E000 to U+FFFF. UTF-8 puts it after them.
    const other = "\u00e9 \u07ff \u0800 \ue000 \ufffd \u{10000} \u{1f600} \u{1f600}a \u{10ffff}".split(" ");
    const ordered = [...ascii, ...other];
    expect(ordered).toEqual(ordered.toSorted(utf8));
    expect(ordered).not.toEqual(ordered.toSorted());

    await using t = start();
    seed(t, scrambled(ordered));
    for (const operation of OPERATIONS) {
      expect({ operation, keys: keysOf(await list(t, operation)) }).toEqual({ operation, keys: ordered });
      expect(keysOf(await list(t, operation, "max-keys=17"))).toEqual(ordered.slice(0, 17));
    }
    // The markers and the prefix follow the same order.
    expect(keysOf(await list(t, { marker: "\ufffd" }))).toEqual(ordered.slice(18));
    expect(keysOf(await list(t, "list-type=2", { "start-after": "\u{10000}" }))).toEqual(ordered.slice(19));
    expect(keysOf(await list(t, "versions", { "key-marker": "\uffff" }))).toEqual(ordered.slice(18));
    expect(keysOf(await list(t, "list-type=2", { prefix: "\u{1f600}" }))).toEqual(["\u{1f600}", "\u{1f600}a"]);
  });

  test.each<[query: string, entries: string, IsTruncated?: string, MaxKeys?: string]>([
    ["", TREE.join(" ")],
    ["prefix=&delimiter=", TREE.join(" ")],
    ["delimiter=/", ROOT],
    ["prefix=boo/", "boo/ boo//double boo/bar boo/baz/xyzzy boo/baz/zap"],
    // The prefix ends inside a segment of the path.
    ["prefix=bo&delimiter=/", "[boo/] bop"],
    // The prefix is a key and ends with the delimiter.
    ["prefix=boo/&delimiter=/", "boo/ [boo//] boo/bar [boo/baz/]"],
    ["prefix=boo/ba&delimiter=/", "boo/bar [boo/baz/]"],
    ["prefix=asdf&delimiter=/", "asdf"],
    ["prefix=boo/x&delimiter=/", ""],
    ["delimiter=--", `${FOLDERS} [d--] dir/`],
    ["prefix=d--&delimiter=--", "[d--e--] d--g"],
    // The delimiter in the prefix does not count.
    ["prefix=boo/&delimiter=o", "boo/ [boo//do] boo/bar boo/baz/xyzzy boo/baz/zap"],
    ["prefix=b&delimiter=a", "boo/ boo//double [boo/ba] bop"],
    ["delimiter=a&max-keys=2", "[a] boo/", "true", "2"],
    ["max-keys=0", "", "false", "0"],
    ["max-keys=1", "asdf", "true", "1"],
    ["max-keys=12", TREE.join(" "), "false", "12"],
    // A common prefix counts as one entry.
    ["max-keys=6&delimiter=/", "asdf [boo/] bop [cquux/] d--e--f d--g", "true", "6"],
    ["max-keys=7&delimiter=/", ROOT, "false", "7"],
    // The response has the limit of the server and not the value of the request.
    ["max-keys=1001", TREE.join(" ")],
    ["max-keys=2147483647&delimiter=/", ROOT],
  ])("prefix, delimiter and max-keys: %p", async (query, entries, truncated = "false", maxKeys = "1000") => {
    await using t = start();
    seed(t, scrambled(TREE));
    for (const operation of OPERATIONS) {
      const result = await list(t, operation, query);
      const { Prefix, Delimiter, IsTruncated, MaxKeys } = result;
      // The response has no Delimiter element for an empty delimiter.
      const { prefix = "", delimiter } = fromText(query);
      const root = { Prefix: prefix, Delimiter: delimiter || undefined, IsTruncated: truncated, MaxKeys: maxKeys };
      const actual = { operation, entries: summary(result), Prefix, Delimiter, IsTruncated, MaxKeys };
      expect(actual).toEqual({ operation, entries, ...root });
      const count = String(entries.split(" ").filter(Boolean).length);
      if (operation === "list-type=2") expect(result.KeyCount).toBe(count);
      if (maxKeys === "0") expect(Object.keys(result).filter(name => name.startsWith("Next"))).toEqual([]);
    }
  });

  const NEGATIVE = "Argument maxKeys must be an integer between 0 and 2147483647";
  const NOT_INTEGER = "Provided max-keys not an integer or within integer range";
  const TOKEN = "The continuation token provided is incorrect";
  const NO_KEY_MARKER = "A version-id marker cannot be specified without a key marker.";
  const tokens = ["", "nope", "1", "1YQ", "1YQ=", "1YQ==x", "1!!!!", "2YQ==", "1/w=="];
  test.each<[Query, string, string]>([
    ["max-keys=-1", "maxKeys", NEGATIVE],
    ["max-keys=-2147483648", "maxKeys", NEGATIVE],
    ["max-keys=-2147483649", "max-keys", NOT_INTEGER],
    ["max-keys=2147483648", "max-keys", NOT_INTEGER],
    ["max-keys=99999999999999999999", "max-keys", NOT_INTEGER],
    ["max-keys=1.5", "max-keys", NOT_INTEGER],
    ["max-keys=1e3", "max-keys", NOT_INTEGER],
    ["max-keys=ten", "max-keys", NOT_INTEGER],
    ["encoding-type=base64", "encoding-type", "Invalid Encoding Method specified in Request"],
    ...tokens.map((token): [Query, string, string] => [{ "continuation-token": token }, "continuation-token", TOKEN]),
    ["versions&version-id-marker=null", "version-id-marker", NO_KEY_MARKER],
    ["versions&key-marker=&version-id-marker=null", "version-id-marker", NO_KEY_MARKER],
    ["versions&key-marker=a&version-id-marker=", "version-id-marker", "A version-id marker cannot be empty."],
    ["versions&key-marker=a&version-id-marker=no", "version-id-marker", "Invalid version id specified"],
  ])("%j is InvalidArgument", async (query, ArgumentName, Message) => {
    await using t = start();
    seed(t, ["a", "b"]);
    // A parameter that each operation has is an error in each of them.
    const operations =
      ArgumentName === "continuation-token" ? ["list-type=2"] : "versions" in merge(query) ? [""] : OPERATIONS;
    for (const operation of operations) {
      const error = await expectError(await get(t, operation, query), 400, "InvalidArgument");
      const ArgumentValue = merge(query)[ArgumentName === "maxKeys" ? "max-keys" : ArgumentName];
      expect({ operation, ...error }).toMatchObject({ operation, Message, ArgumentName, ArgumentValue });
    }
  });

  test.each([
    ["delimiter=/&max-keys=2", ["asdf [boo/] > boo/", "bop [cquux/] > cquux/", "d--e--f d--g > d--g", "[dir/]"]],
    // Without a delimiter the response has no NextMarker. The client continues with the last key.
    ["max-keys=5", [TREE.slice(0, 5).join(" ") + " >", TREE.slice(5, 10).join(" ") + " >", "d--g dir/"]],
  ])("ListObjects pages with %p", async (query, expected) => {
    await using t = start();
    seed(t, scrambled(TREE));
    const pages: string[] = [];
    for (let marker = ""; pages.length <= expected.length; ) {
      const result = await list(t, query, { marker });
      const { Marker, NextMarker, IsTruncated } = result;
      expect(Marker).toBe(marker);
      // A truncated page has `>`, and then the NextMarker when the response has one.
      const next = (IsTruncated === "true" ? " >" : "") + (NextMarker === undefined ? "" : " " + NextMarker);
      pages.push(summary(result) + next);
      if (IsTruncated !== "true") break;
      marker = NextMarker ?? keysOf(result).at(-1);
    }
    expect(pages).toEqual(expected);
  });

  test.each([
    ["a common prefix", "delimiter=/", "boo/", "bop [cquux/] d--e--f d--g [dir/]"],
    // S3 leaves out the common prefix of the marker, also when keys in it are after the marker.
    ["a key inside a common prefix", "delimiter=/", "boo/bar", "bop [cquux/] d--e--f d--g [dir/]"],
    ["a key inside the last common prefix", "prefix=boo/&delimiter=/", "boo/baz/xyzzy", ""],
    ["a key", "", "boo/bar", TREE.slice(4).join(" ")],
    ["not a key of the bucket", "", "boo/bas", TREE.slice(4).join(" ")],
    ["before the first key", "delimiter=/", "a", ROOT],
    ["the last key", "", "dir/", ""],
    ["before the prefix", "prefix=cquux/", "boo", "cquux/bla cquux/thud"],
    ["inside the prefix", "prefix=cquux/", "cquux/bla", "cquux/thud"],
    ["after the prefix", "prefix=cquux/", "d", ""],
  ])("a marker that is %s", async (_, query, marker, entries) => {
    await using t = start();
    seed(t, scrambled(TREE));
    const requests = [
      ["Marker", `marker=${marker}`],
      ["StartAfter", `list-type=2&start-after=${marker}`],
      ["KeyMarker", `versions&key-marker=${marker}`],
    ];
    for (const [echo, operation] of requests) {
      const result = await list(t, operation, query);
      const actual = { marker: result[echo], entries: summary(result), IsTruncated: result.IsTruncated };
      expect({ echo, ...actual }).toEqual({ echo, marker, entries, IsTruncated: "false" });
    }
  });

  test.each([
    ["", TREE.join(" ")],
    ["delimiter=/", ROOT],
    ["prefix=boo/&delimiter=/", "boo/ [boo//] boo/bar [boo/baz/]"],
  ])("ListObjectsV2 pages through the bucket with %p", async (query, all) => {
    await using t = start();
    seed(t, scrambled(TREE));
    const entries = all.split(" ");
    for (const size of [1, 2, 3, entries.length, 1000]) {
      const pages: object[] = [];
      const expected: object[] = [];
      let token: string | undefined;
      for (let offset = 0; offset < entries.length; offset += size) {
        const continuation = token === undefined ? "" : { "continuation-token": token };
        const result = await list(t, `list-type=2&max-keys=${size}`, query, continuation);
        const { KeyCount, ContinuationToken, NextContinuationToken, IsTruncated } = result;
        const next = typeof NextContinuationToken;
        pages.push({ entries: summary(result), KeyCount, ContinuationToken, IsTruncated, next });
        // KeyCount is the number of keys and common prefixes. Only a truncated page has a token for the next one.
        const page = entries.slice(offset, offset + size);
        const last = offset + size >= entries.length;
        const flags = { IsTruncated: String(!last), next: last ? "undefined" : "string" };
        expected.push({ entries: page.join(" "), KeyCount: String(page.length), ContinuationToken: token, ...flags });
        token = NextContinuationToken;
      }
      expect({ size, pages }).toEqual({ size, pages: expected });
    }
  });

  test("ListObjectsV2 start-after, and a token with other parameters", async () => {
    await using t = start();
    seed(t, scrambled(TREE));
    const page = async (...queries: Query[]): Promise<any> => {
      const result = await list(t, "list-type=2", ...queries);
      const { StartAfter, ContinuationToken, NextContinuationToken } = result;
      return { StartAfter, ContinuationToken, entries: summary(result), next: NextContinuationToken };
    };
    const next = expect.any(String);

    const first = await page("start-after=boo/bar&max-keys=2");
    expect(first).toEqual({ StartAfter: "boo/bar", entries: "boo/baz/xyzzy boo/baz/zap", next });
    // The token has priority. The response has the start-after of the request.
    for (const StartAfter of ["boo/bar", "d", "a"]) {
      const second = await page(`start-after=${StartAfter}&max-keys=2`, { "continuation-token": first.next });
      expect(second).toEqual({ StartAfter, ContinuationToken: first.next, entries: "bop cquux/bla", next });
    }
    // The token is a position. The other parameters are the ones of the new request.
    const inside = await page("prefix=boo/&max-keys=3");
    expect(inside.entries).toBe("boo/ boo//double boo/bar");
    const token = { "continuation-token": inside.next };
    expect((await page(token, "delimiter=/")).entries).toBe("bop [cquux/] d--e--f d--g [dir/]");
    expect((await page(token, "prefix=cquux/")).entries).toBe("cquux/bla cquux/thud");
    expect((await page(token, "prefix=boo/baz/")).entries).toBe("boo/baz/xyzzy boo/baz/zap");
  });

  test.each([
    ["AZaz09-_.*/", "AZaz09-_.*/"],
    [" ", "+"],
    ["+", "%2B"],
    ["~", "%7E"],
    ["%", "%25"],
    ["test_file(3).png", "test_file%283%29.png"],
    ["!'&<>\"", "%21%27%26%3C%3E%22"],
    ["=,:;@$?#[]{}|\\^`", "%3D%2C%3A%3B%40%24%3F%23%5B%5D%7B%7D%7C%5C%5E%60"],
    ["\u00e9\u20ac\u{1f600}", "%C3%A9%E2%82%AC%F0%9F%98%80"],
    ["\u0001\t\n\r\u007f", "%01%09%0A%0D%7F"],
  ])("encoding-type=url writes %p as %p", async (raw, encoded) => {
    await using t = start();
    seed(t, [`${raw}x${raw}1`, `${raw}x${raw}2`, `${raw}y`, `${raw}z`, "0"]);
    const y = { Key: encoded + "y" };
    const next = encoded + "y";
    const requests: [Query, Query, object][] = [
      ["max-keys=2", { marker: raw }, { Marker: encoded, NextMarker: next, Contents: y }],
      ["list-type=2", { "start-after": raw }, { StartAfter: encoded, Contents: [y, { Key: encoded + "z" }] }],
      ["versions&max-keys=2", { "key-marker": raw }, { KeyMarker: encoded, NextKeyMarker: next, Version: y }],
    ];
    for (const [operation, marker, fields] of requests) {
      const result = await list(t, operation, marker, "encoding-type=url", { prefix: raw, delimiter: raw });
      const root = { Prefix: encoded, Delimiter: encoded, EncodingType: "url" };
      expect(result).toMatchObject({ ...root, CommonPrefixes: { Prefix: encoded + "x" + encoded }, ...fields });
    }
  });

  test("without encoding-type the XML parser reads each key back", async () => {
    await using t = start();
    const keys = ["a&b<c>d\"e'f", "&amp;&#65;", "]]>", "<!--x-->", " two  spaces ", "tab\there", "line\nfeed"];
    keys.push("return\rhere", "\u0001\u001f\u007f", "\ufffe\uffff", "\u00e9\u{1f600}");
    keys.sort(utf8);
    seed(t, scrambled(keys));
    for (const operation of OPERATIONS) {
      expect({ operation, keys: keysOf(await list(t, operation)) }).toEqual({ operation, keys });
    }
    const result = await list(t, "max-keys=1", { prefix: "a&b<", delimiter: ">", marker: "\n&'\"" });
    const expected = { Prefix: "a&b<", Delimiter: ">", Marker: "\n&'\"", CommonPrefixes: { Prefix: "a&b<c>" } };
    expect(result).toMatchObject(expected);
  });

  test("the fields of the root and of each entry", async () => {
    await using t = start();
    seed(t, ["plain"]);
    const value = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=-2";
    const checksum = { algorithm: "SHA256", value, type: "COMPOSITE" } as const;
    seed(t, ["sum"], { etag: md5("sum") + "-2", storageClass: "STANDARD_IA", checksum });

    const Owner = ownerOf(t);
    const entry = { LastModified: LISTED, Size: "5", StorageClass: "STANDARD" };
    // The ETag element has the quotes of the entity tag.
    const plain = { Key: "plain", ETag: `"${md5("plain")}"`, ...entry };
    const checksums = { ChecksumAlgorithm: "SHA256", ChecksumType: "COMPOSITE", StorageClass: "STANDARD_IA" };
    const sum = { ...entry, Key: "sum", ETag: `"${md5("sum")}-2"`, Size: "3", ...checksums };
    const version = { VersionId: "null", IsLatest: "true", Owner };
    const root = { Name: t.bucket, Prefix: "", MaxKeys: "1000", IsTruncated: "false" };
    const markers = { KeyMarker: "", VersionIdMarker: "" };
    const owned = [plain, sum].map(item => ({ ...item, Owner }));

    // ListObjects and ListObjectVersions have the owner always. ListObjectsV2 has it on request.
    expect(await list(t, "")).toEqual({ ...root, Marker: "", Contents: owned });
    for (const query of ["list-type=2", "list-type=2&fetch-owner=false"]) {
      expect(await list(t, query)).toEqual({ ...root, KeyCount: "2", Contents: [plain, sum] });
    }
    const all = await list(t, "versions");
    expect(all).toEqual({ ...root, ...markers, Version: owned.map(item => ({ ...item, ...version })) });

    const options = "prefix=s&delimiter=/&max-keys=7&encoding-type=url";
    const rootOfOptions = { ...root, Prefix: "s", MaxKeys: "7", Delimiter: "/", EncodingType: "url" };
    const one = { ...sum, Owner };
    expect(await list(t, options, "marker=a")).toEqual({ ...rootOfOptions, Marker: "a", Contents: one });
    const v2 = await list(t, options, "list-type=2&start-after=a&fetch-owner=true");
    expect(v2).toEqual({ ...rootOfOptions, StartAfter: "a", KeyCount: "1", Contents: one });
    const versions = await list(t, options, "versions&key-marker=plain&version-id-marker=null");
    const echo = { KeyMarker: "plain", VersionIdMarker: "null" };
    expect(versions).toEqual({ ...rootOfOptions, ...echo, Version: { ...one, ...version } });

    for (const operation of OPERATIONS) {
      const response = await get(t, operation);
      const { name, attributes } = await xml(response);
      const headers = [response.headers.get("content-type"), response.headers.get("x-amz-bucket-region")];
      const element = operation === "versions" ? "ListVersionsResult" : "ListBucketResult";
      const xmlns = "http://s3.amazonaws.com/doc/2006-03-01/";
      expect([name, attributes, headers]).toEqual([element, { xmlns }, ["application/xml", "us-east-1"]]);
    }
  });

  test("an object that a request made is in the list with the values of its headers", async () => {
    await using t = start({ clock: () => new Date("2030-01-02T03:04:05.678Z") });
    const path = `/${t.bucket}/dir/hello world.txt`;
    const headers = { "x-amz-checksum-crc32": "NhCmhg==", "x-amz-storage-class": "REDUCED_REDUNDANCY" };
    await expectStatus(await t.client.fetch("PUT", path, { body: "hello", headers }), 200);
    const head = await expectStatus(await t.client.fetch("HEAD", path), 200);
    const ETag = `"${md5("hello")}"`;
    const modified = "Wed, 02 Jan 2030 03:04:05 GMT";
    expect([head.headers.get("etag"), head.headers.get("last-modified")]).toEqual([ETag, modified]);

    const checksums = { ChecksumAlgorithm: "CRC32", ChecksumType: "FULL_OBJECT" };
    const entry = { Key: "dir/hello world.txt", LastModified: "2030-01-02T03:04:05.000Z", ETag, Size: "5" };
    const result = await list(t, "list-type=2");
    expect(result.Contents).toEqual({ ...entry, ...checksums, StorageClass: "REDUCED_REDUNDANCY" });
  });

  test.each<[string, object]>([
    ["", { Marker: "" }],
    ["list-type=2", { KeyCount: "0" }],
    ["versions", { KeyMarker: "", VersionIdMarker: "" }],
  ])("%p of an empty bucket, of a bucket that does not exist, and of another owner", async (operation, fields) => {
    await using t = start();
    const empty = { Name: t.bucket, Prefix: "", MaxKeys: "1000", IsTruncated: "false", ...fields };
    expect(await list(t, operation)).toEqual(empty);
    expect(await list(t, operation, "prefix=&delimiter=")).toEqual(empty);
    const result = await list(t, operation, "prefix=a/&delimiter=/");
    expect(result).toEqual({ ...empty, Prefix: "a/", Delimiter: "/" });

    const query = merge(operation);
    const error = await expectError(await t.client.fetch("GET", "/no-such-bucket", { query }), 404, "NoSuchBucket");
    expect(error).toMatchObject({ Message: "The specified bucket does not exist", BucketName: "no-such-bucket" });
    const headers = { "x-amz-expected-bucket-owner": "999999999999" };
    await expectError(await t.client.fetch("GET", "/" + t.bucket, { query, headers }), 403, "AccessDenied");
    headers["x-amz-expected-bucket-owner"] = t.server.credentials.owner.accountId!;
    await expectStatus(await t.client.fetch("GET", "/" + t.bucket, { query, headers }), 200);
  });

  test("a key whose newest version is a delete marker is not in ListObjects and ListObjectsV2", async () => {
    await using t = start(VERSIONED);
    seed(t, ["dir/only", "gone", "kept", "kept", "sub/a", "sub/b"]);
    for (const key of ["dir/only", "gone", "sub/a"]) {
      const response = await expectStatus(await t.client.fetch("DELETE", `/${t.bucket}/${key}`), 204);
      expect(response.headers.get("x-amz-delete-marker")).toBe("true");
    }
    for (const operation of ["", "list-type=2"]) {
      expect(summary(await list(t, operation))).toBe("kept sub/b");
      // A common prefix needs one key that has an object.
      expect(summary(await list(t, operation, "delimiter=/"))).toBe("kept [sub/]");
      const after = "max-keys=1&marker=dir/&start-after=dir/";
      const page = await list(t, operation, after);
      expect([summary(page), page.IsTruncated]).toEqual(["kept", "true"]);
      const last = await list(t, operation, after, "delimiter=/&prefix=s");
      expect([summary(last), last.IsTruncated]).toEqual(["[sub/]", "false"]);
    }
  });

  test("x-amz-optional-object-attributes: RestoreStatus", async () => {
    await using t = start();
    const expiry = new Date("2024-05-09T00:00:00.000Z");
    seed(t, ["cold"], { storageClass: "GLACIER" });
    seed(t, ["restored"], { storageClass: "GLACIER", restore: { ongoing: false, expiry } });
    seed(t, ["restoring"], { storageClass: "DEEP_ARCHIVE", restore: { ongoing: true } });
    const restored = { IsRestoreInProgress: "false", RestoreExpiryDate: "2024-05-09T00:00:00.000Z" };
    const requests: [Record<string, string>, unknown[]][] = [
      [{ "x-amz-optional-object-attributes": "RestoreStatus" }, [undefined, restored, { IsRestoreInProgress: "true" }]],
      [{}, [undefined, undefined, undefined]],
    ];
    for (const operation of OPERATIONS) {
      for (const [headers, status] of requests) {
        const response = await t.client.fetch("GET", "/" + t.bucket, { query: merge(operation), headers });
        const result = toObject(await xml(await expectStatus(response, 200)));
        const entries = many(result.Contents ?? result.Version).map(item => [item.Key, item.RestoreStatus]);
        const keys = ["cold", "restored", "restoring"];
        expect({ operation, entries }).toEqual({ operation, entries: keys.map((key, index) => [key, status[index]]) });
      }
    }
  });

  describe("ListObjectVersions", () => {
    /**
     * The entries in the sequence of the document, each as the label of its version: `b:1` is the second version
     * of `b` in the store. `D` is a delete marker and `*` is the latest version of the key. A truncated response
     * has `>` and the label of the next markers.
     */
    async function versions(t: TestServer, ...queries: Query[]): Promise<{ text: string; next: Query | undefined }> {
      const root = await xml(await expectStatus(await get(t, "versions", ...queries), 200));
      const entries = root.children
        .filter(element => element.name === "Version" || element.name === "DeleteMarker")
        .map((element): [string, string] => {
          const { Key, VersionId, IsLatest } = toObject(element);
          const flags = (element.name === "DeleteMarker" ? "D" : "") + (IsLatest === "true" ? "*" : "");
          return [Key, `${Key}:${versionIds(t, Key).indexOf(VersionId)}${flags}`];
        });
      const result = toObject(root);
      const { NextKeyMarker, NextVersionIdMarker } = result;
      let text = sequence(entries, prefixesOf(result));
      if (result.IsTruncated === "true") text += " >";
      if (NextKeyMarker === undefined) return { text, next: undefined };
      text += " " + NextKeyMarker;
      // A common prefix has no version.
      if (NextVersionIdMarker === undefined) return { text, next: { "key-marker": NextKeyMarker } };
      text += ":" + versionIds(t, NextKeyMarker).indexOf(NextVersionIdMarker);
      return { text, next: { "key-marker": NextKeyMarker, "version-id-marker": NextVersionIdMarker } };
    }

    const ALL = "a:0D* a:1 b:0* b:1 b:2 c/1:0* c/2:0* d:0*";
    /** Makes the versions of `ALL`. The newest version of `a` is a delete marker. */
    async function versioned(t: TestServer): Promise<void> {
      seed(t, ["b", "d", "c/2", "b", "a", "c/1", "b"]);
      await expectStatus(await t.client.fetch("DELETE", `/${t.bucket}/a`), 204);
    }

    test("the versions and the delete markers are one sequence, the newest version of a key first", async () => {
      await using t = start(VERSIONED);
      await versioned(t);
      const ids = ["a", "b", "c/1", "c/2", "d"].flatMap(key => versionIds(t, key));
      expect(ids).toEqual(Array(8).fill(expect.stringMatching(/^[A-Za-z0-9._-]{32}$/)));
      expect(new Set(ids).size).toBe(8);
      expect((await versions(t)).text).toBe(ALL);
      expect((await versions(t, "prefix=c/")).text).toBe("c/1:0* c/2:0*");
      expect((await versions(t, "delimiter=/")).text).toBe("a:0D* a:1 b:0* b:1 b:2 [c/] d:0*");

      const result = await list(t, "versions&prefix=a");
      const a = { Key: "a", Owner: ownerOf(t) };
      const now = expect.stringMatching(/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
      expect(result.DeleteMarker).toEqual({ ...a, VersionId: ids[0], IsLatest: "true", LastModified: now });
      const object = { ETag: `"${md5("a")}"`, Size: "1", StorageClass: "STANDARD" };
      expect(result.Version).toEqual({ ...a, VersionId: ids[1], IsLatest: "false", LastModified: LISTED, ...object });
    });

    test.each([
      ["max-keys=1000", [ALL]],
      ["max-keys=8", [ALL]],
      ["max-keys=3", ["a:0D* a:1 b:0* > b:0", "b:1 b:2 c/1:0* > c/1:0", "c/2:0* d:0*"]],
      // A page ends between two versions of a key, and a page ends with a common prefix.
      ["max-keys=2&delimiter=/", ["a:0D* a:1 > a:1", "b:0* b:1 > b:1", "b:2 [c/] > c/", "d:0*"]],
      ["max-keys=1&prefix=c/", ["c/1:0* > c/1:0", "c/2:0*"]],
      ["max-keys=1&prefix=a", ["a:0D* > a:0", "a:1"]],
    ])("pages with %p", async (query, expected) => {
      await using t = start(VERSIONED);
      await versioned(t);
      const pages: string[] = [];
      let next: Query | undefined = "";
      while (next !== undefined && pages.length <= expected.length) {
        const page = await versions(t, query, next);
        pages.push(page.text);
        next = page.next;
      }
      expect(pages).toEqual(expected);
    });

    test.each([
      // Without a version marker the list starts after all versions of the key.
      ["key-marker=a", "", "b:0* b:1 b:2 c/1:0* c/2:0* d:0*"],
      ["key-marker=b", "", "c/1:0* c/2:0* d:0*"],
      ["key-marker=a", "a:0", "a:1 b:0* b:1 b:2 c/1:0* c/2:0* d:0*"],
      ["key-marker=b", "b:0", "b:1 b:2 c/1:0* c/2:0* d:0*"],
      ["key-marker=b", "b:2", "c/1:0* c/2:0* d:0*"],
      // The version marker is for the key of the key marker only.
      ["key-marker=aa", "b:0", "b:0* b:1 b:2 c/1:0* c/2:0* d:0*"],
      ["key-marker=c/1&delimiter=/", "c/1:0", "d:0*"],
      ["key-marker=d", "d:0", ""],
    ])("%p and the version-id-marker of %p", async (query, label, expected) => {
      await using t = start(VERSIONED);
      await versioned(t);
      const [key, index] = label.split(":");
      const marker = label === "" ? "" : { "version-id-marker": versionIds(t, key)[Number(index)] };
      expect((await versions(t, query, marker)).text).toBe(expected);
      const { KeyMarker, VersionIdMarker } = await list(t, "versions", query, marker);
      const sent = merge(query, marker);
      expect([KeyMarker, VersionIdMarker]).toEqual([sent["key-marker"], sent["version-id-marker"] ?? ""]);
    });
  });

  test("Bun.S3Client.list() reads the responses", async () => {
    await using t = start();
    const odd = "k&<>\"' +~*\u00e9\u{1f600}";
    seed(t, scrambled(TREE));
    seed(t, [odd], { checksum: { algorithm: "CRC32", value: "NhCmhg==", type: "FULL_OBJECT" } });
    const { ID: id, DisplayName: displayName } = ownerOf(t);
    const entry = (key: string) => {
      const size = Buffer.byteLength(key);
      return { key, eTag: `"${md5(key)}"`, lastModified: LISTED, size, storageClass: "STANDARD" };
    };
    const root = { name: t.bucket, maxKeys: 1000, isTruncated: false };
    const s3 = (options?: Bun.S3ListObjectsOptions): Promise<any> => t.s3.list(options);

    const all = await s3();
    const checksums = { checksumAlgorithm: "CRC32", checksumType: "FULL_OBJECT" };
    expect(all).toEqual({ ...root, keyCount: 13, contents: [...TREE.map(entry), { ...entry(odd), ...checksums }] });

    // Each option in one request, and then the page that follows it.
    const options = { prefix: "boo/", delimiter: "/", maxKeys: 2, fetchOwner: true, encodingType: "url" } as const;
    const echo = { name: t.bucket, prefix: "boo/", delimiter: "/", encodingType: "url", maxKeys: 2 };
    const first = await s3({ ...options, startAfter: "boo/" });
    const continuationToken: string = first.nextContinuationToken;
    const page = { startAfter: "boo/", keyCount: 2, isTruncated: true, nextContinuationToken: expect.any(String) };
    const contents = [{ ...entry("boo/bar"), owner: { id, displayName } }];
    expect(first).toEqual({ ...echo, ...page, contents, commonPrefixes: [{ prefix: "boo//" }] });
    // The token has characters that the client must encode in the query string.
    expect(continuationToken).toMatch(/[+/=]/);
    const second = await s3({ ...options, continuationToken });
    const rest = { continuationToken, keyCount: 1, isTruncated: false, commonPrefixes: [{ prefix: "boo/baz/" }] };
    expect(second).toEqual({ ...echo, ...rest });

    const encoded = await s3({ prefix: "k", encodingType: "url" });
    expect(encoded.contents).toMatchObject([{ key: "k%26%3C%3E%22%27+%2B%7E*%C3%A9%F0%9F%98%80" }]);

    const keys: string[] = [];
    for (let token: string | undefined, page = 0; page < 13; page++) {
      const result = await s3({ maxKeys: 5, continuationToken: token });
      keys.push(...many(result.contents).map(item => item.key));
      token = result.nextContinuationToken;
      if (!result.isTruncated) break;
    }
    expect(keys).toEqual([...TREE, odd]);
    const error = { code: "InvalidArgument", message: "The continuation token provided is incorrect" };
    await expect(s3({ continuationToken: "nope" })).rejects.toMatchObject(error);
  });

  // A debug build of Bun needs too much time to write and to read the documents of 1000 keys.
  test.skipIf(isDebug)("a bucket with 2400 keys lists in pages of 1000", async () => {
    await using t = start();
    const folders = Array.from({ length: 1200 }, (_, index) => `dir${String(index).padStart(4, "0")}/`);
    const keys = folders.flatMap(folder => [folder + "a", folder + "b"]);
    seed(t, scrambled(keys));

    const pages = async (query: Query) => {
      const entries: string[] = [];
      const sizes: string[] = [];
      let token: Query = "";
      for (let page = 0; page < 5; page++) {
        const result = await list(t, "list-type=2", query, token);
        entries.push(...keysOf(result), ...prefixesOf(result));
        sizes.push(result.KeyCount);
        if (result.IsTruncated !== "true") break;
        token = { "continuation-token": result.NextContinuationToken };
      }
      return { sizes, entries };
    };
    expect(await pages("")).toEqual({ sizes: ["1000", "1000", "400"], entries: keys });
    expect(await pages("delimiter=/")).toEqual({ sizes: ["1000", "200"], entries: folders });

    // The other two operations have the same limit.
    const v1 = await list(t, "delimiter=/&max-keys=5000");
    expect(v1).toMatchObject({ MaxKeys: "1000", NextMarker: "dir0999/", IsTruncated: "true" });
    const versions = await list(t, "versions&key-marker=dir0498/b");
    const next = { NextKeyMarker: "dir0998/b", NextVersionIdMarker: "null" };
    expect(versions).toMatchObject({ MaxKeys: "1000", ...next, IsTruncated: "true" });
    expect(keysOf(versions)).toEqual(keys.slice(998, 1998));
  });
});
