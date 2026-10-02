// Decides if the sender of a request can do an operation.
//
// The account that owns a bucket can do everything with the bucket and with
// the objects that it owns. Other senders need a grant in an ACL or an Allow
// statement in the bucket policy. A Deny statement always wins. An object
// belongs to the account that wrote it. When that is not the account of the
// bucket, only the owner of the object and the ACL of the object give access
// to it. The bucket policy can refuse the access and cannot give it.

import {
  aclAllows,
  aclIsPublic,
  ANONYMOUS_USER_ID,
  headersGrantPublicAccess,
  type Grant,
  type Permission,
} from "./acl.ts";
import type { RequestContext } from "./context.ts";
import { parseAmzDate } from "./encoding.ts";
import { malformedXml, S3Error } from "./errors.ts";
import { evaluateBucketPolicy, isPublicPolicy } from "./policy.ts";
import type { Owner } from "./signature.ts";
import type { Bucket, ObjectVersion, Tag } from "./store.ts";
import { childText, parseXml } from "./xml.ts";

/**
 * The grant of an ACL that allows the operation.
 * `OWNER` is for an operation that no ACL can allow.
 */
export type RequiredGrant = Permission | "OWNER";

export interface AuthorizationRequest {
  /** The IAM action, for example `s3:GetObject`. */
  action: string;
  bucket: Bucket;
  /** The key, for an operation on an object. */
  key?: string;
  /** Which ACL the grant must be in. */
  acl: "bucket" | "object";
  grant: RequiredGrant;
  /** The object whose ACL and tags apply. */
  version?: ObjectVersion;
  /** The tags that the request gives to the object. */
  requestTags?: Tag[];
  /** The account that started the multipart upload of the request. It can list the parts and abort the upload. */
  initiator?: Owner;
}

/** The settings of PutPublicAccessBlock. */
export interface PublicAccessBlock {
  blockPublicAcls: boolean;
  ignorePublicAcls: boolean;
  blockPublicPolicy: boolean;
  restrictPublicBuckets: boolean;
}

const NO_PUBLIC_ACCESS_BLOCK: PublicAccessBlock = {
  blockPublicAcls: false,
  ignorePublicAcls: false,
  blockPublicPolicy: false,
  restrictPublicBuckets: false,
};

const POLICY_ADMINISTRATION = ["s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy"];
/** The actions of the requests that can carry an ACL in their headers. */
const ACL_ACTIONS = ["s3:PutObject", "s3:PutObjectAcl", "s3:PutObjectVersionAcl", "s3:PutBucketAcl"];
const INITIATOR_ACTIONS = ["s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"];
const COPY_SOURCE_ACTIONS = ["s3:GetObject", "s3:GetObjectVersion"];

/** Parses the document of PutPublicAccessBlock. A setting that the document does not have is off. */
export function parsePublicAccessBlock(document: string | Uint8Array): PublicAccessBlock {
  const root = parseXml(document);
  if (root.name !== "PublicAccessBlockConfiguration") throw malformedXml();
  const setting = (name: string): boolean => {
    const text = childText(root, name)?.trim().toLowerCase();
    if (text !== undefined && text !== "true" && text !== "false") throw malformedXml();
    return text === "true";
  };
  return {
    blockPublicAcls: setting("BlockPublicAcls"),
    ignorePublicAcls: setting("IgnorePublicAcls"),
    blockPublicPolicy: setting("BlockPublicPolicy"),
    restrictPublicBuckets: setting("RestrictPublicBuckets"),
  };
}

const publicAccessBlocks = new WeakMap<Bucket, { document: string; settings: PublicAccessBlock }>();

/** The public access block of the bucket. All settings are off when the bucket has none. */
export function publicAccessBlock(bucket: Bucket): PublicAccessBlock {
  const document = bucket.configurations.get("publicAccessBlock");
  if (document === undefined) return NO_PUBLIC_ACCESS_BLOCK;
  let entry = publicAccessBlocks.get(bucket);
  if (entry?.document !== document) {
    entry = { document, settings: parsePublicAccessBlock(document) };
    publicAccessBlocks.set(bucket, entry);
  }
  return entry.settings;
}

