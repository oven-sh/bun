// ListBuckets and the operations on a bucket and its configuration.

import {
  aclFromHeaders,
  aclIsPublic,
  isAclWithoutEffect,
  isOwnerFullControl,
  parseAcl,
  privateAcl,
  serializeAcl,
  type Grant,
} from "../acl.ts";
import { authorize, checkPublicAcl, isAuthorized, parsePublicAccessBlock, publicAccessBlock } from "../authorize.ts";
import { readDocument } from "../body.ts";
import { emptyResponse, parseInteger, rawXmlResponse, xmlResponse, type RequestContext } from "../context.ts";
import { parseCorsConfiguration, preflightResponseHeaders, serializeCorsConfiguration } from "../cors.ts";
import { S3Error, invalidArgument, invalidRequest, malformedXml, type S3ErrorCode } from "../errors.ts";
import { parseTagging, serializeTagging, validateTags } from "../metadata.ts";
import { isPublicPolicy, parseBucketPolicy } from "../policy.ts";
import { Bucket, isValidBucketName, type Tag } from "../store.ts";
import { child, children, childText, parseXml, xmlDocument, type XmlElement } from "../xml.ts";
import { requireBucket } from "./common.ts";

const DEFAULT_REGION = "us-east-1";

/** The values of LocationConstraint that S3 knows. `us-east-1` is not one of them. */
const LOCATION_CONSTRAINTS = new Set(
  `af-south-1 ap-east-1 ap-east-2 ap-northeast-1 ap-northeast-2 ap-northeast-3 ap-south-1 ap-south-2
  ap-southeast-1 ap-southeast-2 ap-southeast-3 ap-southeast-4 ap-southeast-5 ap-southeast-6 ap-southeast-7
  ca-central-1 ca-west-1 cn-north-1 cn-northwest-1 EU eu-central-1 eu-central-2 eu-north-1 eu-south-1 eu-south-2
  eu-west-1 eu-west-2 eu-west-3 il-central-1 me-central-1 me-south-1 mx-central-1 sa-east-1 us-east-2
  us-gov-east-1 us-gov-west-1 us-west-1 us-west-2`.split(/\s+/),
);

const OWNERSHIPS = ["BucketOwnerEnforced", "BucketOwnerPreferred", "ObjectWriter"] as const;
type Ownership = (typeof OWNERSHIPS)[number];

function isOwnership(value: string | null | undefined): value is Ownership {
  return (OWNERSHIPS as readonly string[]).includes(value ?? "");
}

const LIST_BUCKETS_PARAMETERS = ["prefix", "bucket-region", "max-buckets", "continuation-token"];
const MAX_BUCKETS = 10000;

/** Reads the document of a request that has no meaning without one. */
async function readConfiguration(context: RequestContext): Promise<Uint8Array> {
  const body = await readDocument(context);
  if (body.length === 0) throw new S3Error("MissingRequestBodyError");
  return body;
}

function bucketAfter(token: string): string {
  const name = /^[A-Za-z0-9_-]+$/.test(token) ? Buffer.from(token, "base64url").toString("utf8") : "";
  if (!isValidBucketName(name)) {
    throw invalidArgument("The continuation token provided is incorrect", "continuation-token", token);
  }
  return name;
}

