// The operations on the tags, the ACL and the object lock state of an object.

import { aclFromHeaders, isAclWithoutEffect, parseAcl, serializeObjectAcl } from "../acl.ts";
import { authorize, checkPublicAcl } from "../authorize.ts";
import { readDocument } from "../body.ts";
import { emptyResponse, rawXmlResponse, xmlResponse, type RequestContext } from "../context.ts";
import { invalidRequest, malformedXml, S3Error } from "../errors.ts";
import { parseIsoDate, parseTagging, serializeTagging, versionIdHeader } from "../metadata.ts";
import type { Bucket, ObjectVersion } from "../store.ts";
import { childText, parseXml } from "../xml.ts";
import { findVersion, requestChargedHeaders, requestedVersionId, requireBucket, requireKey } from "./common.ts";

interface Target {
  bucket: Bucket;
  key: string;
  versionId: string | undefined;
  version: ObjectVersion;
}

/** Reads the document of a request that has no meaning without one. */
export async function readRequiredDocument(context: RequestContext): Promise<Uint8Array> {
  const body = await readDocument(context);
  if (body.length === 0) throw new S3Error("MissingRequestBodyError");
  return body;
}

function target(context: RequestContext): Target {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const versionId = requestedVersionId(context);
  return { bucket, key, versionId, version: findVersion(context, bucket, key, versionId) };
}

export async function getObjectTagging(context: RequestContext): Promise<Response> {
  const { bucket, key, versionId, version } = target(context);
  authorize(context, {
    action: versionId === undefined ? "s3:GetObjectTagging" : "s3:GetObjectVersionTagging",
    bucket,
    key,
    acl: "object",
    grant: "OWNER",
    version,
  });
  return rawXmlResponse(serializeTagging(version.tags), {
    "x-amz-version-id": versionIdHeader(bucket, version),
    ...requestChargedHeaders(context, bucket),
  });
}

export async function putObjectTagging(context: RequestContext): Promise<Response> {
  const { bucket, key, versionId, version } = target(context);
  const tags = parseTagging(await readRequiredDocument(context), "object");
  authorize(context, {
    action: versionId === undefined ? "s3:PutObjectTagging" : "s3:PutObjectVersionTagging",
    bucket,
    key,
    acl: "object",
    grant: "OWNER",
    version,
    requestTags: tags,
  });
  version.tags = tags;
  return emptyResponse(200, {
    "x-amz-version-id": versionIdHeader(bucket, version),
    ...requestChargedHeaders(context, bucket),
  });
}

export async function deleteObjectTagging(context: RequestContext): Promise<Response> {
  const { bucket, key, versionId, version } = target(context);
  authorize(context, {
    action: versionId === undefined ? "s3:DeleteObjectTagging" : "s3:DeleteObjectVersionTagging",
    bucket,
    key,
    acl: "object",
    grant: "OWNER",
    version,
  });
  version.tags = [];
  return emptyResponse(204, { "x-amz-version-id": versionIdHeader(bucket, version) });
}

export async function getObjectAcl(context: RequestContext): Promise<Response> {
  const { bucket, key, versionId, version } = target(context);
  authorize(context, {
    action: versionId === undefined ? "s3:GetObjectAcl" : "s3:GetObjectVersionAcl",
    bucket,
    key,
    acl: "object",
    grant: "READ_ACP",
    version,
  });
  return rawXmlResponse(serializeObjectAcl(bucket, version), {
    "x-amz-version-id": versionIdHeader(bucket, version),
    ...requestChargedHeaders(context, bucket),
  });
}

export async function putObjectAcl(context: RequestContext): Promise<Response> {
  const { bucket, key, versionId, version } = target(context);
  authorize(context, {
    action: versionId === undefined ? "s3:PutObjectAcl" : "s3:PutObjectVersionAcl",
    bucket,
    key,
    acl: "object",
    grant: "WRITE_ACP",
    version,
  });
  const fromHeaders = aclFromHeaders(context.headers, version.owner, bucket.owner, "object", id =>
    context.server.findOwner(id),
  );
  const body = await readDocument(context);
  if (fromHeaders && body.length > 0) throw new S3Error("UnexpectedContent");
  if (!fromHeaders && body.length === 0) {
    throw new S3Error("MissingSecurityHeader", {
      message: "Your request was missing a required header",
      details: { MissingHeaderName: "x-amz-acl" },
    });
  }
  if (bucket.ownership === "BucketOwnerEnforced") {
    // With ACLs disabled, S3 accepts only the ACL that changes nothing.
    const requested = fromHeaders ?? parseAcl(body, bucket.owner, id => context.server.findOwner(id));
    if (!isAclWithoutEffect(context.headers, requested, bucket.owner)) {
      throw new S3Error("AccessControlListNotSupported");
    }
  } else {
    version.acl = checkPublicAcl(
      bucket,
      fromHeaders ?? parseAcl(body, version.owner, id => context.server.findOwner(id)),
    );
  }
  return emptyResponse(200, {
    "x-amz-version-id": versionIdHeader(bucket, version),
    ...requestChargedHeaders(context, bucket),
  });
}