/** Refuses an ACL for everyone or for every AWS account when the bucket blocks such ACLs. Returns the ACL. */
export function checkPublicAcl(bucket: Bucket, acl: Grant[]): Grant[] {
  if (publicAccessBlock(bucket).blockPublicAcls && aclIsPublic(acl)) throw new S3Error("AccessDenied");
  return acl;
}

function header(context: RequestContext, name: string): string | undefined {
  return context.headers.get(name) ?? undefined;
}

function policyContext(
  context: RequestContext,
  request: AuthorizationRequest,
): Record<string, string | string[] | undefined> {
  const { query, authentication, sender, now } = context;
  const values: Record<string, string | string[] | undefined> = {
    "aws:SecureTransport": String(context.secure),
    "aws:SourceIp": context.clientAddress,
    "aws:Referer": header(context, "referer"),
    "aws:UserAgent": header(context, "user-agent"),
    "aws:CurrentTime": now.toISOString(),
    "aws:EpochTime": String(Math.floor(now.getTime() / 1000)),
    "aws:PrincipalType": sender ? "Account" : "Anonymous",
    "aws:PrincipalAccount": sender?.accountId,
    "aws:PrincipalArn": sender?.accountId === undefined ? undefined : `arn:aws:iam::${sender.accountId}:root`,
    "aws:userid": sender?.accountId,
    "aws:ResourceAccount": request.bucket.owner.accountId,
    "s3:ResourceAccount": request.bucket.owner.accountId,
    "s3:prefix": query.get("prefix"),
    "s3:delimiter": query.get("delimiter"),
    "s3:max-keys": query.get("max-keys"),
    "s3:VersionId": query.get("versionId"),
    "s3:x-amz-acl": header(context, "x-amz-acl"),
    "s3:x-amz-storage-class": header(context, "x-amz-storage-class"),
    "s3:x-amz-server-side-encryption": header(context, "x-amz-server-side-encryption"),
    "s3:x-amz-server-side-encryption-aws-kms-key-id": header(context, "x-amz-server-side-encryption-aws-kms-key-id"),
    "s3:x-amz-server-side-encryption-customer-algorithm": header(
      context,
      "x-amz-server-side-encryption-customer-algorithm",
    ),
    "s3:x-amz-copy-source": header(context, "x-amz-copy-source"),
    "s3:x-amz-metadata-directive": header(context, "x-amz-metadata-directive"),
    "s3:x-amz-content-sha256": header(context, "x-amz-content-sha256"),
    "s3:x-amz-grant-read": header(context, "x-amz-grant-read"),
    "s3:x-amz-grant-write": header(context, "x-amz-grant-write"),
    "s3:x-amz-grant-read-acp": header(context, "x-amz-grant-read-acp"),
    "s3:x-amz-grant-write-acp": header(context, "x-amz-grant-write-acp"),
    "s3:x-amz-grant-full-control": header(context, "x-amz-grant-full-control"),
    "s3:x-amz-object-ownership": header(context, "x-amz-object-ownership"),
    "s3:x-amz-website-redirect-location": header(context, "x-amz-website-redirect-location"),
    "s3:object-lock-mode": header(context, "x-amz-object-lock-mode"),
    "s3:object-lock-retain-until-date": header(context, "x-amz-object-lock-retain-until-date"),
    "s3:object-lock-legal-hold": header(context, "x-amz-object-lock-legal-hold"),
    "s3:if-match": header(context, "if-match"),
    "s3:if-none-match": header(context, "if-none-match"),
  };
  if (authentication.type !== "anonymous") {
    values["s3:signatureversion"] = "AWS4-HMAC-SHA256";
    values["s3:authType"] =
      authentication.type === "header" ? "REST-HEADER" : authentication.type === "post" ? "POST" : "REST-QUERY-STRING";
    const signed = parseAmzDate(authentication.timestamp);
    if (signed) values["s3:signatureAge"] = String(Math.max(0, now.getTime() - signed.getTime()));
  }
  for (const tag of request.version?.tags ?? []) values["s3:ExistingObjectTag/" + tag.key] = tag.value;
  if (request.requestTags) {
    for (const tag of request.requestTags) values["s3:RequestObjectTag/" + tag.key] = tag.value;
    values["s3:RequestObjectTagKeys"] = request.requestTags.map(tag => tag.key);
  }
  return values;
}