export async function listBuckets(context: RequestContext): Promise<Response> {
  const { sender, query } = context;
  if (!sender) throw new S3Error("AccessDenied");

  const prefix = query.get("prefix") ?? "";
  const region = query.get("bucket-region");
  const maxBuckets = parseInteger(query.get("max-buckets"), "max-buckets", { min: 1, max: MAX_BUCKETS });
  const token = query.get("continuation-token");
  const after = token === undefined ? undefined : bucketAfter(token);

  const owned = [...context.server.buckets.values()]
    .filter(bucket => bucket.owner.id === sender.id)
    .filter(bucket => bucket.name.startsWith(prefix))
    .filter(bucket => region === undefined || bucket.region === region)
    .filter(bucket => after === undefined || bucket.name > after)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  // A request with one parameter at least gets pages of 10000 buckets and the region of each bucket.
  const withRegion = LIST_BUCKETS_PARAMETERS.some(name => query.has(name));
  const page = owned.slice(0, maxBuckets ?? (withRegion ? MAX_BUCKETS : undefined));
  const truncated = page.length < owned.length;

  return xmlResponse("ListAllMyBucketsResult", {
    Owner: { ID: sender.id, DisplayName: sender.displayName },
    Buckets: {
      Bucket: page.map(bucket => ({
        Name: bucket.name,
        CreationDate: bucket.creationDate,
        BucketRegion: withRegion ? bucket.region : undefined,
      })),
    },
    ContinuationToken: truncated ? Buffer.from(page[page.length - 1].name, "utf8").toString("base64url") : undefined,
    Prefix: prefix === "" ? undefined : prefix,
  });
}

interface BucketLocation {
  region: string;
  /** The value that GetBucketLocation returns. */
  constraint: string;
}

/** The place of a new bucket, from the region of the endpoint and the LocationConstraint of the request. */
function bucketLocation(endpoint: string, constraint: string | undefined): BucketLocation {
  if (constraint === undefined || constraint === "") {
    if (endpoint !== DEFAULT_REGION) throw new S3Error("IllegalLocationConstraintException");
    return { region: DEFAULT_REGION, constraint: "" };
  }
  const details = { LocationConstraint: constraint };
  const region = constraint === "EU" ? "eu-west-1" : constraint;
  const isKnown = LOCATION_CONSTRAINTS.has(constraint) || region === endpoint;
  if (region === DEFAULT_REGION || !isKnown) throw new S3Error("InvalidLocationConstraint", { details });
  // The endpoint of us-east-1 makes buckets in all regions. Each other endpoint makes them in its region only.
  if (endpoint !== DEFAULT_REGION && region !== endpoint) {
    throw new S3Error("IllegalLocationConstraintException", {
      message: `The ${constraint} location constraint is incompatible for the region specific endpoint this request was sent to.`,
      details,
    });
  }
  return { region, constraint };
}

function tagsOf(element: XmlElement | undefined): Tag[] | undefined {
  if (!element) return undefined;
  const tags = children(element, "Tag").map(tag => {
    const key = childText(tag, "Key");
    const value = childText(tag, "Value");
    if (key === undefined || value === undefined) throw malformedXml();
    return { key, value };
  });
  return validateTags(tags, "bucket");
}

