// The access decision: who can do which operation. The tests have the account
// that owns the bucket, a second account and an anonymous sender.

import { describe, expect, test } from "bun:test";
import { SigningClient, type S3ServerOptions } from "../index.ts";
import { child, children, childText, expectError, parseXml, start, toObject, xml, type TestServer } from "./helpers.ts";

const XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
const XSI = `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;
const ALL_USERS = "http://acs.amazonaws.com/groups/global/AllUsers";
const AUTHENTICATED_USERS = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";
const ANONYMOUS = "65a011a29cdf8ec533ec3d1ccaae921c";
const OWNER = { id: Buffer.alloc(64, "a").toString(), displayName: "owner", accountId: "111111111111" };
const OTHER = { id: Buffer.alloc(64, "b").toString(), displayName: "other", accountId: "222222222222" };
const CREDENTIALS = [
  { accessKeyId: "AKIAOWNER", secretAccessKey: "owner-secret", owner: OWNER },
  { accessKeyId: "AKIAOTHER", secretAccessKey: "other-secret", owner: OTHER },
];
const SENDERS = ["owner", "other", "anonymous"] as const;
const DENIED = "403:AccessDenied";
const KEY = "/test-bucket/key";

type Sender = (typeof SENDERS)[number];
interface Accounts extends TestServer {
  clients: Record<Sender, SigningClient>;
  /** The bodies that a request names with `@name`. */
  bodies: Record<string, string>;
  /**
   * Sends the requests of the table in their order. A row has the request and
   * the outcomes for the owner, for the second account and for an anonymous
   * sender, with two spaces at least between them. `-` is for a sender that
   * does not send the request.
   */
  access(table: string): Promise<void>;
}

function element(name: string, content = ""): string {
  return `<${name} xmlns="${XMLNS}">${content}</${name}>`;
}

const PRINCIPALS: Record<string, unknown> = {
  "everyone": "*",
  "other": { AWS: OTHER.accountId },
  "other-by-arn": { AWS: [`arn:aws:iam::${OTHER.accountId}:root`] },
};

/**
 * The policy of the lines. A line has the effect, the principal, the actions,
 * the resource in the bucket, and for a condition the operator, the key and the values.
 */
function policy(lines: string): string {
  const arn = "arn:aws:s3:::test-bucket";
  const rows = lines.trim().split("\n");
  const Statement = rows.map(row => {
    const [Effect, principal, actions, resource, operator, key, values] = row.trim().split(/\s+/);
    const Resource = resource === "*" ? [arn, arn + "/*"] : arn + resource.replace(/^\/$/, "");
    const Condition = operator && { [operator]: { [key]: values.split(",") } };
    const Principal = PRINCIPALS[principal];
    return { Effect, Principal, Action: actions.split(","), Resource, ...(Condition && { Condition }) };
  });
  return JSON.stringify({ Version: "2012-10-17", Statement });
}

const grant = (grantee: string, permission: string) =>
  `<Grant>${grantee}<Permission>${permission}</Permission></Grant>`;
const byId = (id: string) => `<Grantee ${XSI} xsi:type="CanonicalUser"><ID>${id}</ID></Grantee>`;
const group = (uri: string) => `<Grantee ${XSI} xsi:type="Group"><URI>${uri}</URI></Grantee>`;
const byEmail = `<Grantee ${XSI} xsi:type="AmazonCustomerByEmail"><EmailAddress>a@example.com</EmailAddress></Grantee>`;
const acl = (list: string, owner = OWNER.id) =>
  element("AccessControlPolicy", `<Owner><ID>${owner}</ID></Owner><AccessControlList>${list}</AccessControlList>`);
const block = (name: string) => element("PublicAccessBlockConfiguration", `<${name}>true</${name}>`);
const controls = (name: string) =>
  element("OwnershipControls", `<Rule><ObjectOwnership>${name}</ObjectOwnership></Rule>`);
const GRANTS = grant(byId(OTHER.id), "READ_ACP") + grant(group(AUTHENTICATED_USERS), "READ");
const RULES =
  `<CORSRule><ID>site</ID><AllowedOrigin>https://*.example.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod>
  <AllowedMethod>PUT</AllowedMethod><AllowedHeader>x-amz-*</AllowedHeader><AllowedHeader>content-type</AllowedHeader>
  <ExposeHeader>ETag</ExposeHeader><ExposeHeader>x-amz-version-id</ExposeHeader><MaxAgeSeconds>600</MaxAgeSeconds></CORSRule>
  <CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>HEAD</AllowedMethod></CORSRule>`.replace(/\n\s+/g, "");
const PUBLIC_POLICY = JSON.stringify(JSON.parse(policy("Allow everyone s3:GetObject /*")), null, 2) + "\n";

/** The documents of the requests, by the name that a request has after `@`. */
const BODIES: Record<string, string> = {
  "empty": "",
  "tags": element("Tagging", "<TagSet><Tag><Key>a</Key><Value>b</Value></Tag></TagSet>"),
  "acl": acl(GRANTS),
  "acl-cut": acl(GRANTS).slice(0, -1),
  "acl-root": element("AccessControlList", GRANTS),
  "acl-permission": acl(grant(byId(OWNER.id), "EVERYTHING")),
  "acl-grantee": acl(grant("<Grantee/>", "READ")),
  "acl-id": acl(grant(byId(Buffer.alloc(64, "c").toString()), "READ")),
  "acl-group": acl(grant(group(ALL_USERS + "s"), "READ")),
  "acl-email": acl(grant(byEmail, "READ")),
  "acl-owner": acl(GRANTS, OTHER.id),
  "acl-empty": acl(""),
  "acl-full": acl(grant(byId(OWNER.id), "FULL_CONTROL")),
  "acl-public": acl(grant(group(ALL_USERS), "READ")),
  "enforced": controls("BucketOwnerEnforced"),
  "preferred": controls("BucketOwnerPreferred"),
  "payment": element("RequestPaymentConfiguration", "<Payer>Requester</Payer>"),
  "ignore-acls": block("IgnorePublicAcls"),
  "block-acls": block("BlockPublicAcls"),
  "block-policy": block("BlockPublicPolicy"),
  "restrict": block("RestrictPublicBuckets"),
  "cors": element("CORSConfiguration", RULES),
  "cors-empty": element("CORSConfiguration"),
  "cors-method": element("CORSConfiguration", RULES.replace("PUT", "PATCH")),
  "policy-text": PUBLIC_POLICY,
  "policy-words": "not a policy",
  "policy-bucket": PUBLIC_POLICY.replace("test-bucket", "another-bucket"),
  "policy-action": PUBLIC_POLICY.replace("s3:GetObject", "s3:ListBucket"),
  "policy-effect": PUBLIC_POLICY.replace("Allow", "Permit"),
  "policy-public": policy("Allow everyone s3:GetObject /*\nAllow other s3:ListBucket /"),
  "policy-read": policy("Allow other s3:GetObject /*"),
  "policy-list": policy("Allow other s3:GetObject,s3:ListBucket *"),
  "policy-write": policy("Allow other s3:PutObject,s3:PutObjectAcl,s3:PutBucketAcl *"),
  "policy-all": policy("Allow other-by-arn s3:* *"),
};

/** A server with two accounts. The first one owns the bucket `test-bucket`, which has the object `key`. */
async function startAccounts(options: S3ServerOptions = {}): Promise<Accounts> {
  const server = start({ credentials: CREDENTIALS, ...options });
  const { accessKeyId, secretAccessKey } = CREDENTIALS[1];
  const other = new SigningClient({ endpoint: server.server.url, accessKeyId, secretAccessKey });
  const clients = { owner: server.client, other, anonymous: server.client };
  const access = (table: string) => expectAccess(t, table);
  const t: Accounts = Object.assign(server, { clients, bodies: { ...BODIES }, access });
  await t.s3.write("key", "data");
  return t;
}

/**
 * The status with the code of the error document or with the text of another
 * body: `200`, `200:data` or `404:NoSuchBucket`.
 */
async function outcome(pending: Response | Promise<Response>): Promise<string> {
  const response = await pending;
  const text = await response.text();
  if (!text.startsWith("<?xml")) return text === "" ? `${response.status}` : `${response.status}:${text}`;
  return response.status < 300 ? `${response.status}` : `${response.status}:${toObject(parseXml(text)).Code}`;
}

/**
 * Sends the request of one line: the sender, the method, the path with the
 * query, then the headers as `name=value`, and `@name` for the body with that
 * name. A PUT request to an object without a body has the body `data`.
 */
function send(t: Accounts, line: string): Promise<Response> {
  const [sender, method, target, ...fields] = line.trim().split(" ");
  const [path, search] = target.split("?");
  const named = fields.find(field => field.startsWith("@"))?.slice(1);
  const isObject = method === "PUT" && search === undefined && path.lastIndexOf("/") > 0;
  const body = named === undefined ? (isObject ? "data" : undefined) : t.bodies[named];
  const headers = fields.filter(field => !field.startsWith("@")).map(field => field.split(/=(.*)/s).slice(0, 2));
  const query = [...new URLSearchParams(search)];
  const options = { query, headers: Object.fromEntries(headers), body, anonymous: sender === "anonymous" };
  return t.clients[sender as Sender].fetch(method, path, options);
}

async function expectAccess(t: Accounts, table: string): Promise<void> {
  const lines = table.trim().split("\n");
  const rows = lines.map(line => line.trim().split(/\s{2,}/));
  const results: string[][] = [];
  for (const [request, ...expected] of rows) {
    const row = [request];
    // The three senders wait for their turn. A request can change what the next one finds.
    for (const [index, sender] of SENDERS.entries()) {
      row.push(expected[index] === "-" ? "-" : await outcome(send(t, `${sender} ${request}`)));
    }
    results.push(row);
  }
  expect(results).toEqual(rows);
}

/** The error document of a request without the IDs of the request. */
async function failure(t: Accounts, line: string, status: number, code: string): Promise<object> {
  const { RequestId, HostId, ...error } = await expectError(await send(t, line), status, code);
  return error;
}

/** The owner and the grants of an ACL, each grant as `type name permission`. The sender reads the ACL. */
async function grants(t: Accounts, path: string, sender: Sender = "owner"): Promise<string[]> {
  const root = await xml(await send(t, `${sender} GET ${path}?acl`));
  const list = children(child(root, "AccessControlList"), "Grant").map(item => {
    const grantee = child(item, "Grantee")!;
    const name = childText(grantee, "ID") ?? childText(grantee, "URI");
    return [grantee.attributes["xsi:type"], name, childText(item, "Permission")].join(" ");
  });
  return ["Owner " + childText(child(root, "Owner"), "ID"), ...list];
}

const user = (id: string, permission = "FULL_CONTROL") => `CanonicalUser ${id} ${permission}`;

describe("a private bucket", () => {
  const configurations = `acl cors policy tagging versioning requestPayment ownershipControls object-lock lifecycle
    encryption website notification logging replication accelerate publicAccessBlock`.split(/\s+/);
  const removable = "cors policy tagging ownershipControls lifecycle encryption website replication publicAccessBlock";
  const requests = `GET /test-bucket; GET /test-bucket?list-type=2; GET /test-bucket?versions; GET /test-bucket?uploads;
    HEAD /test-bucket; DELETE /test-bucket; GET /test-bucket?location; GET /test-bucket?policyStatus;
    GET /test-bucket/key; HEAD /test-bucket/key; GET /test-bucket/key?acl; GET /test-bucket/key?tagging;
    GET /test-bucket/key?attributes x-amz-object-attributes=ETag; PUT /test-bucket/key; PUT /test-bucket/new-key;
    PUT /test-bucket/key?acl x-amz-acl=public-read; PUT /test-bucket/key?tagging @tags; DELETE /test-bucket/key;
    PUT /test-bucket/copy x-amz-copy-source=/test-bucket/key; DELETE /test-bucket/key?tagging;
    DELETE /test-bucket/key?versionId=null; POST /test-bucket/key?uploads`.split(/;\s+/);
  const operations: [name: string, requests: string[]][] = [
    ["on the bucket and the objects", requests],
    ["that reads a configuration", configurations.map(name => `GET /test-bucket?${name}`)],
    ["that writes a configuration", configurations.map(name => `PUT /test-bucket?${name} x-amz-acl=public-read @tags`)],
    ["that removes a configuration", removable.split(" ").map(name => `DELETE /test-bucket?${name}`)],
  ];

  test.each(operations)("refuses each operation %s to another account and to an anonymous sender", async (_, list) => {
    await using t = await startAccounts();
    const refused = (request: string) => (request.startsWith("HEAD") ? "403" : DENIED);
    await t.access(list.map(request => [request, "-", refused(request), refused(request)].join("  ")).join("\n"));
    // The requests changed nothing.
    const bucket = t.server.buckets.get("test-bucket")!;
    const state = [t.server.buckets.size, bucket.configurations.size, bucket.uploads.size, bucket.tags, bucket.policy];
    expect(state).toEqual([1, 0, 0, undefined, undefined]);
    expect(await outcome(send(t, "owner GET /test-bucket/key"))).toBe("200:data");
    expect(await grants(t, KEY)).toEqual([`Owner ${OWNER.id}`, user(OWNER.id)]);
    expect(await grants(t, "/test-bucket")).toEqual([`Owner ${OWNER.id}`, user(OWNER.id)]);
    expect((await t.s3.list()).contents?.map(entry => entry.key)).toEqual(["key"]);
  });

  test("the errors have an order: the authentication, the bucket, the access, the key", async () => {
    await using t = await startAccounts();
    const endpoint = t.server.url;
    const badSecret = new SigningClient({ endpoint, accessKeyId: "AKIAOWNER", secretAccessKey: "wrong-secret" });
    const badKey = new SigningClient({ endpoint, accessKeyId: "AKIAUNKNOWN", secretAccessKey: "owner-secret" });
    for (const path of ["/missing-bucket/key", KEY, "/test-bucket?policy"]) {
      expect(await outcome(badSecret.fetch("GET", path))).toBe("403:SignatureDoesNotMatch");
      expect(await outcome(badKey.fetch("GET", path))).toBe("403:InvalidAccessKeyId");
    }
    await t.access(`
      GET /missing-bucket              404:NoSuchBucket  404:NoSuchBucket  404:NoSuchBucket
      GET /missing-bucket/key          404:NoSuchBucket  404:NoSuchBucket  404:NoSuchBucket
      PUT /missing-bucket/key          404:NoSuchBucket  404:NoSuchBucket  404:NoSuchBucket
      DELETE /missing-bucket?policy    404:NoSuchBucket  404:NoSuchBucket  404:NoSuchBucket
      HEAD /missing-bucket/key         404               404               404
      GET /test-bucket/missing-key     404:NoSuchKey     ${DENIED}  ${DENIED}
      HEAD /test-bucket/missing-key    404               403               403`);
  });

  test("a key that does not exist is NoSuchKey for a sender that can list the bucket", async () => {
    await using t = await startAccounts();
    await t.access(`
      PUT /test-bucket?policy @policy-read          204            -              -
      GET /test-bucket/key                          200:data       200:data       ${DENIED}
      GET /test-bucket/missing-key                  404:NoSuchKey  ${DENIED}      ${DENIED}
      HEAD /test-bucket/missing-key                 404            403            403
      PUT /test-bucket?policy @policy-list          204            -              -
      GET /test-bucket/missing-key                  404:NoSuchKey  404:NoSuchKey  ${DENIED}
      HEAD /test-bucket/missing-key                 404            404            403
      DELETE /test-bucket?policy                    204            -              -
      PUT /test-bucket?acl x-amz-acl=public-read    200            -              -
      GET /test-bucket/missing-key                  404:NoSuchKey  404:NoSuchKey  404:NoSuchKey
      GET /test-bucket/key                          200:data       ${DENIED}      ${DENIED}`);
  });
});

describe("the canned ACLs", () => {
  // The outcomes of the requests of the test for a sender that is not the owner.
  const ALL = ["200", "200", "200", "204"];
  const READ = ["200", DENIED, DENIED, DENIED];
  const NONE = [DENIED, DENIED, DENIED, DENIED];
  test.each([
    ["private", NONE, NONE],
    ["public-read", READ, READ],
    ["public-read-write", ALL, ALL],
    ["authenticated-read", READ, NONE],
    ["aws-exec-read", NONE, NONE],
    ["bucket-owner-full-control", NONE, NONE],
  ])("of a bucket: %s", async (name, other, anonymous) => {
    await using t = await startAccounts();
    // The last sender that writes the object is its owner.
    const owner = anonymous === ALL ? 2 : 0;
    const read = SENDERS.map((_, index) => (index === owner ? "200:data" : DENIED)).join("  ");
    await t.access(`
      PUT /test-bucket?acl x-amz-acl=${name}     200  -  -
      GET /test-bucket?list-type=2               200  ${other[0]}  ${anonymous[0]}
      GET /test-bucket?uploads                   200  ${other[0]}  ${anonymous[0]}
      PUT /test-bucket/new-key                   200  ${other[1]}  ${anonymous[1]}
      PUT /test-bucket/key                       -    ${other[2]}  ${anonymous[2]}
      DELETE /test-bucket/new-key                -    ${other[3]}  ${anonymous[3]}
      DELETE /test-bucket/key?versionId=null     -    ${DENIED}  ${DENIED}
      GET /test-bucket/key                       ${read}
      GET /test-bucket?acl                       200  ${DENIED}  ${DENIED}
      PUT /test-bucket?acl x-amz-acl=private     200  ${DENIED}  ${DENIED}`);
  });

  test.each([
    ["private", DENIED, DENIED],
    ["public-read", "200:data", "200:data"],
    ["public-read-write", "200:data", "200:data"],
    ["authenticated-read", "200:data", DENIED],
    ["aws-exec-read", DENIED, DENIED],
  ])("of an object: %s", async (name, other, anonymous) => {
    await using t = await startAccounts();
    const head = [other, anonymous].map(read => (read === DENIED ? "403" : "200")).join("  ");
    await t.access(`
      PUT /test-bucket/key x-amz-acl=${name}        200       -         -
      GET /test-bucket/key                          200:data  ${other}  ${anonymous}
      HEAD /test-bucket/key                         200       ${head}
      GET /test-bucket/key?acl                      200       ${DENIED}  ${DENIED}
      PUT /test-bucket/key?acl x-amz-acl=private    -         ${DENIED}  ${DENIED}
      PUT /test-bucket/key                          -         ${DENIED}  ${DENIED}
      DELETE /test-bucket/key                       -         ${DENIED}  ${DENIED}`);
  });

  test.each([
    ["", [DENIED, DENIED, DENIED], [user(OTHER.id)]],
    ["x-amz-acl=bucket-owner-read", ["200:data", DENIED, DENIED], [user(OTHER.id), user(OWNER.id, "READ")]],
    ["x-amz-acl=bucket-owner-full-control", ["200:data", "200", "200"], [user(OTHER.id), user(OWNER.id)]],
    [`x-amz-grant-read-acp=id="${OWNER.id}"`, [DENIED, "200", DENIED], [user(OWNER.id, "READ_ACP")]],
  ])("the object of another account with the header %s", async (header, [get, getAcl, putAcl], list) => {
    await using t = await startAccounts();
    // The owner of the bucket has only what the ACL of the object gives. It can remove each object.
    await t.access(`
      PUT /test-bucket?acl x-amz-acl=public-read-write    200        -         -
      PUT /test-bucket/theirs ${header}                   -          200       -
      GET /test-bucket/theirs                             ${get}     200:data  ${DENIED}
      GET /test-bucket/theirs?acl                         ${getAcl}  200       ${DENIED}
      PUT /test-bucket/theirs?acl x-amz-acl=bucket-owner-full-control    ${putAcl}  -  ${DENIED}
      GET /test-bucket/theirs?tagging                     ${DENIED}  200       ${DENIED}`);
    const listed = toObject(await xml(await send(t, "owner GET /test-bucket?prefix=theirs")));
    expect(listed.Contents.Owner).toEqual({ ID: OTHER.id, DisplayName: "other" });
    expect(await grants(t, "/test-bucket/theirs", "other")).toEqual([`Owner ${OTHER.id}`, ...list]);
    expect(await outcome(send(t, "owner DELETE /test-bucket/theirs"))).toBe("204");
  });

  test("the object and the multipart upload of an anonymous sender belong to the anonymous user", async () => {
    await using t = await startAccounts();
    expect(await outcome(send(t, "owner PUT /test-bucket?acl x-amz-acl=public-read-write"))).toBe("200");
    const uploads = ["other", "anonymous"].map(async sender => {
      return childText(await xml(await send(t, `${sender} POST /test-bucket/upload?uploads`)), "UploadId");
    });
    const [theirs, anonymous] = await Promise.all(uploads);
    // The account that started a multipart upload can list the parts and abort the upload.
    await t.access(`
      PUT /test-bucket/new-key                                 -          -          200
      GET /test-bucket/new-key                                 ${DENIED}  ${DENIED}  200:data
      PUT /test-bucket/new-key?acl x-amz-acl=bucket-owner-full-control    ${DENIED}  ${DENIED}  200
      GET /test-bucket/new-key                                 200:data   ${DENIED}  200:data
      GET /test-bucket/upload?uploadId=${theirs}               200        200        ${DENIED}
      DELETE /test-bucket/upload?uploadId=${theirs}            -          -          ${DENIED}
      DELETE /test-bucket/upload?uploadId=${theirs}            -          204        -
      GET /test-bucket/upload?uploadId=${anonymous}            200        ${DENIED}  200
      DELETE /test-bucket/upload?uploadId=${anonymous}         -          ${DENIED}  204`);
    expect(await grants(t, "/test-bucket/new-key")).toEqual([`Owner ${ANONYMOUS}`, user(ANONYMOUS), user(OWNER.id)]);
  });

  test("a name that is no canned ACL, and a canned ACL together with a grant", async () => {
    await using t = await startAccounts();
    const both = `x-amz-acl=private x-amz-grant-read=id=${OWNER.id}`;
    const Message = "Specifying both Canned ACLs and Header Grants is not allowed";
    const unknown = { Code: "InvalidArgument", Message: "", ArgumentName: "x-amz-acl", ArgumentValue: "public" };
    for (const target of ["/test-bucket/new-key", "/test-bucket?acl", "/new-bucket"]) {
      expect(await failure(t, `owner PUT ${target} x-amz-acl=public`, 400, "InvalidArgument")).toEqual(unknown);
      const refused = await failure(t, `owner PUT ${target} ${both}`, 400, "InvalidRequest");
      expect(refused).toEqual({ Code: "InvalidRequest", Message });
    }
    await t.access(`
      PUT /test-bucket/new-key x-amz-acl=log-delivery-write    400:InvalidArgument  -  -
      PUT /test-bucket?acl x-amz-acl=log-delivery-write        200                  -  -
      GET /test-bucket/new-key                                 404:NoSuchKey        -  -`);
  });
});

describe("the ACL", () => {
  test.each(["/test-bucket", KEY])("of %s has a document", async path => {
    await using t = await startAccounts();
    expect(await outcome(send(t, `owner PUT ${path}?acl x-amz-acl=public-read`))).toBe("200");
    const response = await send(t, `owner GET ${path}?acl`);
    const owner = `<ID>${OWNER.id}</ID><DisplayName>owner</DisplayName>`;
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "application/xml"]);
    expect(await response.text()).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<AccessControlPolicy xmlns="${XMLNS}"><Owner>${owner}</Owner>` +
        `<AccessControlList><Grant><Grantee ${XSI} xsi:type="CanonicalUser">${owner}</Grantee>` +
        `<Permission>FULL_CONTROL</Permission></Grant><Grant>${group(ALL_USERS)}<Permission>READ</Permission></Grant>` +
        `</AccessControlList></AccessControlPolicy>`,
    );

    const Message = "Your request was missing a required header";
    const empty = await failure(t, `owner PUT ${path}?acl`, 400, "MissingSecurityHeader");
    expect(empty).toEqual({ Code: "MissingSecurityHeader", Message, MissingHeaderName: "x-amz-acl" });
    await t.access(`
      PUT ${path}?acl @acl                        200                    -  -
      PUT ${path}?acl @acl-cut                    400:MalformedACLError  -  -
      PUT ${path}?acl @acl-root                   400:MalformedACLError  -  -
      PUT ${path}?acl @acl-permission             400:MalformedACLError  -  -
      PUT ${path}?acl @acl-grantee                400:MalformedACLError  -  -
      PUT ${path}?acl @acl-id                     400:InvalidArgument    -  -
      PUT ${path}?acl @acl-group                  400:InvalidArgument    -  -
      PUT ${path}?acl @acl-email                  405:MethodNotAllowed   -  -
      PUT ${path}?acl @acl-owner                  ${DENIED}              -  -
      PUT ${path}?acl x-amz-acl=private @acl      400:UnexpectedContent  -  -
      PUT ${path}?acl x-amz-grant-read=emailAddress="a@example.com"    405:MethodNotAllowed  -  -`);
    const stored = [`Owner ${OWNER.id}`, user(OTHER.id, "READ_ACP"), `Group ${AUTHENTICATED_USERS} READ`];
    expect(await grants(t, path)).toEqual(stored);
    const headers = `owner PUT ${path}?acl x-amz-grant-read=id="${OTHER.id}",uri=${ALL_USERS}`;
    expect(await outcome(send(t, headers))).toBe("200");
    expect(await grants(t, path)).toEqual([`Owner ${OWNER.id}`, user(OTHER.id, "READ"), `Group ${ALL_USERS} READ`]);
    // An ACL without grants takes nothing from the owner.
    expect(await outcome(send(t, `owner PUT ${path}?acl @acl-empty`))).toBe("200");
    expect(await grants(t, path)).toEqual([`Owner ${OWNER.id}`]);
  });

  test.each(["/test-bucket", KEY])("of %s is open to a sender with READ_ACP or WRITE_ACP", async path => {
    await using t = await startAccounts();
    await t.access(`
      PUT ${path}?acl x-amz-grant-read-acp=id=${OTHER.id}        200  -          -
      GET ${path}?acl                                            200  200        ${DENIED}
      PUT ${path}?acl x-amz-acl=private                          -    ${DENIED}  ${DENIED}
      PUT ${path}?acl x-amz-grant-write-acp=uri="${AUTHENTICATED_USERS}"    200  -  -
      GET ${path}?acl                                            200  ${DENIED}  ${DENIED}
      PUT ${path}?acl x-amz-grant-full-control=id=${OTHER.id}    -    200        ${DENIED}
      GET ${path}?acl                                            200  200        ${DENIED}`);
    expect(await grants(t, path)).toEqual([`Owner ${OWNER.id}`, user(OTHER.id)]);
  });
});

