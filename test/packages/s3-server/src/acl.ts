// Access control lists: the canned ACLs, the grant headers, the XML document
// and the check of a grant against the sender of a request.

import { invalidArgument, invalidRequest, S3Error } from "./errors.ts";
import type { Owner } from "./signature.ts";
import { child, children, childText, parseXml, XmlAttributes, xmlDocument, type XmlNode } from "./xml.ts";

export type Permission = "FULL_CONTROL" | "READ" | "WRITE" | "READ_ACP" | "WRITE_ACP";

export type Grantee = { type: "CanonicalUser"; id: string; displayName?: string } | { type: "Group"; uri: string };

export interface Grant {
  grantee: Grantee;
  permission: Permission;
}

export const ALL_USERS = "http://acs.amazonaws.com/groups/global/AllUsers";
export const AUTHENTICATED_USERS = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";
export const LOG_DELIVERY = "http://acs.amazonaws.com/groups/s3/LogDelivery";

/** The canonical user ID that S3 gives to the sender of a request without authentication. */
export const ANONYMOUS_USER_ID = "65a011a29cdf8ec533ec3d1ccaae921c";

/** The account of Amazon EC2 that reads the bundle of a machine image. The ACL `aws-exec-read` names it. */
const EC2_BUNDLE_READER = {
  type: "CanonicalUser",
  id: "6aa5a366c34c1cbe25dc49211496e913e0351eb0e8c37aa3477e40942ec6b97c",
  displayName: "za-team",
} as const satisfies Grantee;

const PERMISSIONS: readonly Permission[] = ["FULL_CONTROL", "READ", "WRITE", "READ_ACP", "WRITE_ACP"];
const GROUPS: readonly string[] = [ALL_USERS, AUTHENTICATED_USERS, LOG_DELIVERY];
const PUBLIC_GROUPS: readonly string[] = [ALL_USERS, AUTHENTICATED_USERS];
const PUBLIC_CANNED: readonly string[] = ["public-read", "public-read-write", "authenticated-read"];
const MAX_GRANTS = 100;

const BUCKET_CANNED = [
  "private",
  "public-read",
  "public-read-write",
  "authenticated-read",
  "aws-exec-read",
  "log-delivery-write",
  // S3 accepts the two ACLs of the bucket owner for a bucket and ignores them.
  "bucket-owner-read",
  "bucket-owner-full-control",
];
const OBJECT_CANNED = [
  "private",
  "public-read",
  "public-read-write",
  "authenticated-read",
  "aws-exec-read",
  "bucket-owner-read",
  "bucket-owner-full-control",
];

function user(owner: Owner): Grantee {
  return { type: "CanonicalUser", id: owner.id, displayName: owner.displayName };
}

/** The grantee with that canonical user ID: an account of the server or one of the two users that S3 defines. */
function findUser(id: string, findOwner: (id: string) => Owner | undefined): Grantee | undefined {
  const owner = findOwner(id);
  if (owner) return user(owner);
  if (id === EC2_BUNDLE_READER.id) return EC2_BUNDLE_READER;
  if (id === ANONYMOUS_USER_ID) return { type: "CanonicalUser", id };
  return undefined;
}

function group(uri: string): Grantee {
  return { type: "Group", uri };
}

/** The grants of a canned ACL. `owner` is the owner of the resource that gets the ACL. */
export function cannedAcl(name: string, owner: Owner, bucketOwner: Owner, resource: "bucket" | "object"): Grant[] {
  if (!(resource === "bucket" ? BUCKET_CANNED : OBJECT_CANNED).includes(name)) {
    // S3 sends this error with an empty message.
    throw invalidArgument("", "x-amz-acl", name);
  }
  const grants: Grant[] = [{ grantee: user(owner), permission: "FULL_CONTROL" }];
  switch (name) {
    case "public-read":
      grants.push({ grantee: group(ALL_USERS), permission: "READ" });
      break;
    case "public-read-write":
      grants.push(
        { grantee: group(ALL_USERS), permission: "READ" },
        { grantee: group(ALL_USERS), permission: "WRITE" },
      );
      break;
    case "authenticated-read":
      grants.push({ grantee: group(AUTHENTICATED_USERS), permission: "READ" });
      break;
    case "aws-exec-read":
      grants.push({ grantee: EC2_BUNDLE_READER, permission: "READ" });
      break;
    case "log-delivery-write":
      grants.push(
        { grantee: group(LOG_DELIVERY), permission: "WRITE" },
        { grantee: group(LOG_DELIVERY), permission: "READ_ACP" },
      );
      break;
    case "bucket-owner-read":
      if (bucketOwner.id !== owner.id) grants.push({ grantee: user(bucketOwner), permission: "READ" });
      break;
    case "bucket-owner-full-control":
      if (bucketOwner.id !== owner.id) grants.push({ grantee: user(bucketOwner), permission: "FULL_CONTROL" });
      break;
  }
  return grants;
}