export async function createBucket(context: RequestContext): Promise<Response> {
  const { sender, server, headers } = context;
  const name = context.bucketName!;
  if (!sender) throw new S3Error("AccessDenied");
  if (!isValidBucketName(name)) {
    throw new S3Error("InvalidBucketName", { details: { BucketName: name } });
  }

  const body = await readDocument(context);
  let constraint: string | undefined;
  let tags: Tag[] | undefined;
  if (body.length > 0) {
    const root = parseXml(body);
    if (root.name !== "CreateBucketConfiguration") throw malformedXml();
    if (child(root, "Location") || child(root, "Bucket")) {
      // A directory bucket is a different kind of bucket with a different API.
      throw new S3Error("NotImplemented", { details: { Header: "CreateBucketConfiguration" } });
    }
    constraint = childText(root, "LocationConstraint")?.trim();
    tags = tagsOf(child(root, "Tags"));
  }
  const location = bucketLocation(server.region, constraint);

  const ownership = headers.get("x-amz-object-ownership");
  if (ownership !== null && !isOwnership(ownership)) {
    throw invalidArgument("Invalid x-amz-object-ownership header: " + ownership, "x-amz-object-ownership", ownership);
  }
  const acl = aclFromHeaders(headers, sender, sender, "bucket", id => server.findOwner(id));
  if (ownership === "BucketOwnerEnforced" && acl && !isAclWithoutEffect(headers, acl, sender)) {
    throw new S3Error("InvalidBucketAclWithObjectOwnership");
  }

  const path = "/" + name;
  const existing = server.buckets.get(name);
  if (existing) {
    if (existing.owner.id !== sender.id) {
      throw new S3Error("BucketAlreadyExists", { details: { BucketName: name } });
    }
    if (existing.region !== DEFAULT_REGION || server.region !== DEFAULT_REGION) {
      throw new S3Error("BucketAlreadyOwnedByYou", { details: { BucketName: name } });
    }
    // The us-east-1 region answers the owner with success and makes the ACL of the bucket new.
    if (existing.ownership !== "BucketOwnerEnforced") existing.acl = acl ?? privateAcl(sender);
    return emptyResponse(200, { location: path });
  }

  const bucket = new Bucket(name, sender, location.region, context.now, acl ?? privateAcl(sender));
  bucket.ownership = ownership ?? undefined;
  bucket.tags = tags;
  if (location.constraint !== location.region && location.constraint !== "") {
    bucket.configurations.set("location", location.constraint);
  }
  if (headers.get("x-amz-bucket-object-lock-enabled")?.toLowerCase() === "true") {
    // Object lock works only with versioning. S3 enables both.
    bucket.objectLockEnabled = true;
    bucket.versioning = "Enabled";
  }
  server.buckets.set(name, bucket);
  return emptyResponse(200, {
    location: location.region === DEFAULT_REGION ? path : `http://${name}.s3.amazonaws.com/`,
  });
}

export async function headBucket(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const headers = { "x-amz-bucket-region": bucket.region };
  // S3 tells the region of the bucket also to a sender that has no access to it.
  if (!isAuthorized(context, { action: "s3:ListBucket", bucket, acl: "bucket", grant: "READ" })) {
    throw new S3Error("AccessDenied", { headers });
  }
  return emptyResponse(200, { ...headers, "x-amz-access-point-alias": "false" });
}

export async function deleteBucket(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:DeleteBucket", bucket, acl: "bucket", grant: "OWNER" });
  if (!bucket.isEmpty) {
    throw new S3Error("BucketNotEmpty", { details: { BucketName: bucket.name } });
  }
  context.server.buckets.delete(bucket.name);
  return emptyResponse(204);
}

export async function getBucketLocation(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketLocation", bucket, acl: "bucket", grant: "OWNER" });
  // The location of a bucket in us-east-1 is the empty string.
  const region = bucket.region === DEFAULT_REGION ? "" : bucket.region;
  return xmlResponse("LocationConstraint", bucket.configurations.get("location") ?? region);
}

export async function getBucketVersioning(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketVersioning", bucket, acl: "bucket", grant: "OWNER" });
  return xmlResponse("VersioningConfiguration", {
    Status: bucket.versioning,
    MfaDelete: bucket.versioning === undefined ? undefined : bucket.mfaDelete ? "Enabled" : undefined,
  });
}

export async function putBucketVersioning(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketVersioning", bucket, acl: "bucket", grant: "OWNER" });
  const root = parseXml(await readConfiguration(context));
  if (root.name !== "VersioningConfiguration") throw malformedXml();
  const status = childText(root, "Status")?.trim();
  const mfaDelete = (childText(root, "MfaDelete") ?? childText(root, "MFADelete"))?.trim();
  if (status === undefined && mfaDelete === undefined) {
    throw new S3Error("IllegalVersioningConfigurationException");
  }
  if (status !== undefined && status !== "Enabled" && status !== "Suspended") throw malformedXml();
  if (mfaDelete !== undefined && mfaDelete !== "Enabled" && mfaDelete !== "Disabled") throw malformedXml();
  if (mfaDelete === "Enabled" || context.headers.has("x-amz-mfa")) {
    // MFA delete needs the root credentials of an AWS account and an MFA device.
    throw new S3Error("NotImplemented", { details: { Header: "x-amz-mfa" } });
  }
  if (status === "Suspended" && bucket.objectLockEnabled) {
    throw new S3Error("InvalidBucketState", {
      message: "An Object Lock configuration is present on this bucket, so the versioning state cannot be changed.",
    });
  }
  if (status !== undefined) bucket.versioning = status;
  return emptyResponse(200);
}

