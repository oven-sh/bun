// Helpers that the handlers of more than one operation use.

import { aclFromHeaders, isAclWithoutEffect, privateAcl, type Grant } from "../acl.ts";
import { missingKey } from "../authorize.ts";
import type { RequestContext, ResponseHeaders } from "../context.ts";
import { httpDate, parseHttpDate, unquoteETag, utf8Length } from "../encoding.ts";
import { invalidArgument, notImplemented, S3Error } from "../errors.ts";
import type { Owner } from "../signature.ts";
import type { Bucket, ObjectVersion } from "../store.ts";

export const MAX_KEY_BYTES = 1024;

/** The owner that S3 gives to an object that an anonymous request wrote. */
export const ANONYMOUS_OWNER: Owner = { id: "65a011a29cdf8ec533ec3d1ccaae921c", displayName: "" };

export function requireBucket(context: RequestContext): Bucket {
  if (!context.bucket) {
    throw new S3Error("NoSuchBucket", { details: { BucketName: context.bucketName } });
  }
  return context.bucket;
}

export function requireKey(context: RequestContext): string {
  const key = context.key!;
  const size = utf8Length(key);
  if (size > MAX_KEY_BYTES) {
    throw new S3Error("KeyTooLongError", { details: { Size: size, MaxSizeAllowed: MAX_KEY_BYTES } });
  }
  return key;
}

/** The `versionId` query parameter. The server makes IDs of 32 letters and digits. `null` is the ID without versioning. */
export function requestedVersionId(context: RequestContext): string | undefined {
  const versionId = context.query.get("versionId");
  if (versionId === undefined) return undefined;
  if (versionId === "") throw invalidArgument("Version id cannot be the empty string", "versionId", "");
  return checkVersionId(versionId);
}

export function checkVersionId(versionId: string): string {
  if (versionId !== "null" && !/^[A-Za-z0-9._-]{32}$/.test(versionId)) {
    throw invalidArgument("Invalid version id specified", "versionId", versionId);
  }
  return versionId;
}

/** The headers that S3 sends when the version that a request names is a delete marker. */
function deleteMarkerHeaders(bucket: Bucket, version: ObjectVersion): Record<string, string> {
  const headers: Record<string, string> = { "x-amz-delete-marker": "true" };
  if (bucket.versioning !== undefined) headers["x-amz-version-id"] = version.versionId;
  return headers;
}

/**
 * Finds the version that a request reads. It throws the error of S3 when the
 * key or the version does not exist, or when the version is a delete marker.
 */
export function findVersion(
  context: RequestContext,
  bucket: Bucket,
  key: string,
  versionId: string | undefined,
): ObjectVersion {
  if (versionId === undefined) {
    const latest = bucket.latest(key);
    if (!latest) throw missingKey(context, bucket, key, new S3Error("NoSuchKey", { details: { Key: key } }));
    if (latest.deleteMarker) {
      throw missingKey(
        context,
        bucket,
        key,
        new S3Error("NoSuchKey", { details: { Key: key }, headers: deleteMarkerHeaders(bucket, latest) }),
      );
    }
    return latest;
  }
  const version = bucket.version(key, versionId);
  if (!version) {
    throw missingKey(
      context,
      bucket,
      key,
      new S3Error("NoSuchVersion", { details: { Key: key, VersionId: versionId } }),
    );
  }
  if (version.deleteMarker) {
    throw new S3Error("MethodNotAllowed", {
      details: { Method: context.method, ResourceType: "DeleteMarker" },
      headers: {
        ...deleteMarkerHeaders(bucket, version),
        "allow": "DELETE",
        "last-modified": httpDate(version.lastModified),
      },
    });
  }
  return version;
}

