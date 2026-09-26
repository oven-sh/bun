// The operations on buckets and their configuration, the routing of a request
// to an operation, and the two ways to address a bucket.

import { describe, expect, test } from "bun:test";
import { SigningClient, type RequestRecord, type S3ServerOptions } from "../index.ts";
import { child, children, childText, expectError, parseXml, start, toObject, xml, type TestServer } from "./helpers.ts";

const XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
const ALL_USERS = "http://acs.amazonaws.com/groups/global/AllUsers";
const NOW = new Date("2025-03-04T05:06:07.000Z");
const OWNER = { id: Buffer.alloc(64, "a").toString(), displayName: "owner", accountId: "111111111111" };
const OTHER = { id: Buffer.alloc(64, "b").toString(), displayName: "other", accountId: "222222222222" };
const CREDENTIALS = [
  { accessKeyId: "AKIAOWNER", secretAccessKey: "owner-secret", owner: OWNER },
  { accessKeyId: "AKIAOTHER", secretAccessKey: "other-secret", owner: OTHER },
];
const B = "/test-bucket";
const KEY = "/test-bucket/key";

/** A server with two accounts. `client` signs for the first one and `other` for the second one. */
function startAccounts(options: S3ServerOptions = {}): TestServer & { other: SigningClient } {
  const t = start({ credentials: CREDENTIALS, ...options });
  const { accessKeyId, secretAccessKey } = CREDENTIALS[1];
  const { region, clock } = options;
  const other = new SigningClient({ endpoint: t.server.url, accessKeyId, secretAccessKey, region, clock });
  return Object.assign(t, { other });
}

/** The status and, for an error with a document, the code: `200` or `404 NoSuchBucket`. */
async function outcome(pending: Response | Promise<Response>): Promise<string> {
  const response = await pending;
  const text = await response.text();
  if (response.status < 300 || text === "") return `${response.status}`;
  return `${response.status} ${toObject(parseXml(text)).Code}`;
}

/** The error document of the response without the IDs of the request. */
async function failure(response: Response, status: number, code: string): Promise<Record<string, string>> {
  const { RequestId, HostId, ...error } = await expectError(response, status, code);
  expect([RequestId, HostId]).toEqual([response.headers.get("x-amz-request-id")!, response.headers.get("x-amz-id-2")!]);
  return error;
}

/** Reads a subresource: the root element with its content, or the outcome of a request that failed. */
async function read(client: SigningClient, path: string, subresource: string): Promise<unknown> {
  const response = await client.fetch("GET", path, { query: { [subresource]: "" } });
  if (response.status !== 200) return outcome(response);
  const root = await xml(response);
  return { [root.name]: toObject(root) };
}

function write(client: SigningClient, path: string, subresource: string, body?: string): Promise<string> {
  return outcome(client.fetch("PUT", path, { query: { [subresource]: "" }, body }));
}

type Step = [run: () => Promise<unknown>, expected: unknown];

/** Runs the steps in their order and compares what they return with what they expect. */
async function expectSteps(steps: Step[]): Promise<void> {
  const results: unknown[] = [];
  for (const [run] of steps) results.push(await run());
  expect(results).toEqual(steps.map(([, expected]) => expected));
}

function element(name: string, content = ""): string {
  return `<${name} xmlns="${XMLNS}">${content}</${name}>`;
}

function location(constraint: string): string {
  return element("CreateBucketConfiguration", `<LocationConstraint>${constraint}</LocationConstraint>`);
}

function tagging(...tags: [key: string, value: string][]): string {
  const content = tags.map(([key, value]) => `<Tag><Key>${key}</Key><Value>${value}</Value></Tag>`).join("");
  return element("Tagging", `<TagSet>${content}</TagSet>`);
}

/** The grants of the ACL of a bucket, each one as `type name permission`. */
async function grants(client: SigningClient, path: string): Promise<string[]> {
  const acl = await xml(await client.fetch("GET", path, { query: { acl: "" } }));
  return children(child(acl, "AccessControlList"), "Grant").map(grant => {
    const grantee = child(grant, "Grantee")!;
    const name = childText(grantee, "ID") ?? childText(grantee, "URI");
    return [grantee.attributes["xsi:type"], name, childText(grant, "Permission")].join(" ");
  });
}

/** What the server recorded for the request of the response. */
function record(t: TestServer, response: Response): RequestRecord {
  return t.server.requests.find(entry => entry.requestId === response.headers.get("x-amz-request-id"))!;
}