export async function getBucketTagging(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketTagging", bucket, acl: "bucket", grant: "OWNER" });
  if (!bucket.tags) throw new S3Error("NoSuchTagSet", { details: { BucketName: bucket.name } });
  return rawXmlResponse(serializeTagging(bucket.tags));
}

export async function putBucketTagging(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketTagging", bucket, acl: "bucket", grant: "OWNER" });
  bucket.tags = parseTagging(await readConfiguration(context), "bucket");
  return emptyResponse(204);
}

export async function deleteBucketTagging(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketTagging", bucket, acl: "bucket", grant: "OWNER" });
  bucket.tags = undefined;
  return emptyResponse(204);
}

export async function getBucketCors(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketCORS", bucket, acl: "bucket", grant: "OWNER" });
  if (!bucket.cors) throw new S3Error("NoSuchCORSConfiguration", { details: { BucketName: bucket.name } });
  return rawXmlResponse(serializeCorsConfiguration(bucket.cors));
}

export async function putBucketCors(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketCORS", bucket, acl: "bucket", grant: "OWNER" });
  bucket.cors = parseCorsConfiguration(await readConfiguration(context));
  return emptyResponse(200);
}

export async function deleteBucketCors(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketCORS", bucket, acl: "bucket", grant: "OWNER" });
  bucket.cors = undefined;
  return emptyResponse(204);
}

/** The answer to an HTTP OPTIONS request. It needs no authentication. */
export async function preflight(context: RequestContext): Promise<Response> {
  const resourceType = context.key === undefined ? "BUCKET" : "OBJECT";
  if (!context.bucket) {
    throw new S3Error("AccessForbidden", {
      message: "CORSResponse: Bucket not found",
      details: {
        Method: context.headers.get("access-control-request-method") ?? undefined,
        ResourceType: resourceType,
      },
    });
  }
  return emptyResponse(200, preflightResponseHeaders(context.bucket.cors, context.headers, resourceType));
}

/**
 * The access to the policy of a bucket. Only the account that owns the bucket
 * can use these operations. S3 answers another account that has the
 * permission with the status 405.
 */
function authorizePolicyOperation(context: RequestContext, bucket: Bucket, action: string): void {
  authorize(context, { action, bucket, acl: "bucket", grant: "OWNER" });
  if (context.sender?.id !== bucket.owner.id) {
    throw new S3Error("MethodNotAllowed", { details: { Method: context.method, ResourceType: "BUCKETPOLICY" } });
  }
}

export async function getBucketPolicy(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorizePolicyOperation(context, bucket, "s3:GetBucketPolicy");
  if (!bucket.policy) throw new S3Error("NoSuchBucketPolicy", { details: { BucketName: bucket.name } });
  return new Response(bucket.policy.text, { headers: { "content-type": "application/json" } });
}

export async function putBucketPolicy(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorizePolicyOperation(context, bucket, "s3:PutBucketPolicy");
  const body = await readDocument(context);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new S3Error("MalformedPolicy");
  }
  const policy = parseBucketPolicy(text, bucket.name);
  if (publicAccessBlock(bucket).blockPublicPolicy && isPublicPolicy(policy)) {
    throw new S3Error("AccessDenied", {
      message: `User: arn:aws:iam::${bucket.owner.accountId}:root is not authorized to perform: s3:PutBucketPolicy on resource: "arn:aws:s3:::${bucket.name}" because public policies are blocked by the BlockPublicPolicy block public access setting.`,
    });
  }
  bucket.policy = policy;
  return emptyResponse(204);
}

