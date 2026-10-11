import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { connect } from "node:net";
import { DEFAULT_CREDENTIALS, SigningClient, type S3ServerOptions } from "../index.ts";
import { expectError, start, toObject, unique, withoutDefaultType, xml, type TestServer } from "./helpers.ts";

const BUCKET = "test-bucket";
const DATE = "20240506";
const EXPIRATION = "2999-01-01T00:00:00.000Z";
const SECRET = DEFAULT_CREDENTIALS.secretAccessKey;
const TEMPORARY = { ...DEFAULT_CREDENTIALS, sessionToken: "the-session-token" };
const OTHER = {
  accessKeyId: "AKIAOTHERACCOUNT0001",
  secretAccessKey: "other-secret",
  owner: { id: Buffer.alloc(64, "b").toString(), displayName: "other", accountId: "210987654321" },
};
const ANONYMOUS_ID = "65a011a29cdf8ec533ec3d1ccaae921c";
const SIGNATURE_FIELDS = ["X-Amz-Signature", "X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date"];
const NO_SIGNATURE = Object.fromEntries(SIGNATURE_FIELDS.map(name => [name.toLowerCase(), undefined]));
const BOUNDARY = "----post-object-test";
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

type Fields = Record<string, string>;
/** The test compares the message and the details when the row has a message. */
type Failure = [status: number, code: string, message?: unknown, details?: Record<string, unknown>];

interface Upload {
  /** The fields before the file. `key` has a default. */
  fields?: Fields;
  /** A string is a part without a file name. */
  file?: string | Blob;
  afterFile?: Fields;
  /** A form without a policy and without a signature. */
  anonymous?: boolean;
  credential?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  region?: string;
  /** The credential scope, in the place of `<date>/<region>/s3/aws4_request`. */
  scope?: string;
  expiration?: string;
  /** Conditions in addition to the ones that accept the bucket and each field of the form. */
  conditions?: unknown[];
  /** The names of fields, or `bucket`, that get no condition. */
  uncovered?: string[];
  /** The policy document, in the place of the one with `expiration` and `conditions`. A string is its text. */
  policy?: unknown;
  /** The value of the `policy` field, in the place of the base64 of the document. */
  encodedPolicy?: string;
  /** Changes to the fields after the signature. `undefined` removes a field. */
  change?: Record<string, string | undefined>;
  rename?: (name: string) => string;
  /** The `Host` header of a virtual-hosted request. */
  host?: string;
  server?: S3ServerOptions;
}