describe("the ownership of the objects", () => {
  test("BucketOwnerEnforced turns the ACLs off", async () => {
    await using t = await startAccounts();
    const REFUSED = "400:AccessControlListNotSupported";
    await t.access(`
      PUT /test-bucket?acl x-amz-acl=public-read-write    200       -         -
      PUT /test-bucket/mine x-amz-acl=public-read         200       -         -
      PUT /test-bucket/theirs x-amz-acl=public-read       -         200       -
      GET /test-bucket/theirs                             200:data  200:data  200:data
      PUT /test-bucket?ownershipControls @enforced        400:InvalidBucketAclWithObjectOwnership  -  -
      PUT /test-bucket?acl x-amz-acl=private              200       -         -
      PUT /test-bucket?ownershipControls @enforced        200       -         -
      PUT /test-bucket?policy @policy-write               204       -         -
      GET /test-bucket/mine                               200:data  ${DENIED}  ${DENIED}
      GET /test-bucket/theirs                             200:data  ${DENIED}  ${DENIED}
      PUT /test-bucket/new x-amz-acl=public-read          ${REFUSED}  ${REFUSED}  ${DENIED}
      PUT /test-bucket/new x-amz-grant-read=id=${OTHER.id}    ${REFUSED}  ${REFUSED}  ${DENIED}
      PUT /test-bucket/new x-amz-grant-full-control=id=${OWNER.id}    200  200  ${DENIED}
      PUT /test-bucket/new x-amz-acl=bucket-owner-full-control    200  200    ${DENIED}
      PUT /test-bucket/new x-amz-acl=private              200       200       ${DENIED}
      PUT /test-bucket/new                                200       200       ${DENIED}
      GET /test-bucket/new                                200:data  ${DENIED}  ${DENIED}
      PUT /test-bucket/new?acl x-amz-acl=public-read      ${REFUSED}  ${REFUSED}  ${DENIED}
      PUT /test-bucket/new?acl @acl                       ${REFUSED}  ${REFUSED}  ${DENIED}
      PUT /test-bucket/new?acl @acl-owner                 ${DENIED}  ${DENIED}  ${DENIED}
      PUT /test-bucket/new?acl @acl-full                  200       200       ${DENIED}
      PUT /test-bucket/new?acl x-amz-acl=bucket-owner-full-control    200  200  ${DENIED}
      PUT /test-bucket?acl x-amz-acl=public-read          ${REFUSED}  ${REFUSED}  ${DENIED}
      PUT /test-bucket?acl @acl                           ${REFUSED}  ${REFUSED}  ${DENIED}
      PUT /test-bucket?acl @acl-full                      200       200       ${DENIED}
      PUT /test-bucket?acl x-amz-acl=private              200       200       ${DENIED}`);
    // Each object belongs to the owner of the bucket.
    expect(await grants(t, "/test-bucket/theirs")).toEqual([`Owner ${OWNER.id}`, user(OWNER.id)]);
    expect(await grants(t, "/test-bucket")).toEqual([`Owner ${OWNER.id}`, user(OWNER.id)]);
    // The ACLs are there again when the bucket has them on again.
    await t.access(`
      DELETE /test-bucket?ownershipControls    204       -         -
      GET /test-bucket/mine                    200:data  200:data  200:data
      GET /test-bucket/theirs                  200:data  200:data  200:data`);
    const theirs = [`Owner ${OTHER.id}`, user(OTHER.id), `Group ${ALL_USERS} READ`];
    expect(await grants(t, "/test-bucket/theirs", "other")).toEqual(theirs);
  });

  test("BucketOwnerPreferred gives an object with bucket-owner-full-control to the owner of the bucket", async () => {
    await using t = await startAccounts();
    await t.access(`
      PUT /test-bucket?acl x-amz-acl=public-read-write                200        -          -
      PUT /test-bucket?ownershipControls @preferred                   200        -          -
      PUT /test-bucket/new-key x-amz-acl=bucket-owner-full-control    -          200        -
      GET /test-bucket/new-key                                        200:data   ${DENIED}  ${DENIED}
      GET /test-bucket/new-key?acl                                    200        ${DENIED}  ${DENIED}
      PUT /test-bucket/new-key x-amz-acl=bucket-owner-read            -          200        -
      GET /test-bucket/new-key?acl                                    ${DENIED}  200        ${DENIED}`);
    const list = [`Owner ${OTHER.id}`, user(OTHER.id), user(OWNER.id, "READ")];
    expect(await grants(t, "/test-bucket/new-key", "other")).toEqual(list);
  });
});