const GRANT_HEADERS: [header: string, permission: Permission][] = [
  ["x-amz-grant-read", "READ"],
  ["x-amz-grant-write", "WRITE"],
  ["x-amz-grant-read-acp", "READ_ACP"],
  ["x-amz-grant-write-acp", "WRITE_ACP"],
  ["x-amz-grant-full-control", "FULL_CONTROL"],
];

/** S3 ended the support for a grantee that an email address names. It answers such a request with the status 405. */
function emailGrantee(): S3Error {
  return new S3Error("MethodNotAllowed");
}

/** The grantees of one grant header: a list of `type=value` or `type="value"`, with commas between them. */
function parseGrantHeader(header: string, value: string, findOwner: (id: string) => Owner | undefined): Grantee[] {
  const grantees: Grantee[] = [];
  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (trimmed === "") continue;
    const match = /^([A-Za-z]+)\s*=\s*(?:"([^"]*)"|([^"]*))$/.exec(trimmed);
    if (!match) throw invalidArgument("Argument format not recognized", header, value);
    const kind = match[1].toLowerCase();
    const target = (match[2] ?? match[3]).trim();
    switch (kind) {
      case "id": {
        const grantee = findUser(target, findOwner);
        if (!grantee) throw invalidArgument("Invalid id", header, value);
        grantees.push(grantee);
        break;
      }
      case "uri":
        if (!GROUPS.includes(target)) throw invalidArgument("Invalid group uri", header, value);
        grantees.push(group(target));
        break;
      case "emailaddress":
        throw emailGrantee();
      default:
        throw invalidArgument("Argument format not recognized", header, value);
    }
  }
  return grantees;
}

/**
 * The ACL that the headers of a request ask for: `x-amz-acl` or the
 * `x-amz-grant-*` headers. Returns `undefined` when the request has none.
 * With the grant headers the ACL has only the grants of the headers. The
 * owner gets no grant of its own.
 */
export function aclFromHeaders(
  headers: Headers,
  owner: Owner,
  bucketOwner: Owner,
  resource: "bucket" | "object",
  findOwner: (id: string) => Owner | undefined,
): Grant[] | undefined {
  const canned = headers.get("x-amz-acl");
  const hasGrantHeader = GRANT_HEADERS.some(([header]) => headers.has(header));
  if (canned !== null) {
    if (hasGrantHeader) throw invalidRequest("Specifying both Canned ACLs and Header Grants is not allowed");
    return cannedAcl(canned, owner, bucketOwner, resource);
  }
  if (!hasGrantHeader) return undefined;

  const grants: Grant[] = [];
  for (const [header, permission] of GRANT_HEADERS) {
    const value = headers.get(header);
    if (value === null) continue;
    for (const grantee of parseGrantHeader(header, value, findOwner)) grants.push({ grantee, permission });
  }
  if (grants.length > MAX_GRANTS) throw malformedAcl();
  return grants;
}

/** True when the ACL headers of the request give a permission to everyone or to every AWS account. */
export function headersGrantPublicAccess(headers: Headers): boolean {
  const canned = headers.get("x-amz-acl");
  if (canned !== null && PUBLIC_CANNED.includes(canned)) return true;
  return GRANT_HEADERS.some(([header]) => {
    const value = headers.get(header);
    return value !== null && PUBLIC_GROUPS.some(uri => value.includes(uri));
  });
}

export function privateAcl(owner: Owner): Grant[] {
  return [{ grantee: user(owner), permission: "FULL_CONTROL" }];
}

/** True when the ACL gives full control to the owner and nothing to another grantee. */
export function isOwnerFullControl(grants: Grant[], owner: Owner): boolean {
  return grants.every(
    grant =>
      grant.permission === "FULL_CONTROL" && grant.grantee.type === "CanonicalUser" && grant.grantee.id === owner.id,
  );
}

/**
 * True when a bucket without ACLs accepts the ACL of a request: the canned ACL
 * `private` or `bucket-owner-full-control`, or grants that give full control
 * to the owner of the bucket and nothing to another grantee.
 */
export function isAclWithoutEffect(headers: Headers, grants: Grant[], bucketOwner: Owner): boolean {
  const canned = headers.get("x-amz-acl");
  if (canned === "private" || canned === "bucket-owner-full-control") return true;
  return grants.length > 0 && isOwnerFullControl(grants, bucketOwner);
}