function sign(secretAccessKey: string, region: string, policy: string): string {
  let key: string | Buffer = "AWS4" + secretAccessKey;
  for (const part of [DATE, region, "s3", "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
  return createHmac("sha256", key).update(policy).digest("hex");
}

function formFields(upload: Upload): Fields {
  const fields: Fields = { key: unique(), ...upload.fields };
  if (!upload.anonymous) {
    const credential: NonNullable<Upload["credential"]> = upload.credential ?? DEFAULT_CREDENTIALS;
    const region = upload.region ?? "us-east-1";
    fields["x-amz-algorithm"] = "AWS4-HMAC-SHA256";
    fields["x-amz-credential"] = `${credential.accessKeyId}/${upload.scope ?? `${DATE}/${region}/s3/aws4_request`}`;
    fields["x-amz-date"] = DATE + "T070809Z";
    if (credential.sessionToken !== undefined) fields["x-amz-security-token"] = credential.sessionToken;

    const covered = Object.keys(fields).filter(name => !upload.uncovered?.includes(name));
    const conditions = [
      ...(upload.uncovered?.includes("bucket") ? [] : [{ bucket: BUCKET }]),
      ...covered.map(name => ["starts-with", "$" + name, ""]),
      ...(upload.conditions ?? []),
    ];
    const document = upload.policy ?? { expiration: upload.expiration ?? EXPIRATION, conditions };
    const text = typeof document === "string" ? document : JSON.stringify(document);
    fields.policy = upload.encodedPolicy ?? Buffer.from(text).toString("base64");
    fields["x-amz-signature"] = sign(credential.secretAccessKey, region, fields.policy);
  }
  for (const [name, value] of Object.entries(upload.change ?? {})) {
    if (value === undefined) delete fields[name];
    else fields[name] = value;
  }
  return fields;
}

async function post(t: TestServer, upload: Upload = {}): Promise<Response> {
  const rename = upload.rename ?? (name => name);
  const form = new FormData();
  for (const [name, value] of Object.entries(formFields(upload))) form.append(rename(name), value);
  form.append(rename("file"), upload.file ?? new File(["content"], "upload.txt"));
  for (const [name, value] of Object.entries(upload.afterFile ?? {})) form.append(name, value);
  const url = upload.host === undefined ? `${t.server.url}/${BUCKET}` : t.server.url;
  const headers: Fields = upload.host === undefined ? {} : { host: upload.host };
  return withoutDefaultType(await fetch(url, { method: "POST", headers, body: form, redirect: "manual" }));
}

/** A form body. The parts with a name in `files` have a file name. */
function multipart(fields: Fields, close = true, files = ["file"]): string {
  const parts = Object.entries(fields).map(([name, value]) => {
    const file = files.includes(name) ? `; filename="${name}.txt"` : "";
    return `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"${file}\r\n\r\n${value}\r\n`;
  });
  return parts.join("") + (close ? `--${BOUNDARY}--\r\n` : "");
}

async function expectFailure(response: Response, [status, code, message, details]: Failure): Promise<void> {
  const error = await expectError(response, status, code);
  if (message === undefined) return;
  const ids = { RequestId: expect.any(String), HostId: expect.any(String) };
  expect<unknown>(error).toEqual({ Code: code, Message: message, ...details, ...ids });
}

async function expectResult(response: Response, expected: Failure | number): Promise<void> {
  if (typeof expected !== "number") return expectFailure(response, expected);
  expect({ status: response.status, body: await response.text() }).toEqual({ status: expected, body: "" });
}

async function makePublic(t: TestServer): Promise<void> {
  const headers = { "x-amz-acl": "public-read-write" };
  expect((await t.client.fetch("PUT", `/${BUCKET}`, { query: { acl: "" }, headers })).status).toBe(200);
}

/** The owner of the object, as ListObjects reports it. */
async function ownerOf(t: TestServer, key: string): Promise<string> {
  const response = await t.client.fetch("GET", `/${BUCKET}`, { query: { prefix: key } });
  return toObject(await xml(response)).Contents.Owner.ID;
}

function md5(data: string | Uint8Array): string {
  return new Bun.CryptoHasher("md5").update(data).digest("hex");
}

function pick(headers: Headers, names: string[]): Record<string, string | null> {
  return Object.fromEntries(names.map(name => [name, headers.get(name)]));
}

function text(size: number): string {
  return Buffer.alloc(size, "a").toString();
}

const DENIED: Failure = [403, "AccessDenied", "Access Denied"];
const violation = (detail: string): Failure => [403, "AccessDenied", "Invalid according to Policy: " + detail];
const failed = (condition: string) => violation("Policy Condition failed: " + condition);
const extra = (name: string) => violation("Extra input fields: " + name);
const argument = (message: string, name: string, value = ""): Failure => {
  return [400, "InvalidArgument", message, { ArgumentName: name, ArgumentValue: value }];
};
const ORDER = "If it is specified, please check the order of the fields.";
const missing = (name: string) => argument(`Bucket POST must contain a field named '${name}'.  ${ORDER}`, name);
/** S3 documents the code. The text after "Invalid Policy" is exact in the rows that give it. */
const badPolicy = (detail?: string): Failure => {
  const message = detail === undefined ? expect.stringMatching(/^Invalid Policy: /) : "Invalid Policy: " + detail;
  return [400, "InvalidPolicyDocument", message];
};
const badScope = (message: unknown = expect.any(String), details?: Fields): Failure => {
  return [400, "AuthorizationQueryParametersError", message, details];
};
const tooLarge = (size: number, limit: number): Failure => {
  const details = { ProposedSize: String(size), MaxSizeAllowed: String(limit) };
  return [400, "EntityTooLarge", "Your proposed upload exceeds the maximum allowed size", details];
};

// The example of the S3 documentation, "Browser-Based Upload using HTTP POST (Using AWS Signature Version 4)".
const EXAMPLE_POLICY =
  "eyAiZXhwaXJhdGlvbiI6ICIyMDE1LTEyLTMwVDEyOjAwOjAwLjAwMFoiLA0KICAiY29uZGl0aW9ucyI6IFsNCiAgICB7ImJ1Y2tldCI6ICJzaWd2NGV4YW1wbGVidWNrZXQifSwNCiAgICBbInN0YXJ0cy13aXRoIiwgIiRrZXkiLCAidXNlci91c2VyMS8iXSwNCiAgICB7ImFjbCI6ICJwdWJsaWMtcmVhZCJ9LA0KICAgIHsic3VjY2Vzc19hY3Rpb25fcmVkaXJlY3QiOiAiaHR0cDovL3NpZ3Y0ZXhhbXBsZWJ1Y2tldC5zMy5hbWF6b25hd3MuY29tL3N1Y2Nlc3NmdWxfdXBsb2FkLmh0bWwifSwNCiAgICBbInN0YXJ0cy13aXRoIiwgIiRDb250ZW50LVR5cGUiLCAiaW1hZ2UvIl0sDQogICAgeyJ4LWFtei1tZXRhLXV1aWQiOiAiMTQzNjUxMjM2NTEyNzQifSwNCiAgICB7IngtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24iOiAiQUVTMjU2In0sDQogICAgWyJzdGFydHMtd2l0aCIsICIkeC1hbXotbWV0YS10YWciLCAiIl0sDQoNCiAgICB7IngtYW16LWNyZWRlbnRpYWwiOiAiQUtJQUlPU0ZPRE5ON0VYQU1QTEUvMjAxNTEyMjkvdXMtZWFzdC0xL3MzL2F3czRfcmVxdWVzdCJ9LA0KICAgIHsieC1hbXotYWxnb3JpdGhtIjogIkFXUzQtSE1BQy1TSEEyNTYifSwNCiAgICB7IngtYW16LWRhdGUiOiAiMjAxNTEyMjlUMDAwMDAwWiIgfQ0KICBdDQp9";
const EXAMPLE_REDIRECT = "http://sigv4examplebucket.s3.amazonaws.com/successful_upload.html";
const EXAMPLE_FIELDS = {
  "key": "user/user1/${filename}",
  "acl": "public-read",
  "success_action_redirect": EXAMPLE_REDIRECT,
  "Content-Type": "image/jpeg",
  "x-amz-meta-uuid": "14365123651274",
  "x-amz-server-side-encryption": "AES256",
  "X-Amz-Credential": "AKIAIOSFODNN7EXAMPLE/20151229/us-east-1/s3/aws4_request",
  "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
  "X-Amz-Date": "20151229T000000Z",
  "x-amz-meta-tag": "",
  "Policy": EXAMPLE_POLICY,
  "X-Amz-Signature": "8afdbf4008c03f22c2cd3cdb72e4afbb1f6a588f3255ac628749a66d7f09699e",
};

describe("PostObject", () => {
  test("accepts the form of the example in the S3 documentation", async () => {
    await using t = start({ buckets: ["sigv4examplebucket"], clock: () => new Date("2015-12-29T12:00:00Z") });
    const form = new FormData();
    for (const [name, value] of Object.entries(EXAMPLE_FIELDS)) form.append(name, value);
    form.append("file", new File(["jpeg"], "photo.jpg"));
    form.append("submit", "Upload to Amazon S3");
    const headers = { host: "sigv4examplebucket.s3.amazonaws.com" };
    const response = await fetch(t.server.url, { method: "POST", headers, body: form, redirect: "manual" });
    const result = `bucket=sigv4examplebucket&key=user%2Fuser1%2Fphoto.jpg&etag=%22${md5("jpeg")}%22`;
    expect(pick(response.headers, ["location"])).toEqual({ location: `${EXAMPLE_REDIRECT}?${result}` });
    expect(response.status).toBe(303);
    const object = await fetch(`${t.server.url}/user/user1/photo.jpg`, { headers });
    const properties = { "content-type": "image/jpeg", "x-amz-meta-uuid": "14365123651274" };
    expect([object.status, pick(object.headers, Object.keys(properties))]).toEqual([200, properties]);
  });

  test("stores the file with the properties that the form has", async () => {
    await using t = start({ buckets: [{ name: BUCKET, versioning: "Enabled" }] });
    const key = `photos/2024/${unique()} ü.txt`;
    const content = Buffer.from(Array.from({ length: 512 }, (_, index) => index % 256));
    const properties = {
      "content-type": "text/plain",
      "cache-control": "max-age=60",
      "content-disposition": "attachment",
      "content-encoding": "identity",
      "expires": "Wed, 21 Oct 2037 07:28:00 GMT",
      "x-amz-meta-color": "green",
      "x-amz-storage-class": "STANDARD_IA",
      "x-amz-website-redirect-location": "/other",
    };
    const tagging = "<Tagging><TagSet><Tag><Key>a</Key><Value>1</Value></Tag></TagSet></Tagging>";
    const fields = { key, acl: "public-read", tagging, ...properties };
    const response = await post(t, {
      fields,
      file: new File([content], "upload.bin", { type: "image/png" }),
      uncovered: Object.keys(fields),
      conditions: Object.entries(fields).map(([name, value]) => ({ [name]: value })),
    });
    expect({ status: response.status, body: await response.text() }).toEqual({ status: 204, body: "" });

    const path = `/${BUCKET}/${key}`;
    const object = await t.client.fetch("GET", path);
    expect({
      status: object.status,
      body: Buffer.from(await object.arrayBuffer()).equals(content),
      headers: pick(object.headers, [...Object.keys(properties), "etag"]),
    }).toEqual({ status: 200, body: true, headers: { ...properties, etag: `"${md5(content)}"` } });
    const names = ["etag", "location", "x-amz-version-id", "x-amz-server-side-encryption"];
    expect(pick(response.headers, names)).toEqual({
      "etag": `"${md5(content)}"`,
      // S3 encodes each slash of the key in the location.
      "location": `${t.server.url}/${BUCKET}/${encodeURIComponent(key)}`,
      "x-amz-version-id": object.headers.get("x-amz-version-id"),
      "x-amz-server-side-encryption": "AES256",
    });
    expect(response.headers.get("x-amz-version-id")).toMatch(/^[A-Za-z0-9]{32}$/);

    const tags = await t.client.fetch("GET", path, { query: { tagging: "" } });
    expect(toObject(await xml(tags))).toEqual({ TagSet: { Tag: { Key: "a", Value: "1" } } });
    expect((await fetch(t.server.url + encodeURI(path))).status).toBe(200);
    expect(await ownerOf(t, key)).toBe(t.server.credentials.owner.id);
    expect(t.server.requests[0]).toMatchObject({ operation: "PostObject", bucket: BUCKET, key, status: 204 });
  });

  test.each<[string, Fields, number, "empty" | "document" | "redirect"]>([
    ["no field", {}, 204, "empty"],
    ["success_action_status 200", { success_action_status: "200" }, 200, "empty"],
    ["success_action_status 201", { success_action_status: "201" }, 201, "document"],
    ["success_action_status 204", { success_action_status: "204" }, 204, "empty"],
    ["a status that S3 does not have", { success_action_status: "404" }, 204, "empty"],
    ["success_action_redirect", { success_action_redirect: "https://example.com/done" }, 303, "redirect"],
    ["a redirect with a query", { success_action_redirect: "http://example.com/?a=b" }, 303, "redirect"],
    ["redirect, the old name", { redirect: "http://example.com/old", success_action_status: "201" }, 303, "redirect"],
    ["a redirect that is not a URL", { redirect: "not a url", success_action_status: "201" }, 201, "document"],
    ["a redirect that is not HTTP", { success_action_redirect: "ftp://example.com/" }, 204, "empty"],
  ])("the response for %s", async (_, fields, status, kind) => {
    await using t = start();
    const key = `dir/${unique()}`;
    const response = await post(t, { fields: { key, ...fields }, file: "abc" });
    const etag = `"${md5("abc")}"`;
    const location = `${t.server.url}/${BUCKET}/${encodeURIComponent(key)}`;
    const redirect = fields.success_action_redirect ?? fields.redirect;
    const result = `bucket=${BUCKET}&key=${encodeURIComponent(key)}&etag=${encodeURIComponent(etag)}`;
    const body = await response.text();
    expect({
      status: response.status,
      headers: pick(response.headers, ["etag", "location", "x-amz-version-id", "content-type"]),
      body: kind === "document" ? toObject(await xml(new Response(body))) : body,
    }).toEqual({
      status,
      headers: {
        "etag": etag,
        "location": kind === "redirect" ? redirect + (redirect.includes("?") ? "&" : "?") + result : location,
        "x-amz-version-id": null,
        "content-type": kind === "document" ? "application/xml" : null,
      },
      body: kind === "document" ? { Location: location, Bucket: BUCKET, Key: key, ETag: etag } : "",
    });
    if (kind === "document") expect(body).toContain("?>\n<PostResponse><Location>");
    expect(await t.s3.file(key).text()).toBe("abc");
  });

  test("the location of a virtual-hosted request has the bucket in the host", async () => {
    await using t = start();
    const host = `${BUCKET}.localhost:${t.server.port}`;
    const response = await post(t, { fields: { key: "a/b c", success_action_status: "201" }, host });
    const location = `http://${host}/a%2Fb%20c`;
    expect(pick(response.headers, ["location"])).toEqual({ location });
    expect(toObject(await xml(response))).toMatchObject({ Location: location, Bucket: BUCKET, Key: "a/b c" });
  });

  const NOT_FORM_DATA = "Bucket POST must be of the enclosure-type multipart/form-data";
  const PRECONDITION = "At least one of the pre-conditions you specified did not hold";
  const NOT_MULTIPART: Failure = [412, "PreconditionFailed", PRECONDITION, { Condition: NOT_FORM_DATA }];
  const MALFORMED_MESSAGE = "The body of your POST request is not well-formed multipart/form-data.";
  const MALFORMED: Failure = [400, "MalformedPOSTRequest", MALFORMED_MESSAGE];
  const NO_FILE = argument("POST requires exactly one file upload per request.", "file", "0");
  const EMPTY_KEY = argument("User key must have a length greater than 0.", "key");
  const LONG_KEY: Failure = [400, "KeyTooLongError", "Your key is too long", { Size: "1025", MaxSizeAllowed: "1024" }];
  const LARGE_FIELDS: Failure = [400, "MaxPostPreDataLengthExceededError"];
  const NO_BUCKET: Failure = [404, "NoSuchBucket", "The specified bucket does not exist", { BucketName: "nowhere" }];
  const NOT_ALLOWED = "The specified method is not allowed against this resource.";
  const OBJECT_URL: Failure = [405, "MethodNotAllowed", NOT_ALLOWED, { Method: "POST", ResourceType: "OBJECT" }];
  test.each<[string, { path?: string; type?: string | null; body?: string }, Failure]>([
    ["a form that is URL-encoded", { type: "application/x-www-form-urlencoded", body: "key=k" }, NOT_MULTIPART],
    ["a content type that is not form-data", { type: "multipart/mixed; boundary=" + BOUNDARY }, NOT_MULTIPART],
    ["a request without a content type", { type: null }, NOT_MULTIPART],
    ["a content type without a boundary", { type: "multipart/form-data" }, MALFORMED],
    ["a body that is not multipart", { body: "key=k&file=x" }, MALFORMED],
    ["a body without the last boundary", { body: multipart({ key: "k", file: "x" }, false) }, MALFORMED],
    ["an empty body", { body: "" }, MALFORMED],
    ["a form without a file", { body: multipart({ key: "k" }) }, NO_FILE],
    ["a form without a key", { body: multipart({ file: "x" }) }, missing("key")],
    ["a key after the file", { body: multipart({ file: "x", key: "k" }) }, missing("key")],
    ["an empty key", { body: multipart({ key: "", file: "x" }) }, EMPTY_KEY],
    ["a key of 1025 bytes", { body: multipart({ key: text(1025), file: "x" }) }, LONG_KEY],
    ["fields of 20 KB", { body: multipart({ "x-ignore-a": text(20000), "file": "x" }) }, LARGE_FIELDS],
    ["a bucket that does not exist", { path: "/nowhere" }, NO_BUCKET],
    ["the URL of an object", { path: `/${BUCKET}/key` }, OBJECT_URL],
  ])("refuses %s", async (_, { path = `/${BUCKET}`, type = MULTIPART, body }, failure) => {
    await using t = start();
    await makePublic(t);
    const headers: Fields = type === null ? {} : { "content-type": type };
    body ??= multipart({ key: "k", file: "x" });
    const response = await fetch(t.server.url + path, { method: "POST", headers, body: Buffer.from(body) });
    await expectFailure(response, failure);
    expect(t.server.buckets.get(BUCKET)!.isEmpty).toBe(true);
  });

  test("reads the fields before the file, with names in each case", async () => {
    await using t = start();
    const key = unique();
    const response = await post(t, {
      fields: { key, "Content-Type": "text/css", "x-ignore-this": "no condition" },
      uncovered: ["x-ignore-this"],
      conditions: [["StArTs-WiTh", "$KeY", key.slice(0, 4)], { "CONTENT-type": "text/css" }, { bUcKeT: BUCKET }],
      rename: name => name.toUpperCase(),
      afterFile: { "key": "other", "Content-Type": "text/html", "acl": "not an acl", "no-condition": "1" },
    });
    expect(response.status).toBe(204);
    expect((await t.s3.file(key).stat()).type).toBe("text/css");
    expect(t.server.buckets.get(BUCKET)!.sortedKeys()).toEqual([key]);
  });

  test.each<[string, string | Blob, string]>([
    ["the name of the file", new File(["1"], "report.pdf"), "report.pdf"],
    ["the name after the last slash or backslash", new File(["2"], "a/b\\c.txt"), "c.txt"],
    ["empty for a file that has no name", "3", ""],
  ])("${filename} is %s", async (_, file, name) => {
    await using t = start();
    const fields = { "key": "in/${filename}", "x-amz-meta-names": "${filename},${filename}" };
    // The conditions see the value after the replacement.
    const upload = { fields, file, uncovered: ["key"] };
    expect((await post(t, { ...upload, conditions: [{ key: "in/" + name }] })).status).toBe(204);
    const object = await t.client.fetch("HEAD", `/${BUCKET}/in/${name}`);
    expect([object.status, object.headers.get("x-amz-meta-names")]).toEqual([200, `${name},${name}`]);
    const literal = await post(t, { ...upload, conditions: [{ key: fields.key }] });
    await expectFailure(literal, failed('["eq", "$key", "in/${filename}"]'));
  });

  test("accepts a field that is a file part and a file that is a text part", async () => {
    await using t = start();
    await makePublic(t);
    const fields = { "key": "as-file", "Content-Type": "text/x-test", "file": "" };
    const body = multipart(fields, true, ["key", "Content-Type"]);
    const headers = { "content-type": MULTIPART };
    const response = await fetch(`${t.server.url}/${BUCKET}`, { method: "POST", headers, body });
    expect([response.status, response.headers.get("etag")]).toEqual([204, `"${md5("")}"`]);
    // The object of an anonymous upload belongs to the anonymous user.
    const object = await fetch(`${t.server.url}/${BUCKET}/as-file`);
    expect([object.status, object.headers.get("content-type"), await object.text()]).toEqual([200, "text/x-test", ""]);
  });

  const UNKNOWN_MESSAGE = "The AWS Access Key Id you provided does not exist in our records.";
  const unknownKey = (key: string): Failure => [403, "InvalidAccessKeyId", UNKNOWN_MESSAGE, { AWSAccessKeyId: key }];
  const TOKEN_MESSAGE = "The provided token is malformed or otherwise invalid.";
  const badToken = (token: string): Failure => [400, "InvalidToken", TOKEN_MESSAGE, { "Token-0": token }];
  const VERSION_4 = "The authorization mechanism you have provided is not supported. Please use AWS4-HMAC-SHA256.";
  const REGION = "the region 'us-east-1' is wrong; expecting 'eu-west-1'";
  const WRONG_REGION = badScope("Error parsing the X-Amz-Credential parameter; " + REGION, { Region: "eu-west-1" });
  const europe = { region: "eu-west-1" };
  const temporary = { credentials: TEMPORARY };
  const version2 = { ...NO_SIGNATURE, signature: "c2lnbmF0dXJl" };
  test.each<[string, Upload, Failure | number]>([
    ["an unknown access key", { credential: { ...OTHER, accessKeyId: "AKIAUNKNOWN" } }, unknownKey("AKIAUNKNOWN")],
    ["a form without a policy", { change: { policy: undefined } }, missing("policy")],
    ...SIGNATURE_FIELDS.map((name): [string, Upload, Failure] => [
      `a form without ${name}`,
      { change: { [name.toLowerCase()]: undefined } },
      missing(name),
    ]),
    ["a policy without a signature", { change: NO_SIGNATURE }, DENIED],
    ["Signature Version 2", { change: { ...version2, AWSAccessKeyId: "AKIA" } }, [400, "InvalidRequest", VERSION_4]],
    ["Signature Version 2 without an access key", { change: version2 }, missing("AWSAccessKeyId")],
    ["another algorithm", { change: { "x-amz-algorithm": "AWS4-HMAC-SHA1" } }, badScope()],
    ["a credential without a date", { scope: "us-east-1/s3/aws4_request" }, badScope()],
    ["a credential for another service", { scope: `${DATE}/us-east-1/ec2/aws4_request` }, badScope()],
    ["a credential for another day than x-amz-date", { scope: "20240507/us-east-1/s3/aws4_request" }, badScope()],
    ["x-amz-date in another format", { change: { "x-amz-date": "2024-05-06T07:08:09Z" } }, badScope()],
    ["each region, for a server without a region", { region: "ap-south-1" }, 204],
    ["the region of the server", { region: "eu-west-1", server: europe }, 204],
    ["another region than the region of the server", { region: "us-east-1", server: europe }, WRONG_REGION],
    ["temporary credentials with their token", { credential: TEMPORARY, server: temporary }, 204],
    ["temporary credentials without a token", { server: temporary }, unknownKey(TEMPORARY.accessKeyId)],
    ["another token", { credential: { ...TEMPORARY, sessionToken: "other" }, server: temporary }, badToken("other")],
    ["a token for credentials that have none", { credential: TEMPORARY }, badToken(TEMPORARY.sessionToken)],
    ["an anonymous form for a private bucket", { anonymous: true }, DENIED],
  ])("authentication: %s", async (_, upload, expected) => {
    await using t = start(upload.server);
    await expectResult(await post(t, upload), expected);
  });

  const MISMATCH = "The request signature we calculated does not match the signature you provided.";
  test.each<[string, (policy: string) => Fields]>([
    ["with another secret key", policy => ({ "x-amz-signature": sign("another secret", "us-east-1", policy) })],
    ["with the key of another region", policy => ({ "x-amz-signature": sign(SECRET, "us-west-2", policy) })],
    ["of the policy and not of its base64", policy => ({ "x-amz-signature": sign(SECRET, "us-east-1", atob(policy)) })],
    ["of another policy", policy => ({ policy: btoa(atob(policy).replace("2999", "3000")) })],
  ])("refuses a signature %s", async (_, change) => {
    await using t = start();
    const form = formFields({});
    Object.assign(form, change(form.policy));
    const hex = Buffer.from(form.policy).toString("hex");
    const details = {
      AWSAccessKeyId: DEFAULT_CREDENTIALS.accessKeyId,
      StringToSign: form.policy,
      SignatureProvided: form["x-amz-signature"],
      StringToSignBytes: hex.replace(/(..)(?=.)/g, "$1 "),
    };
    const message = MISMATCH + " Check your key and signing method.";
    await expectFailure(await post(t, { change: form }), [403, "SignatureDoesNotMatch", message, details]);
  });

  const ONE_PROPERTY = "Invalid Simple-Condition: Simple-Conditions must have exactly one property specified.";
  const badExpiration = (expiration: string): [string, Upload, Failure] => {
    return [`the expiration ${expiration}`, { expiration }, badPolicy(`Invalid 'expiration' value: '${expiration}'`)];
  };
  test.each<[string, Upload, Failure]>([
    ["a policy that is not base64", { encodedPolicy: "{policy}" }, badPolicy("Invalid JSON.")],
    ["a policy that is not JSON", { policy: "expiration" }, badPolicy("Invalid JSON.")],
    ["a policy that is not an object", { policy: [] }, badPolicy("Invalid JSON.")],
    badExpiration("2999-01-01 00:00:00"),
    badExpiration("2999-01-01T00:00:00+00:00"),
    badExpiration("2999-02-30T00:00:00Z"),
    badExpiration("tomorrow"),
    ["no expiration", { policy: { conditions: [] } }, badPolicy()],
    ["no conditions", { policy: { expiration: EXPIRATION } }, badPolicy()],
    ["EXPIRATION in uppercase", { policy: { EXPIRATION, conditions: [] } }, badPolicy()],
    ["CONDITIONS in uppercase", { policy: { expiration: EXPIRATION, CONDITIONS: [] } }, badPolicy()],
    ["an expiration that is a number", { policy: { expiration: 32503680000, conditions: [] } }, badPolicy()],
    ["conditions that are not a list", { policy: { expiration: EXPIRATION, conditions: {} } }, badPolicy()],
    ["a condition without a property", { conditions: [{}] }, badPolicy(ONE_PROPERTY)],
    ["a condition with two properties", { conditions: [{ acl: "private", key: "k" }] }, badPolicy(ONE_PROPERTY)],
    ["a condition with a value that is not text", { conditions: [{ acl: 1 }] }, badPolicy()],
    ["a condition that is text", { conditions: ["bucket"] }, badPolicy()],
    ["a list without a value", { conditions: [["eq", "$key"]] }, badPolicy()],
    ["an operation that S3 does not have", { conditions: [["ends-with", "$key", "x"]] }, badPolicy()],
    ["a range without a maximum", { conditions: [["content-length-range", 0]] }, badPolicy()],
    ["a range with a negative size", { conditions: [["content-length-range", -1, 0]] }, badPolicy()],
    ["a range with a size that is not a number", { conditions: [["content-length-range", 0, "x"]] }, badPolicy()],
  ])("policy document: %s", async (_, upload, failure) => {
    await using t = start();
    await expectFailure(await post(t, upload), failure);
  });

  test("the policy is valid until its expiration", async () => {
    let now = new Date("2024-05-06T07:08:09Z");
    await using t = start({ clock: () => now });
    const key = unique();
    expect((await post(t, { fields: { key }, expiration: "2024-05-06T07:08:10Z" })).status).toBe(204);
    const object = await t.client.fetch("HEAD", `/${BUCKET}/${key}`);
    expect(object.headers.get("last-modified")).toBe("Mon, 06 May 2024 07:08:09 GMT");
    now = new Date("2024-05-06T07:08:11Z");
    await expectFailure(await post(t, { expiration: "2024-05-06T07:08:10Z" }), violation("Policy expired."));
  });

  const range = ["content-length-range", 5, 10];
  const TOO_SMALL = "Your proposed upload is smaller than the minimum allowed size";
  const tooSmall: Failure = [400, "EntityTooSmall", TOO_SMALL, { ProposedSize: "4", MinSizeAllowed: "5" }];
  const images = ["starts-with", "$Content-Type", "image/"];
  const IMAGES = '["starts-with", "$Content-Type", "image/"]';
  const type = (value: string): Upload => ({ fields: { "Content-Type": value }, conditions: [images] });
  test.each<[string, Upload, Failure | number]>([
    ["eq that holds", { fields: { acl: "private" }, conditions: [{ acl: "private" }] }, 204],
    ["eq in a list", { fields: { key: "a/b" }, conditions: [["eq", "$key", "a/c"]] }, failed('["eq", "$key", "a/c"]')],
    ["eq in an object", { fields: { acl: "private" }, conditions: [{ acl: "x" }] }, failed('["eq", "$acl", "x"]')],
    ["eq and another case", { fields: { key: "A" }, conditions: [{ Key: "a" }] }, failed('["eq", "$Key", "a"]')],
    ["eq for a field that the form does not have", { conditions: [{ acl: "x" }] }, failed('["eq", "$acl", "x"]')],
    ["eq without $", { fields: { key: "k" }, conditions: [["eq", "key", "k"]] }, failed('["eq", "key", "k"]')],
    ["another bucket", { uncovered: ["bucket"], conditions: [{ bucket: "b" }] }, failed('["eq", "$bucket", "b"]')],
    ["starts-with that holds", type("image/png"), 204],
    ["starts-with for a value without the prefix", type("text/html"), failed(IMAGES)],
    ["starts-with for a list of content types", type("image/png, image/gif"), 204],
    ["starts-with for a list with another content type", type("image/png,text/html"), failed(IMAGES)],
    ["an empty prefix for a field that the form does not have", { conditions: [["starts-with", "$acl", ""]] }, 204],
    ["a field without a condition", { fields: { Expires: "0" }, uncovered: ["Expires"] }, extra("expires")],
    ["a key without a condition", { uncovered: ["key"] }, extra("key")],
    ["x-amz-date without a condition", { uncovered: ["x-amz-date"] }, extra("x-amz-date")],
    ["a policy without a condition for the bucket", { uncovered: ["bucket"] }, extra("bucket")],
    ["an x-ignore- field without a condition", { fields: { "X-Ignore-Me": "1" }, uncovered: ["X-Ignore-Me"] }, 204],
    ["a file of the minimum size", { file: "12345", conditions: [range] }, 204],
    ["a file of the maximum size, with sizes in text", { file: text(10), conditions: [[range[0], "5", "10"]] }, 204],
    ["a file that is too small", { file: "1234", conditions: [range] }, tooSmall],
    ["a file that is too large", { file: new File([text(11)], "f"), conditions: [range] }, tooLarge(11, 10)],
  ])("policy conditions: %s", async (_, upload, expected) => {
    await using t = start();
    await expectResult(await post(t, upload), expected);
    expect(t.server.buckets.get(BUCKET)!.isEmpty).toBe(typeof expected !== "number");
  });

  const sha256 = { "x-amz-checksum-sha256": new Bun.CryptoHasher("sha256").update("content").digest("base64") };
  const crc32 = { "x-amz-checksum-crc32": "/sUwqQ==" };
  const SSE = "x-amz-server-side-encryption";
  const kms = { [SSE]: "aws:kms", [SSE + "-aws-kms-key-id"]: "arn:aws:kms:us-east-1:123456789012:key/1234abcd" };
  const customerKey = {
    [SSE + "-customer-algorithm"]: "AES256",
    [SSE + "-customer-key"]: btoa(text(32)),
    [SSE + "-customer-key-MD5"]: Buffer.from(md5(text(32)), "hex").toString("base64"),
  };
  const BAD_DIGEST: Failure = [400, "BadDigest", "The SHA256 you specified did not match the calculated checksum."];
  // A row without a message has the message of the code that PutObject uses too.
  test.each<[string, Fields, Failure | Fields]>([
    ["a checksum", sha256, sha256],
    ["a checksum algorithm", { "x-amz-checksum-algorithm": "sha256" }, sha256],
    ["a checksum with its algorithm", { "x-amz-checksum-algorithm": "CRC32", ...crc32 }, crc32],
    ["encryption with a KMS key", kms, kms],
    ["a checksum of another content", { "x-amz-checksum-sha256": btoa(text(32)) }, BAD_DIGEST],
    ["a checksum that is not a digest", { "x-amz-checksum-sha256": "sailorjerry" }, [400, "InvalidRequest"]],
    ["two checksums", { ...sha256, ...crc32 }, [400, "InvalidRequest"]],
    ["a checksum for another algorithm", { "x-amz-checksum-algorithm": "SHA1", ...crc32 }, [400, "InvalidRequest"]],
    ["a checksum algorithm that S3 does not have", { "x-amz-checksum-algorithm": "MD5" }, [400, "InvalidRequest"]],
    ["a storage class that S3 does not have", { "x-amz-storage-class": "COLD" }, [400, "InvalidStorageClass"]],
    ["an ACL that S3 does not have", { acl: "public" }, [400, "InvalidArgument"]],
    ["a website redirect to a relative path", { "x-amz-website-redirect-location": "other" }, [400, "InvalidArgument"]],
    ["metadata of more than 2 KB", { "x-amz-meta-large": text(2048) }, [400, "MetadataTooLarge"]],
    ["a line break in a value", { "x-amz-meta-lines": "one\ntwo" }, [400, "InvalidArgument"]],
    ["tagging that is not XML", { tagging: "a=1" }, [400, "MalformedXML"]],
    ["a customer key without TLS", customerKey, [400, "InvalidRequest"]],
  ])("object properties: %s", async (_, fields, expected) => {
    await using t = start();
    const key = unique();
    const response = await post(t, { fields: { key, ...fields } });
    if (Array.isArray(expected)) {
      await expectFailure(response, expected);
      expect(t.server.buckets.get(BUCKET)!.isEmpty).toBe(true);
      return;
    }
    const names = Object.keys(expected);
    const head = await t.client.fetch("HEAD", `/${BUCKET}/${key}`, { headers: { "x-amz-checksum-mode": "ENABLED" } });
    const headers = { response: pick(response.headers, names), object: pick(head.headers, names) };
    expect({ status: response.status, ...headers }).toEqual({ status: 204, response: expected, object: expected });
  });

  test("the bucket decides who can upload, and the credential owns the object", async () => {
    await using t = start({ credentials: [DEFAULT_CREDENTIALS, OTHER] });
    await expectFailure(await post(t, { credential: OTHER }), DENIED);

    const statement = {
      Effect: "Allow",
      Principal: { AWS: OTHER.owner.accountId },
      Action: "s3:PutObject",
      Resource: `arn:aws:s3:::${BUCKET}/form/*`,
      Condition: { StringEquals: { "s3:authType": "POST", "s3:x-amz-storage-class": "STANDARD_IA" } },
    };
    const body = JSON.stringify({ Version: "2012-10-17", Statement: [statement] });
    expect((await t.client.fetch("PUT", `/${BUCKET}`, { query: { policy: "" }, body })).status).toBe(204);
    const fields = { "key": "form/by-policy", "x-amz-storage-class": "STANDARD_IA" };
    expect((await post(t, { credential: OTHER, fields })).status).toBe(204);
    expect(await ownerOf(t, "form/by-policy")).toBe(OTHER.owner.id);
    await expectFailure(await post(t, { credential: OTHER, fields: { key: "form/standard" } }), DENIED);
    await expectFailure(await post(t, { credential: OTHER, fields: { ...fields, key: "other/key" } }), DENIED);
    // The same upload with the signature in a header is not `POST` for the policy.
    const other = new SigningClient({ endpoint: t.server.url, ...OTHER });
    const headers = { "x-amz-storage-class": "STANDARD_IA" };
    await expectFailure(await other.fetch("PUT", `/${BUCKET}/form/by-header`, { headers, body: "x" }), DENIED);

    // A signature in a header of the request counts for a form that has none.
    const form = { headers: { "content-type": MULTIPART }, body: multipart({ key: "signed", file: "x" }) };
    expect((await t.client.fetch("POST", `/${BUCKET}`, form)).status).toBe(204);
    expect(await ownerOf(t, "signed")).toBe(t.server.credentials.owner.id);

    await makePublic(t);
    expect((await post(t, { credential: OTHER, fields: { key: "by-acl" } })).status).toBe(204);
    expect(await ownerOf(t, "by-acl")).toBe(OTHER.owner.id);
    expect((await post(t, { anonymous: true, fields: { key: "anonymous", anything: "goes" } })).status).toBe(204);
    expect(await ownerOf(t, "anonymous")).toBe(ANONYMOUS_ID);
  });

  test("refuses a body of more than 5 GiB before it reads the body", async () => {
    await using t = start();
    const size = 5 * 1024 * 1024 * 1024 + 1024 * 1024;
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const head = `POST /${BUCKET} HTTP/1.1\r\nHost: localhost\r\nContent-Type: ${MULTIPART}\r\nContent-Length: ${size}`;
    const socket = connect(t.server.port, "127.0.0.1", () => socket.write(head + "\r\n\r\n"));
    let received = "";
    socket.on("data", chunk => {
      received += chunk.toString("latin1");
      if (received.includes("</Error>")) resolve(received);
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(received));
    const [status, document] = (await promise).split(/\r\n[^]*\r\n\r\n/);
    socket.destroy();
    expect(status).toBe("HTTP/1.1 400 Bad Request");
    const { Code, Message, ProposedSize, MaxSizeAllowed } = toObject(await xml(new Response(document)));
    expect([400, Code, Message, { ProposedSize, MaxSizeAllowed }]).toEqual(tooLarge(size, 5 * 1024 * 1024 * 1024));
  });
});