function requireObjectLock(bucket: Bucket): void {
  if (!bucket.objectLockEnabled) {
    throw invalidRequest("Bucket is missing Object Lock Configuration");
  }
}

export async function getObjectRetention(context: RequestContext): Promise<Response> {
  const { bucket, key, version } = target(context);
  authorize(context, { action: "s3:GetObjectRetention", bucket, key, acl: "object", grant: "OWNER", version });
  requireObjectLock(bucket);
  if (!version.lock?.mode) {
    throw new S3Error("NoSuchObjectLockConfiguration", { details: { Key: key } });
  }
  return xmlResponse("Retention", { Mode: version.lock.mode, RetainUntilDate: version.lock.retainUntil });
}

export async function putObjectRetention(context: RequestContext): Promise<Response> {
  const { bucket, key, version } = target(context);
  authorize(context, { action: "s3:PutObjectRetention", bucket, key, acl: "object", grant: "OWNER", version });
  requireObjectLock(bucket);

  const root = parseXml(await readRequiredDocument(context));
  if (root.name !== "Retention") throw malformedXml();
  const mode = childText(root, "Mode")?.trim();
  const untilText = childText(root, "RetainUntilDate")?.trim();
  const current = version.lock;
  const bypass = context.headers.get("x-amz-bypass-governance-retention")?.toLowerCase() === "true";
  const active = current?.mode && current.retainUntil && current.retainUntil.getTime() > context.now.getTime();

  if (mode === undefined && untilText === undefined) {
    // An empty document removes the retention. Only governance mode lets a request do that.
    if (active && (current!.mode === "COMPLIANCE" || !bypass)) throw new S3Error("AccessDenied");
    version.lock = { legalHold: current?.legalHold };
    return emptyResponse(200);
  }
  if ((mode !== "GOVERNANCE" && mode !== "COMPLIANCE") || untilText === undefined) throw malformedXml();
  const until = parseIsoDate(untilText);
  if (until === undefined) throw malformedXml();
  if (until <= context.now.getTime()) {
    throw new S3Error("InvalidArgument", { message: "The retain until date must be in the future!" });
  }
  if (active) {
    const shorter = until < current!.retainUntil!.getTime();
    const weaker = current!.mode === "COMPLIANCE" && mode === "GOVERNANCE";
    if (current!.mode === "COMPLIANCE" ? shorter || weaker : (shorter || mode !== current!.mode) && !bypass) {
      throw new S3Error("AccessDenied");
    }
  }
  version.lock = { mode, retainUntil: new Date(until), legalHold: current?.legalHold };
  return emptyResponse(200);
}

export async function getObjectLegalHold(context: RequestContext): Promise<Response> {
  const { bucket, key, version } = target(context);
  authorize(context, { action: "s3:GetObjectLegalHold", bucket, key, acl: "object", grant: "OWNER", version });
  requireObjectLock(bucket);
  if (version.lock?.legalHold === undefined) {
    throw new S3Error("NoSuchObjectLockConfiguration", { details: { Key: key } });
  }
  return xmlResponse("LegalHold", { Status: version.lock.legalHold ? "ON" : "OFF" });
}

export async function putObjectLegalHold(context: RequestContext): Promise<Response> {
  const { bucket, key, version } = target(context);
  authorize(context, { action: "s3:PutObjectLegalHold", bucket, key, acl: "object", grant: "OWNER", version });
  requireObjectLock(bucket);
  const root = parseXml(await readRequiredDocument(context));
  const status = childText(root, "Status")?.trim();
  if (root.name !== "LegalHold" || (status !== "ON" && status !== "OFF")) throw malformedXml();
  version.lock = { ...version.lock, legalHold: status === "ON" };
  return emptyResponse(200);
}