describe("the bucket policy", () => {
  test("PutBucketPolicy, GetBucketPolicy, DeleteBucketPolicy and GetBucketPolicyStatus", async () => {
    await using t = await startAccounts();
    const status = async () => toObject(await xml(await send(t, "owner GET /test-bucket?policyStatus")));
    const Message = "The bucket policy does not exist";
    const missing = await failure(t, "owner GET /test-bucket?policy", 404, "NoSuchBucketPolicy");
    expect(missing).toEqual({ Code: "NoSuchBucketPolicy", Message, BucketName: "test-bucket" });
    await t.access(`
      GET /test-bucket?policyStatus            404:NoSuchBucketPolicy  ${DENIED}  ${DENIED}
      PUT /test-bucket?policy @policy-text     204                     ${DENIED}  ${DENIED}
      PUT /test-bucket?policy @policy-words    400:MalformedPolicy     ${DENIED}  ${DENIED}
      PUT /test-bucket?policy @empty           400:MalformedPolicy     -          -
      PUT /test-bucket?policy @policy-bucket   400:MalformedPolicy     -          -
      PUT /test-bucket?policy @policy-action   400:MalformedPolicy     -          -
      PUT /test-bucket?policy @policy-effect   400:MalformedPolicy     -          -
      GET /test-bucket?policy                  -                       ${DENIED}  ${DENIED}
      GET /test-bucket?policyStatus            200                     ${DENIED}  ${DENIED}`);
    // The answer is the text of the client and not a new form of it.
    const stored = await send(t, "owner GET /test-bucket?policy");
    expect([stored.status, stored.headers.get("content-type")]).toEqual([200, "application/json"]);
    expect([await stored.text(), await status()]).toEqual([PUBLIC_POLICY, { IsPublic: "true" }]);
    await t.access(`
      DELETE /test-bucket?policy             204                     ${DENIED}  ${DENIED}
      GET /test-bucket?policy                404:NoSuchBucketPolicy  ${DENIED}  ${DENIED}
      DELETE /test-bucket?policy             204                     ${DENIED}  ${DENIED}
      PUT /test-bucket?policy @policy-all    204                     -          -
      GET /test-bucket?policyStatus          200                     200        ${DENIED}`);
    // S3 lets only the account of the bucket use the policy operations.
    expect(await status()).toEqual({ IsPublic: "false" });
    const refused = await failure(t, "other GET /test-bucket?policy", 405, "MethodNotAllowed");
    expect(refused).toMatchObject({ Method: "GET", ResourceType: "BUCKETPOLICY" });
    await t.access(`
      PUT /test-bucket?policy @policy-text    -    405:MethodNotAllowed  ${DENIED}
      DELETE /test-bucket?policy              -    405:MethodNotAllowed  ${DENIED}
      GET /test-bucket?policy                 200:${BODIES["policy-all"]}  405:MethodNotAllowed  ${DENIED}`);
  });

  const SSE = "x-amz-server-side-encryption";
  // The statements of a policy, and the requests with the outcomes for the three senders.
  const EFFECTS: Record<string, [statements: string, table: string]> = {
    "an Allow for everyone makes the objects public": [
      "Allow everyone s3:GetObject /*",
      `GET /test-bucket/key           200:data  200:data   200:data
       HEAD /test-bucket/key          200       200        200
       GET /test-bucket/key?acl       200       ${DENIED}  ${DENIED}
       GET /test-bucket               200       ${DENIED}  ${DENIED}
       DELETE /test-bucket/new-key    204       ${DENIED}  ${DENIED}`,
    ],
    "an Allow for an account by its ID": [
      "Allow other s3:GetObject,s3:PutObject /*",
      `GET /test-bucket/key           200:data  200:data   ${DENIED}
       PUT /test-bucket/new-key       200       200        ${DENIED}
       DELETE /test-bucket/new-key    -         ${DENIED}  ${DENIED}`,
    ],
    "an Allow for an account by its ARN": [
      "Allow other-by-arn s3:GetObject,s3:DeleteObject /*",
      `GET /test-bucket/key           200:data  200:data   ${DENIED}
       PUT /test-bucket/new-key       200       ${DENIED}  ${DENIED}
       DELETE /test-bucket/new-key    -         204        ${DENIED}`,
    ],
    "an Allow for s3:ListBucket with a condition for the prefix": [
      "Allow everyone s3:ListBucket / StringLike s3:prefix public/*,shared/*",
      `GET /test-bucket?prefix=public/                     200  200        200
       GET /test-bucket?list-type=2&prefix=shared/2025/    200  200        200
       GET /test-bucket?prefix=private/                    200  ${DENIED}  ${DENIED}
       GET /test-bucket?prefix=public                      200  ${DENIED}  ${DENIED}
       GET /test-bucket                                    200  ${DENIED}  ${DENIED}`,
    ],
    "a Deny for plain HTTP refuses also the owner and an account with an Allow": [
      `Allow other    s3:* *
       Deny  everyone s3:* * Bool aws:SecureTransport false`,
      `GET /test-bucket/key    ${DENIED}  ${DENIED}  ${DENIED}
       PUT /test-bucket/key    ${DENIED}  ${DENIED}  ${DENIED}
       GET /test-bucket        ${DENIED}  ${DENIED}  ${DENIED}
       GET /test-bucket?acl    ${DENIED}  ${DENIED}  ${DENIED}`,
    ],
    "a Deny wins over an Allow and over the grant of an ACL": [
      `Allow everyone s3:GetObject               /*
       Deny  other    s3:GetObject,s3:ListBucket *`,
      `PUT /test-bucket?acl x-amz-acl=public-read    200       -          -
       GET /test-bucket/key                          200:data  ${DENIED}  200:data
       GET /test-bucket                              200       ${DENIED}  200`,
    ],
    "the owner can remove a policy that refuses everything to everyone": [
      "Deny everyone * *",
      `GET /test-bucket/key             ${DENIED}  ${DENIED}  ${DENIED}
       GET /test-bucket?location        ${DENIED}  ${DENIED}  ${DENIED}
       GET /test-bucket?policyStatus    ${DENIED}  ${DENIED}  ${DENIED}
       DELETE /test-bucket?policy       -          ${DENIED}  ${DENIED}
       DELETE /test-bucket?policy       204        -          -
       GET /test-bucket/key             200:data   ${DENIED}  ${DENIED}`,
    ],
    "a condition for the address of the sender": [
      `Allow everyone s3:GetObject  /key IpAddress    aws:SourceIp 127.0.0.1
       Allow everyone s3:GetObject  /far IpAddress    aws:SourceIp 10.0.0.0/8
       Deny  everyone s3:ListBucket /    NotIpAddress aws:SourceIp 10.0.0.0/8,192.168.0.0/16`,
      `GET /test-bucket/key    200:data   200:data   200:data
       PUT /test-bucket/far    200        ${DENIED}  ${DENIED}
       GET /test-bucket/far    200:data   ${DENIED}  ${DENIED}
       GET /test-bucket        ${DENIED}  ${DENIED}  ${DENIED}`,
    ],
    "the conditions for the ACL and the encryption of PutObject": [
      `Allow other    s3:PutObject /*        StringEquals    s3:x-amz-acl bucket-owner-full-control
       Deny  everyone s3:PutObject /secret/* Null            s3:${SSE}    true
       Deny  everyone s3:PutObject /aes/*    StringNotEquals s3:${SSE}    AES256`,
      `PUT /test-bucket/new                                        200        ${DENIED}  ${DENIED}
       PUT /test-bucket/new x-amz-acl=public-read                  200        ${DENIED}  ${DENIED}
       PUT /test-bucket/new x-amz-acl=bucket-owner-full-control    -          200        ${DENIED}
       GET /test-bucket/new                                        200:data   200:data   ${DENIED}
       PUT /test-bucket/secret/key                                 ${DENIED}  ${DENIED}  ${DENIED}
       PUT /test-bucket/secret/key ${SSE}=AES256                   200        ${DENIED}  ${DENIED}
       PUT /test-bucket/aes/key                                    ${DENIED}  ${DENIED}  ${DENIED}
       PUT /test-bucket/aes/key ${SSE}=aws:kms                     ${DENIED}  ${DENIED}  ${DENIED}
       PUT /test-bucket/aes/key ${SSE}=AES256                      200        ${DENIED}  ${DENIED}
       PUT /test-bucket/aes/key ${SSE}=AES192                      ${DENIED}  ${DENIED}  ${DENIED}
       PUT /test-bucket/key ${SSE}=AES192                          400:InvalidArgument  ${DENIED}  ${DENIED}`,
    ],
  };

  test.each(Object.keys(EFFECTS))("%s", async name => {
    await using t = await startAccounts();
    const [statements, table] = EFFECTS[name];
    t.bodies.policy = policy(statements);
    await t.access("PUT /test-bucket?policy @policy  204  -  -\n" + table);
  });
});