export async function deleteBucketPolicy(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorizePolicyOperation(context, bucket, "s3:DeleteBucketPolicy");
  bucket.policy = undefined;
  return emptyResponse(204);
}

export async function getBucketPolicyStatus(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketPolicyStatus", bucket, acl: "bucket", grant: "OWNER" });
  if (!bucket.policy) throw new S3Error("NoSuchBucketPolicy", { details: { BucketName: bucket.name } });
  const publicAcl = aclsAreEnabled(bucket) && !publicAccessBlock(bucket).ignorePublicAcls && aclIsPublic(bucket.acl);
  return xmlResponse("PolicyStatus", { IsPublic: isPublicPolicy(bucket.policy) || publicAcl });
}

function aclsAreEnabled(bucket: Bucket): boolean {
  return bucket.ownership !== "BucketOwnerEnforced";
}

export async function getBucketAcl(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketAcl", bucket, acl: "bucket", grant: "READ_ACP" });
  // A bucket without ACLs reports the full control of its owner.
  const acl = aclsAreEnabled(bucket) ? bucket.acl : privateAcl(bucket.owner);
  return rawXmlResponse(serializeAcl(bucket.owner, acl));
}

export async function putBucketAcl(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketAcl", bucket, acl: "bucket", grant: "WRITE_ACP" });
  const findOwner = (id: string) => context.server.findOwner(id);
  const fromHeaders = aclFromHeaders(context.headers, bucket.owner, bucket.owner, "bucket", findOwner);
  const body = await readDocument(context);

  let acl: Grant[];
  if (fromHeaders) {
    if (body.length > 0) throw new S3Error("UnexpectedContent");
    acl = fromHeaders;
  } else {
    if (body.length === 0) {
      throw new S3Error("MissingSecurityHeader", {
        message: "Your request was missing a required header",
        details: { MissingHeaderName: "x-amz-acl" },
      });
    }
    acl = parseAcl(body, bucket.owner, findOwner);
  }
  if (!aclsAreEnabled(bucket)) {
    // With ACLs disabled, S3 accepts only the ACL that changes nothing.
    if (!isAclWithoutEffect(context.headers, acl, bucket.owner)) throw new S3Error("AccessControlListNotSupported");
    return emptyResponse(200);
  }
  bucket.acl = checkPublicAcl(bucket, acl);
  return emptyResponse(200);
}

export async function getBucketRequestPayment(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketRequestPayment", bucket, acl: "bucket", grant: "OWNER" });
  return xmlResponse("RequestPaymentConfiguration", { Payer: bucket.requestPayer });
}

export async function putBucketRequestPayment(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketRequestPayment", bucket, acl: "bucket", grant: "OWNER" });
  const root = parseXml(await readConfiguration(context));
  const payer = childText(root, "Payer")?.trim();
  if (root.name !== "RequestPaymentConfiguration" || (payer !== "Requester" && payer !== "BucketOwner")) {
    throw malformedXml();
  }
  bucket.requestPayer = payer;
  return emptyResponse(200);
}

export async function getBucketOwnershipControls(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketOwnershipControls", bucket, acl: "bucket", grant: "OWNER" });
  if (!bucket.ownership) {
    throw new S3Error("OwnershipControlsNotFoundError", { details: { BucketName: bucket.name } });
  }
  return xmlResponse("OwnershipControls", { Rule: { ObjectOwnership: bucket.ownership } });
}

export async function putBucketOwnershipControls(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketOwnershipControls", bucket, acl: "bucket", grant: "OWNER" });
  const root = parseXml(await readConfiguration(context));
  const rules = children(root, "Rule");
  const ownership = childText(rules[0], "ObjectOwnership")?.trim();
  if (root.name !== "OwnershipControls" || rules.length !== 1 || !isOwnership(ownership)) throw malformedXml();
  if (ownership === "BucketOwnerEnforced" && !isOwnerFullControl(bucket.acl, bucket.owner)) {
    throw new S3Error("InvalidBucketAclWithObjectOwnership");
  }
  bucket.ownership = ownership;
  return emptyResponse(200);
}