describe("CreateBucket", () => {
  test("accepts and refuses names by the rules of S3", async () => {
    await using t = start();
    const long = Buffer.alloc(64, "a").toString();
    const valid = ["abc", long.slice(1), "0-start.and.end-9", "192.168.5", "xn-a", "sthree", "s3alias-x", "a--x-s3.b"];
    const invalid = `ab ${long} Uppercase under_score .start end. -start end- two..dots dot.-hyphen hyphen-.dot
      192.168.5.4 xn--punycode sthree-bucket amzn-s3-demo-bucket name-s3alias name--ol-s3 name.mrap name--x-s3
      name--table-s3`.split(/\s+/);
    const create = async (name: string) => [name, await outcome(t.client.fetch("PUT", "/" + name))];
    expect(await Promise.all([...valid, ...invalid].map(create))).toEqual([
      ...valid.map(name => [name, "200"]),
      ...invalid.map(name => [name, "400 InvalidBucketName"]),
    ]);
    const Message = "The specified bucket is not valid.";
    const refused = await failure(await t.client.fetch("PUT", "/Not_Valid"), 400, "InvalidBucketName");
    expect(refused).toEqual({ Code: "InvalidBucketName", Message, BucketName: "Not_Valid" });
  });

  const VIRGINIA = { region: "us-east-1", location: "/new-bucket", constraint: "" };
  const IRELAND = { region: "eu-west-1", location: "http://new-bucket.s3.amazonaws.com/", constraint: "eu-west-1" };
  const invalid = { error: "InvalidLocationConstraint", message: "The specified location-constraint is not valid" };
  const illegal = (name: string) => ({
    error: "IllegalLocationConstraintException",
    message: `The ${name} location constraint is incompatible for the region specific endpoint this request was sent to.`,
  });

  test.each<[endpoint: string, name: string, body: string | undefined, expected: Record<string, string>]>([
    ["us-east-1", "no document", undefined, VIRGINIA],
    ["us-east-1", "an empty document", element("CreateBucketConfiguration"), VIRGINIA],
    ["us-east-1", "an empty constraint", location(""), VIRGINIA],
    ["us-east-1", "the constraint us-east-1", location("us-east-1"), invalid],
    ["us-east-1", "a constraint that is no region", location("mars-1"), invalid],
    ["us-east-1", "the constraint of another region", location("eu-west-1"), IRELAND],
    ["us-east-1", "the constraint EU", location("EU"), { ...IRELAND, constraint: "EU" }],
    ["us-east-1", "another root element", element("Bucket"), { error: "MalformedXML", message: expect.any(String) }],
    ["eu-west-1", "the constraint of the endpoint", location("eu-west-1"), IRELAND],
    ["eu-west-1", "no document", undefined, illegal("unspecified")],
    ["eu-west-1", "the constraint of another region", location("us-west-2"), illegal("us-west-2")],
    ["eu-west-1", "the constraint us-east-1", location("us-east-1"), invalid],
  ])("at the endpoint of %s with %s", async (endpoint, _, body, expected) => {
    // The server without the option has the region us-east-1.
    await using t = start({ region: endpoint === "us-east-1" ? undefined : endpoint });
    const response = await t.client.fetch("PUT", "/new-bucket", { body });
    if ("error" in expected) {
      const error = await expectError(response, 400, expected.error);
      expect([error.Message, t.server.buckets.has("new-bucket")]).toEqual([expected.message, false]);
      return;
    }
    const head = await t.client.fetch("HEAD", "/new-bucket");
    const created = [response.status, await response.text(), response.headers.get("location")];
    expect(created).toEqual([200, "", expected.location]);
    expect(head.headers.get("x-amz-bucket-region")).toBe(expected.region);
    expect(await read(t.client, "/new-bucket", "location")).toEqual({ LocationConstraint: expected.constraint });
  });

  const PUBLIC_READ = [`CanonicalUser ${OWNER.id} FULL_CONTROL`, `Group ${ALL_USERS} READ`];
  test.each([
    ["us-east-1", undefined, "200", PUBLIC_READ.slice(0, 1)],
    ["eu-west-1", location("eu-west-1"), "409 BucketAlreadyOwnedByYou", PUBLIC_READ],
  ])("a bucket that exists in %s", async (endpoint, body, again, acl) => {
    await using t = startAccounts({ region: body && endpoint });
    const headers = { "x-amz-acl": "public-read" };
    await expectSteps([
      [() => outcome(t.client.fetch("PUT", "/taken", { body, headers })), "200"],
      [() => outcome(t.client.fetch("PUT", "/taken/key", { body: "data" })), "200"],
      [() => outcome(t.client.fetch("PUT", "/taken", { body })), again],
      [() => outcome(t.other.fetch("PUT", "/taken", { body })), "409 BucketAlreadyExists"],
      // The repeated request in us-east-1 makes the ACL new and keeps the objects.
      [() => grants(t.client, "/taken"), acl],
      [async () => (await t.client.fetch("GET", "/taken/key")).text(), "data"],
    ]);
    const refused = await failure(await t.other.fetch("PUT", "/taken", { body }), 409, "BucketAlreadyExists");
    expect(refused.BucketName).toBe("taken");
  });

  test("x-amz-acl, the grant headers, the object ownership, the object lock and the tags", async () => {
    await using t = startAccounts();
    const enforced = { "x-amz-object-ownership": "BucketOwnerEnforced" };
    const tags = element("CreateBucketConfiguration", `<Tags><Tag><Key>team</Key><Value>bun</Value></Tag></Tags>`);
    const cases: [name: string, headers: Record<string, string>, expected: string][] = [
      ["canned", { "x-amz-acl": "public-read-write" }, "200"],
      ["granted", { "x-amz-grant-read": `uri="${ALL_USERS}"`, "x-amz-grant-write-acp": `id=${OTHER.id}` }, "200"],
      ["both", { "x-amz-acl": "private", "x-amz-grant-read": `id=${OTHER.id}` }, "400 InvalidRequest"],
      ["bad-acl", { "x-amz-acl": "public" }, "400 InvalidArgument"],
      ["bad-grantee", { "x-amz-grant-read": `id=${Buffer.alloc(64, "c")}` }, "400 InvalidArgument"],
      ["bad-group", { "x-amz-grant-read": `uri="http://acs.amazonaws.com/groups/global/All"` }, "400 InvalidArgument"],
      ["email", { "x-amz-grant-read": `emailAddress="owner@example.com"` }, "405 MethodNotAllowed"],
      ["enforced", enforced, "200"],
      ["enforced-private", { ...enforced, "x-amz-acl": "private" }, "200"],
      ["enforced-public", { ...enforced, "x-amz-acl": "public-read" }, "400 InvalidBucketAclWithObjectOwnership"],
      ["bad-ownership", { "x-amz-object-ownership": "Everyone" }, "400 InvalidArgument"],
      ["locked", { "x-amz-bucket-object-lock-enabled": "true" }, "200"],
    ];
    const create = ([name, headers]: (typeof cases)[number]) => outcome(t.client.fetch("PUT", "/" + name, { headers }));
    expect(await Promise.all(cases.map(create))).toEqual(cases.map(([, , expected]) => expected));
    const created = cases.filter(([, , expected]) => expected === "200").map(([name]) => name);
    const ownership = { ObjectOwnership: "BucketOwnerEnforced" };

    await expectSteps([
      [() => outcome(t.client.fetch("PUT", "/tagged", { body: tags })), "200"],
      [() => outcome(t.client.fetch("PUT", "/anonymous", { anonymous: true })), "403 AccessDenied"],
      [async () => [...t.server.buckets.keys()].sort(), [...created, "tagged", "test-bucket"].sort()],
      [() => grants(t.client, "/canned"), [...PUBLIC_READ, `Group ${ALL_USERS} WRITE`]],
      // The grant headers make the complete ACL. The owner gets no grant of its own.
      [() => grants(t.client, "/granted"), [`Group ${ALL_USERS} READ`, `CanonicalUser ${OTHER.id} WRITE_ACP`]],
      [() => read(t.client, "/enforced", "ownershipControls"), { OwnershipControls: { Rule: ownership } }],
      [() => read(t.client, "/locked", "versioning"), { VersioningConfiguration: { Status: "Enabled" } }],
      [() => read(t.client, "/locked", "object-lock"), { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled" } }],
      [() => read(t.client, "/tagged", "tagging"), { Tagging: { TagSet: { Tag: { Key: "team", Value: "bun" } } } }],
    ]);
  });
});

describe("a bucket", () => {
  test("HeadBucket tells the region and has no body", async () => {
    await using t = startAccounts();
    const head = async (client: SigningClient, path: string) => {
      const response = await client.fetch("HEAD", path);
      const names = ["x-amz-bucket-region", "x-amz-access-point-alias", "content-length"];
      return [response.status, ...names.map(name => response.headers.get(name)), await response.text()];
    };
    await expectSteps([
      [() => head(t.client, B), [200, "us-east-1", "false", "0", ""]],
      [() => head(t.client, "/missing-bucket"), [404, null, null, "0", ""]],
      [() => head(t.other, B), [403, "us-east-1", null, "0", ""]],
    ]);
  });

  test("DeleteBucket needs a bucket without objects, versions and delete markers", async () => {
    await using t = startAccounts({ buckets: [{ name: "test-bucket", versioning: "Enabled" }] });
    const remove = (client = t.client) => outcome(client.fetch("DELETE", B));
    const removeVersion = (from: Response) =>
      outcome(t.client.fetch("DELETE", KEY, { query: { versionId: from.headers.get("x-amz-version-id")! } }));

    const put = await t.client.fetch("PUT", KEY, { body: "data" });
    const refused = await failure(await t.client.fetch("DELETE", B), 409, "BucketNotEmpty");
    expect(refused.BucketName).toBe("test-bucket");
    const marker = await t.client.fetch("DELETE", KEY);
    await expectSteps([
      [() => remove(), "409 BucketNotEmpty"],
      [() => removeVersion(put), "204"],
      // The bucket has only a delete marker.
      [() => remove(), "409 BucketNotEmpty"],
      [() => removeVersion(marker), "204"],
      [() => remove(t.other), "403 AccessDenied"],
      [() => remove(), "204"],
      [() => remove(), "404 NoSuchBucket"],
      [() => outcome(t.client.fetch("HEAD", B)), "404"],
    ]);
  });

  test("ListBuckets lists the buckets of the sender in the order of the names", async () => {
    const buckets = ["logs-b", { name: "other-a", owner: OTHER }, "data", "logs-a", { name: "other-b", owner: OTHER }];
    await using t = startAccounts({ clock: () => NOW, buckets });
    expect(await outcome(t.client.fetch("PUT", "/logs-eu", { body: location("eu-west-1") }))).toBe("200");

    const CreationDate = "2025-03-04T05:06:07.000Z";
    const all = await xml(await t.other.fetch("GET", "/"));
    const Bucket = ["other-a", "other-b"].map(Name => ({ Name, CreationDate }));
    expect([all.name, all.attributes]).toEqual(["ListAllMyBucketsResult", { xmlns: XMLNS }]);
    expect(toObject(all)).toEqual({ Owner: { ID: OTHER.id, DisplayName: "other" }, Buckets: { Bucket } });

    /** The names with the regions, the prefix and the continuation token of the response. */
    const list = async (query: Record<string, string> = {}, client = t.client) => {
      const response = await client.fetch("GET", "/", { query });
      if (response.status !== 200) return outcome(response);
      const root = await xml(response);
      const names = children(child(root, "Buckets"), "Bucket").map(bucket =>
        [childText(bucket, "Name"), childText(bucket, "BucketRegion")].join("@"),
      );
      return [names.join(" "), childText(root, "Prefix"), childText(root, "ContinuationToken")];
    };
    const page = { "max-buckets": "2", "prefix": "logs-" };
    const token = (name: string) => Buffer.from(name).toString("base64url");
    await expectSteps([
      [() => list(), ["data@ logs-a@ logs-b@ logs-eu@", undefined, undefined]],
      // S3 tells the region of each bucket when the request has a parameter.
      [() => list({ prefix: "logs-" }), ["logs-a@us-east-1 logs-b@us-east-1 logs-eu@eu-west-1", "logs-", undefined]],
      [() => list(page), ["logs-a@us-east-1 logs-b@us-east-1", "logs-", token("logs-b")]],
      [() => list({ ...page, "continuation-token": token("logs-b") }), ["logs-eu@eu-west-1", "logs-", undefined]],
      [() => list({ "bucket-region": "eu-west-1" }), ["logs-eu@eu-west-1", undefined, undefined]],
      [() => list({ prefix: "other-" }), ["", "other-", undefined]],
      [() => list({ "max-buckets": "0" }), "400 InvalidArgument"],
      [() => list({ "max-buckets": "10001" }), "400 InvalidArgument"],
      [() => list({ "continuation-token": "%%%" }), "400 InvalidArgument"],
      [() => outcome(t.client.fetch("GET", "/", { anonymous: true })), "403 AccessDenied"],
    ]);
  });

  test("the versioning configuration", async () => {
    await using t = start({ buckets: ["test-bucket", { name: "locked", objectLock: true }] });
    const configuration = (content: string) => element("VersioningConfiguration", content);
    const status = (value: string) => configuration(`<Status>${value}</Status>`);
    const put = (body: string, bucket = B) => write(t.client, bucket, "versioning", body);
    const state = (content: object | string) => ({ VersioningConfiguration: content });
    const get = () => read(t.client, B, "versioning");
    await expectSteps([
      [() => get(), state("")],
      [() => put(status("Enabled")), "200"],
      [() => get(), state({ Status: "Enabled" })],
      [() => put(configuration("<Status>Suspended</Status><MfaDelete>Disabled</MfaDelete>")), "200"],
      [() => get(), state({ Status: "Suspended" })],
      [() => put(status("Enabled").slice(0, -1)), "400 MalformedXML"],
      [() => put(element("Versioning", "<Status>Enabled</Status>")), "400 MalformedXML"],
      [() => put(status("On")), "400 MalformedXML"],
      [() => put(status("enabled")), "400 MalformedXML"],
      [() => put(configuration("<Status>Enabled</Status><MfaDelete>Yes</MfaDelete>")), "400 MalformedXML"],
      [() => put(configuration("")), "400 IllegalVersioningConfigurationException"],
      [() => put(""), "400 MissingRequestBodyError"],
      [() => put(configuration("<Status>Enabled</Status><MfaDelete>Enabled</MfaDelete>")), "501 NotImplemented"],
      [() => get(), state({ Status: "Suspended" })],
      // Object lock needs versioning.
      [() => put(status("Suspended"), "/locked"), "409 InvalidBucketState"],
      [() => put(status("Enabled"), "/missing-bucket"), "404 NoSuchBucket"],
    ]);
  });

  test("the tags of a bucket", async () => {
    await using t = start();
    const request = (method: string, body?: string) =>
      outcome(t.client.fetch(method, B, { query: { tagging: "" }, body }));
    const put = (...tags: [key: string, value: string][]) => request("PUT", tagging(...tags));
    const get = () => read(t.client, B, "tagging");
    const many = Array.from({ length: 51 }, (_, index): [string, string] => ["key" + index, "value"]);
    const text = (length: number) => Buffer.alloc(length, "k").toString();
    const set = (...tags: [key: string, value: string][]) => {
      const list = tags.map(([Key, Value]) => ({ Key, Value }));
      return { Tagging: { TagSet: { Tag: list.length === 1 ? list[0] : list } } };
    };

    const missing = await failure(await t.client.fetch("GET", B, { query: { tagging: "" } }), 404, "NoSuchTagSet");
    expect(missing).toEqual({ Code: "NoSuchTagSet", Message: "The TagSet does not exist", BucketName: "test-bucket" });
    await expectSteps([
      [() => put(...many.slice(1)), "204"],
      [() => put(["project", "bun s3"], ["empty", ""], [text(128), text(256)]), "204"],
      [() => get(), set(["project", "bun s3"], ["empty", ""], [text(128), text(256)])],
      [() => put(["only", "one"]), "204"],
      [() => put(...many), "400 BadRequest"],
      [() => put(["a", "1"], ["a", "2"]), "400 InvalidTag"],
      [() => put([text(129), "1"]), "400 InvalidTag"],
      [() => put(["a", text(257)]), "400 InvalidTag"],
      [() => put(["", "1"]), "400 InvalidTag"],
      [() => put(["aws:name", "1"]), "400 InvalidTag"],
      [() => put(["a?b", "1"]), "400 InvalidTag"],
      [() => request("PUT", element("Tags", "<TagSet/>")), "400 MalformedXML"],
      [() => request("PUT", element("Tagging")), "400 MalformedXML"],
      [() => request("PUT", ""), "400 MissingRequestBodyError"],
      [() => get(), set(["only", "one"])],
      [() => request("DELETE"), "204"],
      [() => get(), "404 NoSuchTagSet"],
      [() => request("DELETE"), "204"],
    ]);
  });
});

/**
 * One line for each configuration: the subresource, the root element of the
 * document, the error code of a read when the bucket has no configuration
 * (`-` when S3 has a default document), and the names of the operations.
 */
const STORED = `
  lifecycle         LifecycleConfiguration            NoSuchLifecycleConfiguration          BucketLifecycleConfiguration
  encryption        ServerSideEncryptionConfiguration -                                     BucketEncryption
  website           WebsiteConfiguration              NoSuchWebsiteConfiguration            BucketWebsite
  notification      NotificationConfiguration         -                                     BucketNotificationConfiguration
  logging           BucketLoggingStatus               -                                     BucketLogging
  replication       ReplicationConfiguration          ReplicationConfigurationNotFoundError BucketReplication
  accelerate        AccelerateConfiguration           -                                     BucketAccelerateConfiguration
  publicAccessBlock PublicAccessBlockConfiguration    NoSuchPublicAccessBlockConfiguration  PublicAccessBlock`
  .trim()
  .split("\n")
  .map(line => line.trim().split(/\s+/));
const SSE_S3 = { Rule: { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" }, BucketKeyEnabled: "false" } };
/** The configurations that are always there. They have no delete operation, but the encryption has one. */
const PERMANENT = ["notification", "logging", "accelerate"];

describe("the configurations that the server stores", () => {
  test.each(STORED)("%s", async (subresource, root, missing, name) => {
    await using t = startAccounts({ buckets: [{ name: "test-bucket", versioning: "Enabled" }] });
    const query = { [subresource]: "" };
    const document = element(root, "<Status>Enabled</Status>");
    const initial = missing === "-" ? { [root]: subresource === "encryption" ? SSE_S3 : "" } : "404 " + missing;
    await expectSteps([
      [() => read(t.client, B, subresource), initial],
      [() => write(t.client, B, subresource, element("Configuration")), "400 MalformedXML"],
      [() => write(t.client, B, subresource, document.slice(0, -1)), "400 MalformedXML"],
      [() => write(t.client, B, subresource, ""), "400 MissingRequestBodyError"],
      [() => write(t.other, B, subresource, document), "403 AccessDenied"],
      [() => read(t.other, B, subresource), "403 AccessDenied"],
      [() => read(t.client, "/missing-bucket", subresource), "404 NoSuchBucket"],
      [() => read(t.client, B, subresource), initial],
    ]);

    const put = await t.client.fetch("PUT", B, { query, body: document });
    const get = await t.client.fetch("GET", B, { query });
    const remove = await t.client.fetch("DELETE", B, { query });
    const operations = [get, put, remove].map(response => record(t, response).operation);
    expect([put.status, await put.text()]).toEqual([200, ""]);
    expect([get.headers.get("content-type"), await get.text()]).toEqual(["application/xml", document]);

    if (PERMANENT.includes(subresource)) {
      const error = await failure(remove, 405, "MethodNotAllowed");
      expect([error.Method, error.ResourceType, remove.headers.get("allow")]).toEqual(["DELETE", "BUCKET", "GET, PUT"]);
      expect(operations).toEqual(["Get" + name, "Put" + name, ""]);
      return;
    }
    // The API has the name DeleteBucketLifecycle for the delete operation of the lifecycle configuration.
    expect(operations).toEqual(["Get" + name, "Put" + name, "Delete" + name.replace(/^(BucketLifecycle).*/, "$1")]);
    expect([remove.status, await remove.text(), await read(t.client, B, subresource)]).toEqual([204, "", initial]);
    expect(await outcome(t.client.fetch("DELETE", B, { query }))).toBe("204");
  });

  test("the checks of a document that depend on the bucket", async () => {
    await using t = start({ buckets: ["test-bucket", "with.dots"] });
    const accelerate = (status: string) => element("AccelerateConfiguration", `<Status>${status}</Status>`);
    const block = (value: string) =>
      element("PublicAccessBlockConfiguration", `<IgnorePublicAcls>${value}</IgnorePublicAcls>`);
    const lock = element("ObjectLockConfiguration", "<ObjectLockEnabled>Enabled</ObjectLockEnabled>");
    await expectSteps([
      // Replication and object lock need versioning.
      [() => write(t.client, B, "replication", element("ReplicationConfiguration")), "400 InvalidRequest"],
      [() => write(t.client, B, "object-lock", lock), "409 InvalidBucketState"],
      [() => read(t.client, B, "object-lock"), "404 ObjectLockConfigurationNotFoundError"],
      [() => write(t.client, "/with.dots", "accelerate", accelerate("Enabled")), "400 InvalidRequest"],
      [() => write(t.client, B, "accelerate", accelerate("On")), "400 MalformedXML"],
      [() => write(t.client, B, "publicAccessBlock", block("yes")), "400 MalformedXML"],
      [() => write(t.client, B, "publicAccessBlock", block("TRUE")), "200"],
    ]);
  });

  test("the payer of the requests", async () => {
    await using t = start();
    const payment = (payer: string) => element("RequestPaymentConfiguration", `<Payer>${payer}</Payer>`);
    const configure = (body: string) => write(t.client, B, "requestPayment", body);
    const payer = () => read(t.client, B, "requestPayment");
    /** The status and the header x-amz-request-charged for each kind of request to an object. */
    const charged = async (headers: Record<string, string>) => {
      const responses = [
        await t.client.fetch("PUT", KEY, { body: "data", headers }),
        await t.client.fetch("GET", KEY, { headers }),
        await t.client.fetch("HEAD", KEY, { headers }),
        await t.client.fetch("GET", B, { query: { "list-type": "2" }, headers }),
        await t.client.fetch("DELETE", KEY, { headers }),
      ];
      return responses.map(response => `${response.status} ${response.headers.get("x-amz-request-charged")}`);
    };
    const accepts = { "x-amz-request-payer": "requester" };
    const free = ["200 null", "200 null", "200 null", "200 null", "204 null"];
    await expectSteps([
      [() => payer(), { RequestPaymentConfiguration: { Payer: "BucketOwner" } }],
      [() => charged(accepts), free],
      [() => configure(payment("Everyone")), "400 MalformedXML"],
      [() => configure(element("Payment", "<Payer>Requester</Payer>")), "400 MalformedXML"],
      [() => configure(""), "400 MissingRequestBodyError"],
      [() => configure(payment("Requester")), "200"],
      [() => payer(), { RequestPaymentConfiguration: { Payer: "Requester" } }],
      [() => charged({}), free],
      [() => charged(accepts), free.map(entry => entry.replace("null", "requester"))],
    ]);
  });

  test("the ownership controls", async () => {
    await using t = start();
    const controls = (ownership: string) =>
      element("OwnershipControls", `<Rule><ObjectOwnership>${ownership}</ObjectOwnership></Rule>`);
    const put = (body: string) => write(t.client, B, "ownershipControls", body);
    const get = () => read(t.client, B, "ownershipControls");
    const state = (ObjectOwnership: string) => ({ OwnershipControls: { Rule: { ObjectOwnership } } });
    const acl = (value: string) =>
      outcome(t.client.fetch("PUT", B, { query: { acl: "" }, headers: { "x-amz-acl": value } }));
    await expectSteps([
      [() => get(), "404 OwnershipControlsNotFoundError"],
      [() => put(controls("ObjectWriter")), "200"],
      [() => get(), state("ObjectWriter")],
      [() => put(controls("BucketOwnerPreferred")), "200"],
      [() => get(), state("BucketOwnerPreferred")],
      [() => put(controls("BucketOwnerEnforced")), "200"],
      [() => get(), state("BucketOwnerEnforced")],
      [() => put(controls("Everyone")), "400 MalformedXML"],
      [() => put(element("OwnershipControls")), "400 MalformedXML"],
      [() => put(controls("ObjectWriter").replaceAll("OwnershipControls", "Ownership")), "400 MalformedXML"],
      [() => put(""), "400 MissingRequestBodyError"],
      [() => outcome(t.client.fetch("DELETE", B, { query: { ownershipControls: "" } })), "204"],
      [() => get(), "404 OwnershipControlsNotFoundError"],
      // A bucket with an ACL for other senders cannot turn its ACLs off.
      [() => acl("public-read"), "200"],
      [() => put(controls("BucketOwnerEnforced")), "400 InvalidBucketAclWithObjectOwnership"],
      [() => acl("private"), "200"],
      [() => put(controls("BucketOwnerEnforced")), "200"],
    ]);
  });
});

describe("routing", () => {
  test.each([
    ["GET", B, "analytics"],
    ["GET", B, "inventory"],
    ["PUT", B, "metrics"],
    ["PUT", B, "intelligent-tiering"],
    ["PUT", B, "abac"],
    ["GET", KEY, "torrent"],
    ["POST", KEY, "select"],
    ["PUT", KEY, "encryption"],
  ])("%s %s?%s is not implemented", async (method, path, subresource) => {
    await using t = start();
    await t.s3.write("key", "data");
    const body = method === "GET" ? undefined : "<Document/>";
    const response = await t.client.fetch(method, path, { query: { [subresource]: "" }, body });
    const Message = "A header you provided implies functionality that is not implemented";
    const error = await failure(response, 501, "NotImplemented");
    expect(error).toEqual({ Code: "NotImplemented", Message, Header: subresource });
    expect([await t.s3.file("key").text(), ...t.server.buckets.keys()]).toEqual(["data", "test-bucket"]);
  });

  test.each([
    ["PATCH", KEY, "", "OBJECT", "GET, HEAD, PUT, DELETE"],
    ["POST", KEY, "", "OBJECT", "GET, HEAD, PUT, DELETE"],
    ["POST", "/", "", "SERVICE", "GET"],
    ["DELETE", "/", "", "SERVICE", "GET"],
    ["PUT", B, "location", "BUCKET", "GET"],
    ["DELETE", B, "versioning", "BUCKET", "GET, PUT"],
    ["POST", B, "policy", "BUCKET", "GET, PUT, DELETE"],
    ["DELETE", KEY, "acl", "OBJECT", "GET, PUT"],
  ])("%s %s?%s is a method that the resource does not have", async (Method, path, subresource, ResourceType, allow) => {
    await using t = start();
    const response = await t.client.fetch(Method, path, { query: subresource === "" ? {} : { [subresource]: "" } });
    const Message = "The specified method is not allowed against this resource.";
    expect(response.headers.get("allow")).toBe(allow);
    const error = await failure(response, 405, "MethodNotAllowed");
    expect(error).toEqual({ Code: "MethodNotAllowed", Message, Method, ResourceType });
  });

  test("a query parameter that the server does not know has no effect", async () => {
    await using t = start();
    const query = { "unknown": "value", "x-id": "PutObject" };
    const operation = async (method: string, path: string, options: object = { query }) => {
      const response = await t.client.fetch(method, path, options);
      return `${response.status} ${record(t, response).operation} ${await response.text()}`.trim();
    };
    await expectSteps([
      [() => operation("PUT", KEY, { query, body: "data" }), "200 PutObject"],
      [() => operation("GET", KEY), "200 GetObject data"],
      [() => operation("HEAD", B, { query: { ...query, versioning: "" } }), "200 HeadBucket"],
      [() => operation("DELETE", KEY), "204 DeleteObject"],
      [() => operation("DELETE", B), "204 DeleteBucket"],
    ]);
  });
});

describe("addressing", () => {
  const DOTS = "my.dotted.bucket";
  const T = "test-bucket";
  const list = (hosts: string) => hosts.trim().split(/\s+/);
  /** The values of the Host header for each bucket. `path` has the values of a path-style request. */
  const AMAZON = {
    [T]: list(`test-bucket.s3.amazonaws.com test-bucket.s3.us-west-2.amazonaws.com test-bucket.s3-us-west-2.amazonaws.com
      test-bucket.s3.dualstack.us-west-2.amazonaws.com test-bucket.s3-fips.dualstack.us-gov-west-1.amazonaws.com
      test-bucket.s3-accelerate.amazonaws.com test-bucket.s3.cn-north-1.amazonaws.com.cn TEST-BUCKET.S3.AMAZONAWS.COM`),
    [DOTS]: list(`my.dotted.bucket.s3.amazonaws.com my.dotted.bucket.s3.eu-central-1.amazonaws.com`),
    path: list(
      `s3.amazonaws.com s3.us-west-2.amazonaws.com s3-us-west-2.amazonaws.com s3.dualstack.us-west-2.amazonaws.com`,
    ),
  };
  const LOCAL = {
    [T]: list(`test-bucket.localhost test-bucket.localhost:$port`),
    [DOTS]: list(`my.dotted.bucket.localhost:$port`),
    path: list(`127.0.0.1:$port [::1]:$port localhost:$port test-bucket.example.com`),
  };
  const CUSTOM = {
    [T]: list(`test-bucket.s3.example.test:$port test-bucket.storage.internal test-bucket.s3.amazonaws.com`),
    [DOTS]: list(`my.dotted.bucket.s3.example.test my.dotted.bucket.s3.us-west-2.amazonaws.com`),
    path: list(`test-bucket.localhost:$port s3.example.test:$port storage.internal s3.amazonaws.com`),
  };

  test.each([
    ["the hosts of Amazon S3", undefined, AMAZON],
    ["the default of the option domains", undefined, LOCAL],
    ["the option domains", ["s3.example.test", "Storage.Internal"], CUSTOM],
  ])("finds the bucket in the Host header, with %s", async (_, domains, hosts) => {
    await using t = start({ domains, buckets: [T, DOTS] });
    const results: unknown[] = [];
    const expected: unknown[] = [];
    for (const [bucket, names] of Object.entries(hosts)) {
      for (const name of names) {
        const host = name.replace("$port", String(t.server.port));
        // The path of a virtual-hosted-style request has only the key.
        const [prefix, service] = bucket === "path" ? [B, "ListBuckets"] : ["", "ListObjects"];
        const put = await t.client.fetch("PUT", `${prefix}/${name}`, { host, body: name });
        const root = await t.client.fetch("GET", "/", { host });
        const stored = t.server.buckets.get(bucket === "path" ? T : bucket)!.current(name);
        results.push([
          name,
          put.status,
          record(t, put).bucket,
          record(t, root).operation,
          stored && Buffer.from(stored.data.bytes()).toString(),
        ]);
        expected.push([name, 200, bucket === "path" ? T : bucket, service, name]);
      }
    }
    expect(results).toEqual(expected);
  });

  test("a path-style request with and without a slash after the name of the bucket", async () => {
    await using t = start();
    const operation = async (method: string, path: string) => {
      const response = await t.client.fetch(method, path);
      const { operation, bucket, key } = record(t, response);
      return [response.status, operation, bucket, key];
    };
    await expectSteps([
      [() => operation("GET", "/test-bucket"), [200, "ListObjects", "test-bucket", undefined]],
      [() => operation("GET", "/test-bucket/"), [200, "ListObjects", "test-bucket", undefined]],
      [() => operation("HEAD", "/test-bucket/"), [200, "HeadBucket", "test-bucket", undefined]],
      // The key of this request is one slash.
      [() => operation("GET", "/test-bucket//"), [404, "GetObject", "test-bucket", "/"]],
      [() => operation("PUT", "/new-bucket/"), [200, "CreateBucket", "new-bucket", undefined]],
      [() => operation("DELETE", "/new-bucket/"), [204, "DeleteBucket", "new-bucket", undefined]],
    ]);
  });

  test("Bun.S3Client with virtualHostedStyle", async () => {
    await using t = start();
    const endpoint = t.server.virtualHostedUrl(t.bucket);
    const s3 = new Bun.S3Client({ ...t.server.clientOptions(), endpoint, virtualHostedStyle: true });
    await s3.write("folder/key.txt", "virtual");
    expect(await s3.file("folder/key.txt").text()).toBe("virtual");
    expect((await s3.list()).contents?.map(entry => entry.key)).toEqual(["folder/key.txt"]);
    await s3.delete("folder/key.txt");

    const host = `test-bucket.localhost:${t.server.port}`;
    expect(endpoint).toBe("http://" + host);
    expect(
      t.server.requests.map(entry => [entry.operation, entry.headers.get("host"), entry.bucket, entry.key]),
    ).toEqual([
      ["PutObject", host, "test-bucket", "folder/key.txt"],
      ["GetObject", host, "test-bucket", "folder/key.txt"],
      ["ListObjectsV2", host, "test-bucket", undefined],
      ["DeleteObject", host, "test-bucket", "folder/key.txt"],
    ]);
  });
});

describe("each response", () => {
  test("has the headers x-amz-request-id, x-amz-id-2, Date and Server", async () => {
    await using t = start({ clock: () => NOW });
    const unsigned = { authorization: "AWS4-HMAC-SHA256 Credential=nobody" };
    const preflight = { "origin": "https://example.com", "access-control-request-method": "GET" };
    const responses = [
      await t.client.fetch("GET", "/"),
      await t.client.fetch("PUT", KEY, { body: "data" }),
      await t.client.fetch("HEAD", KEY),
      await t.client.fetch("DELETE", KEY),
      await t.client.fetch("GET", KEY),
      await t.client.fetch("HEAD", "/missing-bucket"),
      await t.client.fetch("GET", B, { query: { analytics: "" } }),
      await t.client.fetch("PATCH", KEY),
      await fetch(t.server.url + B, { headers: unsigned }),
      await fetch(t.server.url + KEY, { method: "OPTIONS", headers: preflight }),
    ];
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 204, 404, 404, 501, 405, 400, 403]);
    const names = ["x-amz-request-id", "x-amz-id-2", "date", "server"];
    const headers = responses.map(response => names.map(name => response.headers.get(name)));
    const id = expect.stringMatching(/^[0-9A-F]{16}$/);
    const hostId = expect.stringMatching(/^[A-Za-z0-9+/=]{56}$/);
    expect(headers).toEqual(responses.map(() => [id, hostId, "Tue, 04 Mar 2025 05:06:07 GMT", "AmazonS3"]));
    expect(new Set(headers.map(([requestId]) => requestId)).size).toBe(responses.length);
  });

  test("that is an error has a document for GET and no body for HEAD", async () => {
    await using t = start();
    const get = await t.client.fetch("GET", "/missing-bucket/key");
    const head = await t.client.fetch("HEAD", "/missing-bucket/key");
    const ids = `<RequestId>${get.headers.get("x-amz-request-id")}</RequestId><HostId>${get.headers.get("x-amz-id-2")}</HostId>`;
    expect([get.status, get.headers.get("content-type")]).toEqual([404, "application/xml"]);
    expect(await get.text()).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchBucket</Code>` +
        `<Message>The specified bucket does not exist</Message><BucketName>missing-bucket</BucketName>${ids}</Error>`,
    );
    expect([head.status, await head.text(), record(t, head).errorCode]).toEqual([404, "", "NoSuchBucket"]);
  });
});