describe("more rules for the access", () => {
  test("the public access block", async () => {
    await using t = await startAccounts();
    await t.access(`
      PUT /test-bucket?acl x-amz-acl=public-read              200        -          -
      PUT /test-bucket/key x-amz-acl=public-read              200        -          -
      PUT /test-bucket?publicAccessBlock @ignore-acls         200        -          -
      GET /test-bucket                                        200        ${DENIED}  ${DENIED}
      GET /test-bucket/key                                    200:data   ${DENIED}  ${DENIED}
      PUT /test-bucket?publicAccessBlock @block-acls          200        -          -
      GET /test-bucket                                        200        200        200
      GET /test-bucket/key                                    200:data   200:data   200:data
      PUT /test-bucket?acl x-amz-acl=public-read              ${DENIED}  -          -
      PUT /test-bucket?acl x-amz-acl=authenticated-read       ${DENIED}  -          -
      PUT /test-bucket?acl @acl-public                        ${DENIED}  -          -
      PUT /test-bucket/key?acl x-amz-acl=public-read-write    ${DENIED}  -          -
      PUT /test-bucket/key?acl @acl-public                    ${DENIED}  -          -
      PUT /test-bucket/new x-amz-acl=public-read              ${DENIED}  -          -
      PUT /test-bucket/new x-amz-grant-read=uri="${ALL_USERS}"    ${DENIED}  -      -
      PUT /test-bucket/new x-amz-acl=bucket-owner-read        200        -          -
      PUT /test-bucket?acl x-amz-acl=private                  200        -          -
      PUT /test-bucket?publicAccessBlock @block-policy        200        -          -
      PUT /test-bucket?policy @policy-public                  ${DENIED}  -          -
      PUT /test-bucket?policy @policy-read                    204        -          -
      DELETE /test-bucket?publicAccessBlock                   204        -          -
      PUT /test-bucket?policy @policy-public                  204        -          -
      GET /test-bucket/new                                    200:data   200:data   200:data
      GET /test-bucket                                        200        200        ${DENIED}
      PUT /test-bucket?publicAccessBlock @restrict            200        -          -
      GET /test-bucket/new                                    200:data   ${DENIED}  ${DENIED}
      GET /test-bucket                                        200        ${DENIED}  ${DENIED}`);
  });

  test("a bucket with Requester Pays and the header x-amz-expected-bucket-owner", async () => {
    await using t = await startAccounts();
    const mine = "x-amz-expected-bucket-owner=" + OWNER.accountId;
    const theirs = "x-amz-expected-bucket-owner=" + OTHER.accountId;
    const copy = "PUT /test-bucket/copy x-amz-copy-source=/test-bucket/key x-amz-source-expected-bucket-owner";
    const pays = "x-amz-request-payer=requester";
    // The owner pays for its requests. Another account must accept the charge. An anonymous sender cannot pay.
    await t.access(`
      PUT /test-bucket?acl x-amz-acl=public-read-write    200        -          -
      PUT /test-bucket/key x-amz-acl=public-read          200        -          -
      GET /test-bucket/key ${mine}                        200:data   200:data   200:data
      GET /test-bucket/key ${theirs}                      ${DENIED}  ${DENIED}  ${DENIED}
      GET /test-bucket ${theirs}                          ${DENIED}  ${DENIED}  ${DENIED}
      ${copy}=${OWNER.accountId} ${mine}                  200        -          -
      ${copy}=${OTHER.accountId} ${mine}                  ${DENIED}  -          -
      PUT /test-bucket?requestPayment @payment            200        -          -
      GET /test-bucket/key                                200:data   ${DENIED}  ${DENIED}
      GET /test-bucket/key ${pays}                        200:data   200:data   ${DENIED}
      GET /test-bucket/key?${pays}                        200:data   200:data   ${DENIED}
      PUT /test-bucket/new-key                            200        ${DENIED}  ${DENIED}
      PUT /test-bucket/new-key ${pays}                    200        200        ${DENIED}
      GET /test-bucket ${pays}                            200        200        ${DENIED}`);
    const charged = await send(t, `other GET /test-bucket/key ${pays}`);
    expect(charged.headers.get("x-amz-request-charged")).toBe("requester");
  });
});