export async function deleteBucketOwnershipControls(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketOwnershipControls", bucket, acl: "bucket", grant: "OWNER" });
  bucket.ownership = undefined;
  return emptyResponse(204);
}

export async function getObjectLockConfiguration(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:GetBucketObjectLockConfiguration", bucket, acl: "bucket", grant: "OWNER" });
  const stored = bucket.configurations.get("object-lock");
  if (stored !== undefined) return rawXmlResponse(stored);
  if (!bucket.objectLockEnabled) {
    throw new S3Error("ObjectLockConfigurationNotFoundError", { details: { BucketName: bucket.name } });
  }
  return xmlResponse("ObjectLockConfiguration", { ObjectLockEnabled: "Enabled" });
}

export async function putObjectLockConfiguration(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:PutBucketObjectLockConfiguration", bucket, acl: "bucket", grant: "OWNER" });
  const body = await readConfiguration(context);
  const root = parseXml(body);
  if (root.name !== "ObjectLockConfiguration" || childText(root, "ObjectLockEnabled")?.trim() !== "Enabled") {
    throw malformedXml();
  }
  if (bucket.versioning !== "Enabled") {
    throw new S3Error("InvalidBucketState", {
      message: "Versioning must be 'Enabled' on the bucket to apply a Object Lock configuration",
    });
  }
  const retention = child(child(root, "Rule"), "DefaultRetention");
  if (child(root, "Rule")) {
    const mode = childText(retention, "Mode")?.trim();
    const days = childText(retention, "Days")?.trim();
    const years = childText(retention, "Years")?.trim();
    if ((mode !== "GOVERNANCE" && mode !== "COMPLIANCE") || (days === undefined) === (years === undefined)) {
      throw malformedXml();
    }
    const period = days ?? years ?? "";
    if (!/^\d+$/.test(period) || Number(period) <= 0) {
      throw invalidArgument(
        "Default retention period must be a positive integer value.",
        days === undefined ? "Years" : "Days",
        period,
      );
    }
  }
  bucket.objectLockEnabled = true;
  bucket.configurations.set("object-lock", new TextDecoder().decode(body));
  return emptyResponse(200);
}

interface StoredConfiguration {
  /** The query parameter that names the configuration. */
  subresource: string;
  /** The name of the root element of the document. */
  root: string;
  /** The IAM actions of the read and of the write. A delete without an action of its own is a write. */
  actions: { get: string; put: string; delete?: string };
  /** The error of a read when the bucket has no such configuration. Without it, `defaultDocument` is the answer. */
  missing?: S3ErrorCode;
  defaultDocument?: string;
  /** The configuration has a delete operation. */
  deletable: boolean;
  /** Checks the document of a write against the bucket. */
  check?(bucket: Bucket, body: Uint8Array): void;
}