/** True when the entity tag of the object is in the list of an `If-Match` or `If-None-Match` header. */
export function etagMatches(header: string, etag: string): boolean {
  for (const candidate of header.split(",")) {
    const value = candidate.trim();
    if (value === "*" || unquoteETag(value) === etag) return true;
  }
  return false;
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export interface Conditions {
  ifMatch: string | null;
  ifNoneMatch: string | null;
  ifModifiedSince: string | null;
  ifUnmodifiedSince: string | null;
}

/**
 * Evaluates the conditional headers of a read. The result is the condition
 * that failed. `If-Match` has priority over `If-Unmodified-Since` and
 * `If-None-Match` has priority over `If-Modified-Since`.
 */
export function failedCondition(
  conditions: Conditions,
  version: { etag: string; lastModified: Date },
): { status: 412 | 304; condition: string } | undefined {
  const modified = seconds(version.lastModified);
  if (conditions.ifMatch !== null) {
    if (!etagMatches(conditions.ifMatch, version.etag)) return { status: 412, condition: "If-Match" };
  } else {
    const since = parseHttpDate(conditions.ifUnmodifiedSince);
    if (since && modified > seconds(since)) return { status: 412, condition: "If-Unmodified-Since" };
  }
  if (conditions.ifNoneMatch !== null) {
    if (etagMatches(conditions.ifNoneMatch, version.etag)) return { status: 304, condition: "If-None-Match" };
  } else {
    const since = parseHttpDate(conditions.ifModifiedSince);
    if (since && modified <= seconds(since)) return { status: 304, condition: "If-Modified-Since" };
  }
  return undefined;
}

export function preconditionFailed(condition: string): S3Error {
  return new S3Error("PreconditionFailed", { details: { Condition: condition } });
}

/**
 * The conditional headers of a write: `If-None-Match: *` writes only when the
 * key has no object, and `If-Match` writes only over the object with that entity tag.
 */
export function checkWriteConditions(context: RequestContext, bucket: Bucket, key: string): void {
  const ifNoneMatch = context.headers.get("if-none-match");
  const ifMatch = context.headers.get("if-match");
  const current = bucket.current(key);
  if (ifNoneMatch !== null) {
    if (ifNoneMatch.trim() !== "*") {
      throw notImplemented("If-None-Match");
    }
    if (current) throw preconditionFailed("If-None-Match");
  }
  if (ifMatch !== null) {
    if (!current) throw new S3Error("NoSuchKey", { details: { Key: key } });
    if (!etagMatches(ifMatch, current.etag)) throw preconditionFailed("If-Match");
  }
}

/** The owner and the ACL of an object that the request makes. */
export function newObjectOwnership(context: RequestContext, bucket: Bucket): { owner: Owner; acl: Grant[] } {
  const sender = context.sender ?? ANONYMOUS_OWNER;
  const requested = aclFromHeaders(context.headers, sender, bucket.owner, "object", id => context.server.findOwner(id));

  if (bucket.ownership === "BucketOwnerEnforced") {
    // The bucket has ACLs disabled. S3 accepts only the ACL that gives the bucket owner full control.
    if (requested && !isAclWithoutEffect(context.headers, requested, bucket.owner)) {
      throw new S3Error("AccessControlListNotSupported");
    }
    return { owner: bucket.owner, acl: privateAcl(bucket.owner) };
  }
  if (bucket.ownership === "BucketOwnerPreferred" && context.headers.get("x-amz-acl") === "bucket-owner-full-control") {
    return { owner: bucket.owner, acl: privateAcl(bucket.owner) };
  }
  return { owner: sender, acl: requested ?? privateAcl(sender) };
}

/** S3 tells the sender that it paid for the request when the bucket has Requester Pays. */
export function requestChargedHeaders(context: RequestContext, bucket: Bucket): ResponseHeaders {
  const payer = context.headers.get("x-amz-request-payer") ?? context.query.get("x-amz-request-payer");
  if (bucket.requestPayer === "Requester" && payer?.toLowerCase() === "requester") {
    return { "x-amz-request-charged": "requester" };
  }
  return {};
}

/** True when object lock protects the version from a permanent delete. */
export function isLocked(context: RequestContext, version: ObjectVersion): boolean {
  const lock = version.lock;
  if (!lock) return false;
  if (lock.legalHold) return true;
  if (!lock.mode || !lock.retainUntil || lock.retainUntil.getTime() <= context.now.getTime()) return false;
  if (lock.mode === "COMPLIANCE") return true;
  return context.headers.get("x-amz-bypass-governance-retention")?.toLowerCase() !== "true";
}