function granteeNode(grantee: Grantee): XmlNode {
  const attributes = { "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance", "xsi:type": grantee.type };
  switch (grantee.type) {
    case "CanonicalUser":
      return new XmlAttributes(attributes, { ID: grantee.id, DisplayName: grantee.displayName });
    case "Group":
      return new XmlAttributes(attributes, { URI: grantee.uri });
  }
}

export function serializeAcl(owner: Owner, grants: Grant[]): string {
  return xmlDocument("AccessControlPolicy", {
    Owner: { ID: owner.id, DisplayName: owner.displayName },
    AccessControlList: {
      Grant: grants.map(grant => ({ Grantee: granteeNode(grant.grantee), Permission: grant.permission })),
    },
  });
}

/**
 * The ACL document of an object. In a bucket without ACLs the owner of the
 * bucket owns each object and has the only grant.
 */
export function serializeObjectAcl(
  bucket: { owner: Owner; ownership?: string },
  version: { owner: Owner; acl: Grant[] },
): string {
  if (bucket.ownership === "BucketOwnerEnforced") return serializeAcl(bucket.owner, privateAcl(bucket.owner));
  return serializeAcl(version.owner, version.acl);
}

function malformedAcl(): S3Error {
  return new S3Error("MalformedACLError");
}

/** Parses the `<AccessControlPolicy>` body of PutBucketAcl and PutObjectAcl. */
export function parseAcl(
  body: string | Uint8Array,
  owner: Owner,
  findOwner: (id: string) => Owner | undefined,
): Grant[] {
  let root;
  try {
    root = parseXml(body);
  } catch {
    throw malformedAcl();
  }
  if (root.name !== "AccessControlPolicy") throw malformedAcl();
  const ownerId = childText(child(root, "Owner"), "ID")?.trim();
  if (ownerId === undefined) throw malformedAcl();
  // S3 does not let an ACL change the owner.
  if (ownerId !== owner.id) throw new S3Error("AccessDenied");

  const list = child(root, "AccessControlList");
  if (!list) throw malformedAcl();
  const elements = children(list, "Grant");
  if (elements.length !== list.children.length || elements.length > MAX_GRANTS) throw malformedAcl();

  const grants: Grant[] = [];
  for (const element of elements) {
    const permission = childText(element, "Permission")?.trim() as Permission | undefined;
    if (permission === undefined || !PERMISSIONS.includes(permission)) throw malformedAcl();
    const grantee = child(element, "Grantee");
    if (!grantee) throw malformedAcl();
    const type = grantee.attributes["xsi:type"] ?? grantee.attributes["type"];
    const id = childText(grantee, "ID")?.trim();
    const uri = childText(grantee, "URI")?.trim();
    const email = childText(grantee, "EmailAddress");
    if (type === "CanonicalUser" || (type === undefined && id !== undefined)) {
      if (id === undefined) throw malformedAcl();
      const known = findUser(id, findOwner);
      if (!known) throw invalidArgument("Invalid id", "CanonicalUser/ID", id);
      grants.push({ grantee: known, permission });
    } else if (type === "Group" || (type === undefined && uri !== undefined)) {
      if (uri === undefined) throw malformedAcl();
      if (!GROUPS.includes(uri)) throw invalidArgument("Invalid group uri", "Group/URI", uri);
      grants.push({ grantee: group(uri), permission });
    } else if (type === "AmazonCustomerByEmail" || (type === undefined && email !== undefined)) {
      if (email === undefined) throw malformedAcl();
      throw emailGrantee();
    } else {
      throw malformedAcl();
    }
  }
  return grants;
}

/**
 * True when the ACL gives the permission to the sender. `undefined` is an
 * anonymous sender. S3 takes it as the canonical user `ANONYMOUS_USER_ID`, the
 * owner of each object that an anonymous request wrote. `ignorePublic` leaves
 * out the grants to everyone and to every AWS account.
 */
export function aclAllows(
  grants: Grant[],
  sender: Owner | undefined,
  permission: Permission,
  ignorePublic = false,
): boolean {
  const id = sender?.id ?? ANONYMOUS_USER_ID;
  for (const grant of grants) {
    if (grant.permission !== permission && grant.permission !== "FULL_CONTROL") continue;
    const grantee = grant.grantee;
    if (grantee.type === "CanonicalUser") {
      if (grantee.id === id) return true;
    } else if (!ignorePublic) {
      if (grantee.uri === ALL_USERS) return true;
      if (grantee.uri === AUTHENTICATED_USERS && sender !== undefined) return true;
    }
  }
  return false;
}

/** True when the ACL gives a permission to everyone or to every AWS account. */
export function aclIsPublic(grants: Grant[]): boolean {
  return grants.some(grant => grant.grantee.type === "Group" && PUBLIC_GROUPS.includes(grant.grantee.uri));
}