const DEFAULT_ENCRYPTION = xmlDocument("ServerSideEncryptionConfiguration", {
  Rule: { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" }, BucketKeyEnabled: false },
});

/**
 * The configurations that the server keeps and returns. It checks that the
 * document is XML with the correct root element. It acts only on the public
 * access block.
 */
export const STORED_CONFIGURATIONS: StoredConfiguration[] = [
  {
    subresource: "lifecycle",
    root: "LifecycleConfiguration",
    actions: { get: "s3:GetLifecycleConfiguration", put: "s3:PutLifecycleConfiguration" },
    missing: "NoSuchLifecycleConfiguration",
    deletable: true,
  },
  {
    subresource: "encryption",
    root: "ServerSideEncryptionConfiguration",
    actions: { get: "s3:GetEncryptionConfiguration", put: "s3:PutEncryptionConfiguration" },
    // S3 encrypts each bucket. The delete operation brings back this default.
    defaultDocument: DEFAULT_ENCRYPTION,
    deletable: true,
  },
  {
    subresource: "website",
    root: "WebsiteConfiguration",
    actions: { get: "s3:GetBucketWebsite", put: "s3:PutBucketWebsite", delete: "s3:DeleteBucketWebsite" },
    missing: "NoSuchWebsiteConfiguration",
    deletable: true,
  },
  {
    subresource: "notification",
    root: "NotificationConfiguration",
    actions: { get: "s3:GetBucketNotification", put: "s3:PutBucketNotification" },
    defaultDocument: xmlDocument("NotificationConfiguration", {}),
    deletable: false,
  },
  {
    subresource: "logging",
    root: "BucketLoggingStatus",
    actions: { get: "s3:GetBucketLogging", put: "s3:PutBucketLogging" },
    defaultDocument: xmlDocument("BucketLoggingStatus", {}),
    deletable: false,
  },
  {
    subresource: "replication",
    root: "ReplicationConfiguration",
    actions: { get: "s3:GetReplicationConfiguration", put: "s3:PutReplicationConfiguration" },
    missing: "ReplicationConfigurationNotFoundError",
    deletable: true,
    check(bucket) {
      if (bucket.versioning !== "Enabled") {
        throw invalidRequest("Versioning must be 'Enabled' on the bucket to apply a replication configuration");
      }
    },
  },
  {
    subresource: "accelerate",
    root: "AccelerateConfiguration",
    actions: { get: "s3:GetAccelerateConfiguration", put: "s3:PutAccelerateConfiguration" },
    defaultDocument: xmlDocument("AccelerateConfiguration", {}),
    deletable: false,
    check(bucket, body) {
      const status = childText(parseXml(body), "Status")?.trim();
      if (status !== "Enabled" && status !== "Suspended") throw malformedXml();
      if (bucket.name.includes(".")) {
        throw invalidRequest("S3 Transfer Acceleration is not supported for buckets with periods (.) in their names");
      }
    },
  },
  {
    subresource: "publicAccessBlock",
    root: "PublicAccessBlockConfiguration",
    actions: { get: "s3:GetBucketPublicAccessBlock", put: "s3:PutBucketPublicAccessBlock" },
    missing: "NoSuchPublicAccessBlockConfiguration",
    deletable: true,
    check(_bucket, body) {
      parsePublicAccessBlock(body);
    },
  },
];

export function storedConfigurationHandler(
  configuration: StoredConfiguration,
  method: string,
): ((context: RequestContext) => Promise<Response>) | undefined {
  const { subresource, actions } = configuration;
  switch (method) {
    case "GET":
      return async context => {
        const bucket = requireBucket(context);
        authorize(context, { action: actions.get, bucket, acl: "bucket", grant: "OWNER" });
        const stored = bucket.configurations.get(subresource) ?? configuration.defaultDocument;
        if (stored === undefined) {
          throw new S3Error(configuration.missing!, { details: { BucketName: bucket.name } });
        }
        return rawXmlResponse(stored);
      };
    case "PUT":
      return async context => {
        const bucket = requireBucket(context);
        authorize(context, { action: actions.put, bucket, acl: "bucket", grant: "OWNER" });
        const body = await readConfiguration(context);
        if (parseXml(body).name !== configuration.root) throw malformedXml();
        configuration.check?.(bucket, body);
        bucket.configurations.set(subresource, new TextDecoder().decode(body));
        return emptyResponse(200);
      };
    case "DELETE":
      if (!configuration.deletable) return undefined;
      return async context => {
        const bucket = requireBucket(context);
        authorize(context, { action: actions.delete ?? actions.put, bucket, acl: "bucket", grant: "OWNER" });
        bucket.configurations.delete(subresource);
        return emptyResponse(204);
      };
  }
  return undefined;
}