/** True when the request says that its sender pays for it. */
function acceptsCharge(context: RequestContext): boolean {
  const payer = context.headers.get("x-amz-request-payer") ?? context.query.get("x-amz-request-payer");
  return payer?.toLowerCase() === "requester";
}

/** True when the sender can do the operation. */
export function isAuthorized(context: RequestContext, request: AuthorizationRequest): boolean {
  const { sender, headers } = context;
  const { bucket, version, action } = request;
  const isBucketOwner = sender !== undefined && sender.id === bucket.owner.id;

  // The source of a copy has a header of its own for the same check.
  const isCopySource = headers.has("x-amz-copy-source") && COPY_SOURCE_ACTIONS.includes(action);
  const expectedOwner = headers.get(
    isCopySource || bucket !== context.bucket ? "x-amz-source-expected-bucket-owner" : "x-amz-expected-bucket-owner",
  );
  if (expectedOwner !== null && expectedOwner !== bucket.owner.accountId) return false;

  // A bucket with Requester Pays serves the owner, and other accounts that accept the charge.
  if (bucket.requestPayer === "Requester" && !isBucketOwner && (sender === undefined || !acceptsCharge(context))) {
    return false;
  }

  const block = publicAccessBlock(bucket);
  if (block.blockPublicAcls && ACL_ACTIONS.includes(action) && headersGrantPublicAccess(headers)) return false;

  let decision: "Allow" | "Deny" | undefined;
  if (bucket.policy) {
    decision = evaluateBucketPolicy(bucket.policy, {
      principal: sender,
      action,
      resource: `arn:aws:s3:::${bucket.name}${request.key === undefined ? "" : "/" + request.key}`,
      context: policyContext(context, request),
    });
    if (decision === "Deny") {
      // The owner of the bucket can always repair a policy that locks everyone out.
      return isBucketOwner && POLICY_ADMINISTRATION.includes(action);
    }
    if (block.restrictPublicBuckets && !isBucketOwner && isPublicPolicy(bucket.policy)) return false;
  }

  const senderId = sender?.id ?? ANONYMOUS_USER_ID;
  const aclsEnabled = bucket.ownership !== "BucketOwnerEnforced";
  if (request.acl === "object" && version && aclsEnabled && version.owner.id !== bucket.owner.id) {
    if (senderId === version.owner.id) return true;
    return request.grant !== "OWNER" && aclAllows(version.acl, sender, request.grant, block.ignorePublicAcls);
  }

  if (isBucketOwner || decision === "Allow") return true;
  if (request.initiator?.id === senderId && INITIATOR_ACTIONS.includes(action)) return true;
  if (!aclsEnabled || request.grant === "OWNER") return false;
  // The WRITE grant of a bucket lets only the owner of the bucket remove a version.
  if (action === "s3:DeleteObjectVersion") return false;
  if (request.acl === "bucket") return aclAllows(bucket.acl, sender, request.grant, block.ignorePublicAcls);
  return version !== undefined && aclAllows(version.acl, sender, request.grant, block.ignorePublicAcls);
}

export function authorize(context: RequestContext, request: AuthorizationRequest): void {
  if (!isAuthorized(context, request)) throw new S3Error("AccessDenied");
}

/**
 * The error for a key that does not exist. A sender that cannot list the
 * bucket gets `AccessDenied`, so that the response does not tell which keys exist.
 */
export function missingKey(context: RequestContext, bucket: Bucket, key: string, error: S3Error): S3Error {
  const canList = isAuthorized(context, { action: "s3:ListBucket", bucket, acl: "bucket", grant: "READ" });
  return canList ? error : new S3Error("AccessDenied");
}