describe("CORS", () => {
  const ORIGIN = "https://app.example.com";
  const VARY = "Origin, Access-Control-Request-Headers, Access-Control-Request-Method";
  const SITE = {
    "access-control-allow-origin": ORIGIN,
    "access-control-allow-methods": "GET, PUT",
    "access-control-expose-headers": "ETag, x-amz-version-id",
    "access-control-max-age": "600",
    "access-control-allow-credentials": "true",
    "vary": VARY,
  };
  const EVERYONE = { "access-control-allow-origin": "*", "access-control-allow-methods": "HEAD", "vary": VARY };
  const NOT_ALLOWED =
    "CORSResponse: This CORS request is not allowed. This is usually because the evalution of Origin, request method / Access-Control-Request-Method or Access-Control-Request-Headers are not whitelisted by the resource's CORS spec.";
  const DISABLED = "CORSResponse: CORS is not enabled for this bucket.";
  const NOT_FOUND = "CORSResponse: Bucket not found";
  const NO_ORIGIN = "Insufficient information. Origin request header needed.";
  type Headers = [origin?: string, requestMethod?: string, requestHeaders?: string];

  /**
   * Sends a request without authentication, with the headers Origin,
   * Access-Control-Request-Method and Access-Control-Request-Headers. The result
   * has the status, the CORS headers and the body or the error document.
   */
  async function cross(t: TestServer, method: string, path: string, values: Headers): Promise<unknown> {
    const names = ["origin", "access-control-request-method", "access-control-request-headers"];
    const headers = names.flatMap((name, index) => (values[index] === undefined ? [] : [[name, values[index]]]));
    const response = await fetch(t.server.url + path, { method, headers: Object.fromEntries(headers) });
    const cors = [...response.headers].filter(([name]) => name.startsWith("access-control-") || name === "vary");
    const text = await response.text();
    if (!text.startsWith("<?xml")) return [response.status, Object.fromEntries(cors), text];
    const { RequestId, HostId, ...error } = toObject(parseXml(text));
    return [response.status, Object.fromEntries(cors), error];
  }
  const forbidden = (Message: string, Method: string, ResourceType: string) => {
    return [403, {}, { Code: "AccessForbidden", Message, Method, ResourceType }];
  };
  const bad = (Message: string) => [400, {}, { Code: "BadRequest", Message }];

  test("PutBucketCors, GetBucketCors and DeleteBucketCors", async () => {
    await using t = await startAccounts();
    const headers = { AllowedHeader: ["x-amz-*", "content-type"], ExposeHeader: ["ETag", "x-amz-version-id"] };
    const site = { ID: "site", AllowedMethod: ["GET", "PUT"], AllowedOrigin: "https://*.example.com", ...headers };
    const stored = {
      CORSRule: [
        { ...site, MaxAgeSeconds: "600" },
        { AllowedMethod: "HEAD", AllowedOrigin: "*" },
      ],
    };
    const Message = "The CORS configuration does not exist";
    const missing = await failure(t, "owner GET /test-bucket?cors", 404, "NoSuchCORSConfiguration");
    expect(missing).toEqual({ Code: "NoSuchCORSConfiguration", Message, BucketName: "test-bucket" });
    await t.access(`
      PUT /test-bucket?cors @cors           200                          ${DENIED}  ${DENIED}
      GET /test-bucket?cors                 200                          ${DENIED}  ${DENIED}
      PUT /test-bucket?cors @cors-empty     400:MalformedXML             -          -
      PUT /test-bucket?cors @cors-method    400:InvalidRequest           -          -
      PUT /test-bucket?cors @empty          400:MissingRequestBodyError  -          -`);
    expect(toObject(await xml(await send(t, "owner GET /test-bucket?cors")))).toEqual(stored);
    await t.access(`
      DELETE /test-bucket?cors    204                          ${DENIED}  ${DENIED}
      GET /test-bucket?cors       404:NoSuchCORSConfiguration  ${DENIED}  ${DENIED}
      DELETE /test-bucket?cors    204                          -          -`);
  });

  test("a preflight request needs no authentication and gets the headers of the rule that matches", async () => {
    await using t = await startAccounts({ buckets: ["test-bucket", "no-cors"] });
    expect(await outcome(send(t, "owner PUT /test-bucket?cors @cors"))).toBe("200");
    const allowed = { ...SITE, "access-control-allow-headers": "content-type, x-amz-meta-name" };
    const cases: [path: string, headers: Headers, expected: unknown][] = [
      ["/test-bucket", [ORIGIN, "GET"], [200, SITE, ""]],
      [KEY, [ORIGIN, "PUT", "Content-Type, X-Amz-Meta-Name"], [200, allowed, ""]],
      ["/test-bucket/no/such/key", ["null", "HEAD"], [200, EVERYONE, ""]],
      [KEY, [ORIGIN, "DELETE"], forbidden(NOT_ALLOWED, "DELETE", "OBJECT")],
      ["/test-bucket", ["https://example.org", "GET"], forbidden(NOT_ALLOWED, "GET", "BUCKET")],
      [KEY, [ORIGIN, "GET", "authorization"], forbidden(NOT_ALLOWED, "GET", "OBJECT")],
      ["/no-cors/key", [ORIGIN, "GET"], forbidden(DISABLED, "GET", "OBJECT")],
      ["/no-cors", [ORIGIN, "PUT"], forbidden(DISABLED, "PUT", "BUCKET")],
      ["/missing-bucket/key", [ORIGIN, "GET"], forbidden(NOT_FOUND, "GET", "OBJECT")],
      [KEY, [undefined, "GET"], bad(NO_ORIGIN)],
      [KEY, [ORIGIN], bad("Invalid Access-Control-Request-Method: null")],
      [KEY, [ORIGIN, "PATCH"], bad("Invalid Access-Control-Request-Method: PATCH")],
    ];
    const results = await Promise.all(cases.map(([path, headers]) => cross(t, "OPTIONS", path, headers)));
    expect(results).toEqual(cases.map(([, , expected]) => expected));
  });

  test("a request with the Origin header gets the CORS headers, also when it fails", async () => {
    await using t = await startAccounts();
    await t.access(`
      PUT /test-bucket?cors @cors                   200  -  -
      PUT /test-bucket?acl x-amz-acl=public-read    200  -  -
      PUT /test-bucket/key x-amz-acl=public-read    200  -  -`);
    const denied = { Code: "AccessDenied", Message: "Access Denied" };
    const noKey = { Code: "NoSuchKey", Message: "The specified key does not exist.", Key: "missing-key" };
    const cases: [method: string, path: string, headers: Headers, expected: unknown][] = [
      ["GET", KEY, [ORIGIN], [200, SITE, "data"]],
      ["HEAD", KEY, ["https://example.org"], [200, EVERYONE, ""]],
      ["GET", KEY, ["https://example.org"], [200, {}, "data"]],
      ["GET", KEY, [], [200, {}, "data"]],
      ["GET", "/test-bucket/missing-key", [ORIGIN], [404, SITE, noKey]],
      ["PUT", KEY, [ORIGIN], [403, SITE, denied]],
      ["DELETE", KEY, [ORIGIN], [403, {}, denied]],
      // S3 takes the method from Access-Control-Request-Method when the request has this header.
      ["DELETE", KEY, [ORIGIN, "GET"], [403, SITE, denied]],
      ["GET", KEY, [ORIGIN, "DELETE"], [200, {}, "data"]],
    ];
    const results = await Promise.all(cases.map(([method, path, headers]) => cross(t, method, path, headers)));
    expect(results).toEqual(cases.map(([, , , expected]) => expected));
  });
});
