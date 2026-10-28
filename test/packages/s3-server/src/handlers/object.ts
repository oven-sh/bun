// PutObject, GetObject, HeadObject, DeleteObject, DeleteObjects, CopyObject,
// GetObjectAttributes and RestoreObject.

import { authorize, isAuthorized } from "../authorize.ts";
import { MAX_OBJECT_SIZE, readPayload } from "../body.ts";
import {
  checksumElementName,
  checksumHeaderName,
  CHECKSUM_ALGORITHMS,
  computeChecksum,
  parseChecksumAlgorithm,
  type Checksum,
} from "../checksums.ts";
import { emptyResponse, parseInteger, xmlResponse, type RequestContext, type ResponseHeaders } from "../context.ts";
import { httpDate, parseHttpDate, percentDecodeToString } from "../encoding.ts";
import { invalidArgument, invalidRequest, malformedXml, S3Error } from "../errors.ts";
import {
  checkCustomerEncryption,
  checkNoEncryptionHeader,
  encryptionHeaders,
  isRestored,
  metadataFromHeaders,
  objectHeaders,
  tagsFromHeader,
  versionIdHeader,
} from "../metadata.ts";
import { ARCHIVE_STORAGE_CLASSES, ObjectData, type Bucket, type ObjectMetadata, type ObjectVersion } from "../store.ts";
import { child, children, childText, parseXml, type XmlNode } from "../xml.ts";
import { readRequiredDocument } from "./object-config.ts";
import {
  checkVersionId,
  checkWriteConditions,
  failedCondition,
  findVersion,
  isLocked,
  newObjectOwnership,
  preconditionFailed,
  requestChargedHeaders,
  requestedVersionId,
  requireBucket,
  requireKey,
} from "./common.ts";

function checksumHeaders(checksum: Checksum | undefined): ResponseHeaders {
  if (!checksum) return {};
  return { [checksumHeaderName(checksum.algorithm)]: checksum.value, "x-amz-checksum-type": checksum.type };
}

/** True when the request has a digest of its body: Content-MD5 or one of the checksums. */
function hasBodyDigest(headers: Headers): boolean {
  return (
    headers.has("content-md5") ||
    headers.has("x-amz-trailer") ||
    CHECKSUM_ALGORITHMS.some(algorithm => headers.has(checksumHeaderName(algorithm)))
  );
}

export async function putObject(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const tags = tagsFromHeader(context.headers.get("x-amz-tagging"));
  // The access decision comes before the checks of the other headers.
  authorize(context, { action: "s3:PutObject", bucket, key, acl: "bucket", grant: "WRITE", requestTags: tags });
  const metadata = metadataFromHeaders(context, bucket, context.headers);
  const { owner, acl } = newObjectOwnership(context, bucket);
  if (metadata.lock && !hasBodyDigest(context.headers)) {
    throw invalidRequest(
      "Content-MD5 OR x-amz-checksum- HTTP header is required for Put Object requests with Object Lock parameters",
    );
  }

  const payload = await readPayload(context, MAX_OBJECT_SIZE);
  // The body can arrive after another request changed the key. The conditions apply to the state at this point.
  checkWriteConditions(context, bucket, key);

  const version = bucket.put({
    ...metadata,
    key,
    deleteMarker: false,
    data: new ObjectData([payload.data]),
    size: payload.data.length,
    etag: payload.md5.toString("hex"),
    lastModified: context.now,
    owner,
    acl,
    tags,
    checksum: payload.checksum && { ...payload.checksum, type: "FULL_OBJECT" },
  });

  return emptyResponse(200, {
    "etag": `"${version.etag}"`,
    "x-amz-version-id": versionIdHeader(bucket, version),
    ...checksumHeaders(version.checksum),
    ...encryptionHeaders(version),
    ...requestChargedHeaders(context, bucket),
  });
}

type Range = { start: number; end: number };

/**
 * Parses a `Range` header for an object of that size. S3 serves one range per
 * request. It ignores a header that it cannot use and sends the complete object.
 */
function parseRange(header: string, size: number): Range | "ignore" | "unsatisfiable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "ignore";
  const [, first, last] = match;
  if (first === "" && last === "") return "ignore";
  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (last !== "" && Number(last) < start) return "ignore";
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

const RESPONSE_OVERRIDES: [parameter: string, header: string][] = [
  ["response-content-type", "content-type"],
  ["response-content-language", "content-language"],
  ["response-expires", "expires"],
  ["response-cache-control", "cache-control"],
  ["response-content-disposition", "content-disposition"],
  ["response-content-encoding", "content-encoding"],
];

/** An object in an archive storage class has no content to read before a restore request. */
function checkReadable(context: RequestContext, version: ObjectVersion, copySource = false): void {
  if (!ARCHIVE_STORAGE_CLASSES.includes(version.storageClass) || isRestored(version, context.now)) return;
  throw new S3Error("InvalidObjectState", {
    message: copySource ? "Operation is not valid for the source object's storage class" : undefined,
    details: { StorageClass: version.storageClass },
  });
}

/** S3 takes a date in the future as not valid and ignores the header. */
function dateNotInFuture(context: RequestContext, value: string | null): string | null {
  const date = parseHttpDate(value);
  return date && date.getTime() > context.now.getTime() ? null : value;
}

/** The tag count is for a sender that can read the tags. */
function canReadTags(context: RequestContext, bucket: Bucket, version: ObjectVersion, versionId: string | undefined) {
  return isAuthorized(context, {
    action: versionId === undefined ? "s3:GetObjectTagging" : "s3:GetObjectVersionTagging",
    bucket,
    key: version.key,
    acl: "object",
    grant: "OWNER",
    version,
  });
}

/** GetObject and HeadObject. */
export async function getObject(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const head = context.method === "HEAD";
  const versionId = requestedVersionId(context);
  const version = findVersion(context, bucket, key, versionId);
  authorize(context, {
    action: versionId === undefined ? "s3:GetObject" : "s3:GetObjectVersion",
    bucket,
    key,
    acl: "object",
    grant: "READ",
    version,
  });
  checkNoEncryptionHeader(context.headers);
  checkCustomerEncryption(context, version);
  if (!head) checkReadable(context, version);

  const checksumMode = context.headers.get("x-amz-checksum-mode")?.toUpperCase() === "ENABLED";
  const headers = objectHeaders(bucket, version, {
    checksumMode,
    taggingCount: canReadTags(context, bucket, version, versionId),
    now: context.now,
  });
  Object.assign(headers, requestChargedHeaders(context, bucket));

  const failed = failedCondition(
    {
      ifMatch: context.headers.get("if-match"),
      ifNoneMatch: context.headers.get("if-none-match"),
      ifModifiedSince: dateNotInFuture(context, context.headers.get("if-modified-since")),
      ifUnmodifiedSince: context.headers.get("if-unmodified-since"),
    },
    version,
  );
  if (failed?.status === 412) throw preconditionFailed(failed.condition);
  if (failed?.status === 304) {
    return emptyResponse(304, {
      "etag": headers["etag"],
      "last-modified": headers["last-modified"],
      "cache-control": headers["cache-control"],
      "expires": headers["expires"],
      "x-amz-version-id": headers["x-amz-version-id"],
    });
  }

  for (const [parameter, header] of RESPONSE_OVERRIDES) {
    const value = context.query.get(parameter);
    if (value === undefined) continue;
    if (context.authentication.type === "anonymous") {
      throw invalidRequest("Request specific response headers cannot be used for anonymous GET requests.");
    }
    if (!/^[\t\x20-\x7e\x80-\xff]*$/.test(value)) {
      throw invalidArgument("Header value cannot be represented using ISO-8859-1.", parameter, value);
    }
    if (value !== "") headers[header] = value;
  }

  let range: Range | undefined;
  const rangeHeader = context.headers.get("range");
  const partNumber = parseInteger(context.query.get("partNumber"), "partNumber", {
    min: 1,
    max: 10000,
    message: "Part number must be an integer between 1 and 10000, inclusive",
  });
  if (partNumber !== undefined) {
    if (rangeHeader !== null) {
      throw invalidRequest("Cannot specify both Range header and partNumber query parameter");
    }
    const parts = version.parts;
    const count = parts?.length ?? 1;
    if (partNumber > count) {
      throw new S3Error("InvalidPartNumber", {
        details: { PartNumberRequested: partNumber, ActualPartCount: count },
      });
    }
    if (parts) {
      let start = 0;
      for (let i = 0; i < partNumber - 1; i++) start += parts[i].size;
      range = { start, end: start + parts[partNumber - 1].size - 1 };
      headers["x-amz-mp-parts-count"] = String(count);
    } else if (version.size > 0) {
      range = { start: 0, end: version.size - 1 };
    }
  } else if (rangeHeader !== null) {
    const parsed = parseRange(rangeHeader, version.size);
    if (parsed === "unsatisfiable") {
      throw new S3Error("InvalidRange", {
        details: { RangeRequested: rangeHeader, ActualObjectSize: version.size },
        headers: { "content-range": `bytes */${version.size}` },
      });
    }
    if (parsed !== "ignore") range = parsed;
  }

  let status = 200;
  let body = version.data;
  if (range) {
    status = 206;
    headers["content-range"] = `bytes ${range.start}-${range.end}/${version.size}`;
    body = version.data.slice(range.start, range.end + 1);
    // The checksum of the object is not the checksum of a part of its bytes.
    if (version.checksum) {
      headers[checksumHeaderName(version.checksum.algorithm)] = undefined;
      headers["x-amz-checksum-type"] = undefined;
    }
    const part = partNumber === undefined ? undefined : version.parts?.[partNumber - 1];
    if (checksumMode && part?.checksum) {
      headers[checksumHeaderName(part.checksum.algorithm)] = part.checksum.value;
      headers["x-amz-checksum-type"] = version.checksum?.type;
    }
  }

  const responseHeaders = new Headers();
  for (const name in headers) {
    const value = headers[name];
    if (value !== undefined) responseHeaders.set(name, value);
  }
  responseHeaders.set("content-length", String(body.size));
  return new Response(head ? null : body.body(), { status, headers: responseHeaders });
}

function deleteResponseHeaders(bucket: Bucket, result: { versionId?: string; deleteMarker: boolean }): ResponseHeaders {
  return {
    "x-amz-delete-marker": result.deleteMarker ? "true" : undefined,
    "x-amz-version-id": bucket.versioning === undefined ? undefined : result.versionId,
  };
}

function checkDeleteAllowed(context: RequestContext, bucket: Bucket, key: string, versionId: string | undefined): void {
  if (versionId === undefined) return;
  const version = bucket.version(key, versionId);
  if (version && !version.deleteMarker && isLocked(context, version)) {
    throw new S3Error("AccessDenied", { message: "Access Denied because object protected by object lock." });
  }
}

export async function deleteObject(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const versionId = requestedVersionId(context);
  authorize(context, {
    action: versionId === undefined ? "s3:DeleteObject" : "s3:DeleteObjectVersion",
    bucket,
    key,
    acl: "bucket",
    grant: "WRITE",
    version: versionId === undefined ? bucket.current(key) : bucket.version(key, versionId),
  });

  const ifMatch = context.headers.get("if-match");
  if (ifMatch !== null) {
    const current = versionId === undefined ? bucket.current(key) : bucket.version(key, versionId);
    if (!current) throw new S3Error("NoSuchKey", { details: { Key: key } });
    if (ifMatch.trim() !== "*" && ifMatch.trim().replace(/^"|"$/g, "") !== current.etag) {
      throw preconditionFailed("If-Match");
    }
  }

  checkDeleteAllowed(context, bucket, key, versionId);
  const result = bucket.delete(key, versionId, context.sender ?? bucket.owner, context.now);
  return emptyResponse(204, { ...deleteResponseHeaders(bucket, result), ...requestChargedHeaders(context, bucket) });
}

/** DeleteObjects reports a version ID that has another format as a version that does not exist. */
function checkListedVersionId(versionId: string): void {
  try {
    checkVersionId(versionId);
  } catch {
    throw new S3Error("NoSuchVersion");
  }
}

export async function deleteObjects(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  if (!hasBodyDigest(context.headers)) {
    throw invalidRequest("Missing required header for this request: Content-MD5");
  }

  const root = parseXml(await readRequiredDocument(context));
  if (root.name !== "Delete") throw malformedXml();
  const objects = children(root, "Object");
  if (objects.length === 0 || objects.length > 1000) throw malformedXml();
  const quiet = childText(root, "Quiet")?.trim().toLowerCase() === "true";

  const deleted: XmlNode[] = [];
  const errors: XmlNode[] = [];
  for (const element of objects) {
    const key = childText(element, "Key");
    if (key === undefined) throw malformedXml();
    const versionId = childText(element, "VersionId") || undefined;
    try {
      if (versionId !== undefined) checkListedVersionId(versionId);
      authorize(context, {
        action: versionId === undefined ? "s3:DeleteObject" : "s3:DeleteObjectVersion",
        bucket,
        key,
        acl: "bucket",
        grant: "WRITE",
        version: versionId === undefined ? bucket.current(key) : bucket.version(key, versionId),
      });
      const expectedETag = childText(element, "ETag");
      if (expectedETag !== undefined) {
        const current = versionId === undefined ? bucket.current(key) : bucket.version(key, versionId);
        if (!current) throw new S3Error("NoSuchKey", { details: { Key: key } });
        if (expectedETag.trim().replace(/^"|"$/g, "") !== current.etag) throw preconditionFailed("If-Match");
      }
      checkDeleteAllowed(context, bucket, key, versionId);
      const result = bucket.delete(key, versionId, context.sender ?? bucket.owner, context.now);
      if (!quiet) {
        deleted.push({
          Key: key,
          VersionId: versionId,
          DeleteMarker: result.deleteMarker ? true : undefined,
          DeleteMarkerVersionId: result.deleteMarker ? result.versionId : undefined,
        });
      }
    } catch (error) {
      if (!(error instanceof S3Error)) throw error;
      errors.push({ Key: key, VersionId: versionId, Code: error.code, Message: error.message });
    }
  }

  return xmlResponse("DeleteResult", { Deleted: deleted, Error: errors }, requestChargedHeaders(context, bucket));
}

interface CopySource {
  bucket: Bucket;
  key: string;
  versionId: string | undefined;
  version: ObjectVersion;
}

/**
 * Reads `x-amz-copy-source`: `bucket/key` with an optional leading slash and an
 * optional `?versionId=`. The value is URL-encoded.
 */
export function findCopySource(context: RequestContext): CopySource {
  const header = context.headers.get("x-amz-copy-source")!;
  const invalid = () =>
    invalidArgument(
      "Copy Source must mention the source bucket and key: sourcebucket/sourcekey",
      "x-amz-copy-source",
      header,
    );

  let source = header;
  let versionId: string | undefined;
  const question = source.indexOf("?");
  if (question !== -1) {
    const parameter = source.slice(question + 1);
    source = source.slice(0, question);
    if (!parameter.startsWith("versionId=")) throw invalid();
    versionId = parameter.slice("versionId=".length);
    if (versionId === "") throw invalidArgument("Version id cannot be the empty string", "x-amz-copy-source", header);
    checkVersionId(versionId);
  }
  const decoded = percentDecodeToString(source, true);
  if (decoded === undefined) throw invalid();
  const path = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  const slash = path.indexOf("/");
  if (slash <= 0 || slash === path.length - 1) throw invalid();
  const bucketName = path.slice(0, slash);
  const key = path.slice(slash + 1);

  const bucket = context.server.buckets.get(bucketName);
  if (!bucket) throw new S3Error("NoSuchBucket", { details: { BucketName: bucketName } });

  let version: ObjectVersion;
  if (versionId !== undefined && bucket.version(key, versionId)?.deleteMarker) {
    throw invalidRequest("The source of a copy request may not specifically refer to a delete marker by version id.");
  }
  try {
    version = findVersion(context, bucket, key, versionId);
  } catch (error) {
    // The error of the source does not carry the delete marker headers.
    if (error instanceof S3Error) throw new S3Error(error.code, { message: error.message, details: error.details });
    throw error;
  }
  authorize(context, {
    action: versionId === undefined ? "s3:GetObject" : "s3:GetObjectVersion",
    bucket,
    key,
    acl: "object",
    grant: "READ",
    version,
  });
  checkCustomerEncryption(context, version, true);
  checkReadable(context, version, true);

  const failed = failedCondition(
    {
      ifMatch: context.headers.get("x-amz-copy-source-if-match"),
      ifNoneMatch: context.headers.get("x-amz-copy-source-if-none-match"),
      ifModifiedSince: dateNotInFuture(context, context.headers.get("x-amz-copy-source-if-modified-since")),
      ifUnmodifiedSince: context.headers.get("x-amz-copy-source-if-unmodified-since"),
    },
    version,
  );
  // A copy has no 304 response. Each condition that fails is a 412.
  if (failed) throw preconditionFailed("x-amz-copy-source-" + failed.condition);

  return { bucket, key, versionId, version };
}

function directive(context: RequestContext, header: string, message: string): "COPY" | "REPLACE" {
  const value = context.headers.get(header);
  if (value === null) return "COPY";
  if (value !== "COPY" && value !== "REPLACE") throw invalidArgument(message, header, value);
  return value;
}

const ENCRYPTION_HEADERS = [
  "x-amz-server-side-encryption",
  "x-amz-server-side-encryption-aws-kms-key-id",
  "x-amz-server-side-encryption-customer-algorithm",
];

export async function copyObject(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const metadataDirective = directive(context, "x-amz-metadata-directive", "Unknown metadata directive.");
  const taggingDirective = directive(context, "x-amz-tagging-directive", "Unknown tagging directive.");

  const tags = tagsFromHeader(context.headers.get("x-amz-tagging"));
  // The access decision comes before the checks of the other headers.
  authorize(context, { action: "s3:PutObject", bucket, key, acl: "bucket", grant: "WRITE", requestTags: tags });
  const replacement = metadataFromHeaders(context, bucket, context.headers);
  const { owner, acl } = newObjectOwnership(context, bucket);

  const source = findCopySource(context);
  if (source.version.size > MAX_OBJECT_SIZE) {
    throw invalidRequest(
      `The specified copy source is larger than the maximum allowable size for a copy source: ${MAX_OBJECT_SIZE}`,
    );
  }

  const changesAttributes =
    metadataDirective === "REPLACE" ||
    context.headers.has("x-amz-storage-class") ||
    context.headers.has("x-amz-website-redirect-location") ||
    ENCRYPTION_HEADERS.some(header => context.headers.has(header));
  if (source.bucket === bucket && source.key === key && source.versionId === undefined && !changesAttributes) {
    throw invalidRequest(
      "This copy request is illegal because it is trying to copy an object to itself without changing the object's metadata, storage class, website redirect location or encryption attributes.",
    );
  }

  // A copy request has no content. The server reads what the client sent so that the connection stays usable.
  await context.request.arrayBuffer();
  checkWriteConditions(context, bucket, key);

  const from = source.version;
  const metadata: ObjectMetadata =
    metadataDirective === "REPLACE"
      ? replacement
      : {
          contentType: from.contentType,
          cacheControl: from.cacheControl,
          contentDisposition: from.contentDisposition,
          contentEncoding: from.contentEncoding,
          contentLanguage: from.contentLanguage,
          expires: from.expires,
          userMetadata: { ...from.userMetadata },
          // These do not come from the source. A copy gets them from its own request.
          websiteRedirectLocation: replacement.websiteRedirectLocation,
          storageClass: replacement.storageClass,
          encryption: replacement.encryption,
          customerEncryption: replacement.customerEncryption,
          lock: replacement.lock,
        };

  let checksum = from.checksum;
  const algorithm = parseChecksumAlgorithm(context.headers.get("x-amz-checksum-algorithm"), "x-amz-checksum-algorithm");
  let etag = from.etag;
  if (from.parts || (algorithm && algorithm !== checksum?.algorithm) || checksum?.type === "COMPOSITE") {
    const chunks = from.data.chunks as Uint8Array[];
    // The copy is one part. Its entity tag is the MD5 of the content.
    if (from.parts) {
      const hasher = new Bun.CryptoHasher("md5");
      for (const chunk of chunks) hasher.update(chunk);
      etag = hasher.digest("hex");
    }
    const use = algorithm ?? checksum?.algorithm;
    checksum = use && { algorithm: use, value: computeChecksum(use, chunks), type: "FULL_OBJECT" };
  }

  const version = bucket.put({
    ...metadata,
    key,
    deleteMarker: false,
    data: from.data,
    size: from.size,
    etag,
    lastModified: context.now,
    owner,
    acl,
    tags: taggingDirective === "REPLACE" ? tags : from.tags.map(tag => ({ ...tag })),
    checksum,
  });

  return xmlResponse(
    "CopyObjectResult",
    {
      LastModified: version.lastModified,
      ETag: `"${version.etag}"`,
      ...(checksum ? { ChecksumType: checksum.type, [checksumElementName(checksum.algorithm)]: checksum.value } : {}),
    },
    {
      "x-amz-version-id": versionIdHeader(bucket, version),
      "x-amz-copy-source-version-id": versionIdHeader(source.bucket, from),
      ...encryptionHeaders(version),
      ...requestChargedHeaders(context, bucket),
    },
  );
}

const OBJECT_ATTRIBUTES = ["ETag", "Checksum", "ObjectParts", "StorageClass", "ObjectSize"];

export async function getObjectAttributes(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const versionId = requestedVersionId(context);
  const version = findVersion(context, bucket, key, versionId);
  authorize(context, {
    action: versionId === undefined ? "s3:GetObjectAttributes" : "s3:GetObjectVersionAttributes",
    bucket,
    key,
    acl: "object",
    grant: "READ",
    version,
  });
  checkCustomerEncryption(context, version);

  const header = context.headers.get("x-amz-object-attributes");
  if (header === null) {
    throw invalidRequest("Missing required header for this request: x-amz-object-attributes");
  }
  const attributes = header
    .split(",")
    .map(name => name.trim())
    .filter(name => name !== "");
  for (const name of attributes) {
    if (!OBJECT_ATTRIBUTES.includes(name)) {
      throw invalidArgument("Invalid attribute name specified.", "x-amz-object-attributes", header);
    }
  }
  if (attributes.length === 0) {
    throw invalidArgument("Invalid attribute name specified.", "x-amz-object-attributes", header);
  }

  const maxParts = parseInteger(context.headers.get("x-amz-max-parts"), "x-amz-max-parts", { min: 0 }) ?? 1000;
  const marker = parseInteger(context.headers.get("x-amz-part-number-marker"), "x-amz-part-number-marker") ?? 0;

  const result: Record<string, XmlNode> = {};
  if (attributes.includes("ETag")) result.ETag = version.etag;
  if (attributes.includes("Checksum") && version.checksum) {
    result.Checksum = {
      [checksumElementName(version.checksum.algorithm)]: version.checksum.value,
      ChecksumType: version.checksum.type,
    };
  }
  if (attributes.includes("ObjectParts") && version.parts) {
    // The element for the number of parts has the name PartsCount. The SDKs call it TotalPartsCount.
    if (!version.parts.some(part => part.checksum)) {
      // S3 lists the parts only for an object that has part checksums.
      result.ObjectParts = { PartsCount: version.parts.length };
    } else {
      const after = version.parts.filter(part => part.partNumber > marker);
      const page = after.slice(0, Math.min(maxParts, 1000));
      result.ObjectParts = {
        PartsCount: version.parts.length,
        PartNumberMarker: marker,
        NextPartNumberMarker: page.length > 0 ? page[page.length - 1].partNumber : marker,
        MaxParts: maxParts,
        IsTruncated: page.length < after.length,
        Part: page.map(part => ({
          PartNumber: part.partNumber,
          Size: part.size,
          ...(part.checksum ? { [checksumElementName(part.checksum.algorithm)]: part.checksum.value } : {}),
        })),
      };
    }
  }
  if (attributes.includes("StorageClass")) result.StorageClass = version.storageClass;
  if (attributes.includes("ObjectSize")) result.ObjectSize = version.size;

  return xmlResponse("GetObjectAttributesResponse", result, {
    "last-modified": httpDate(version.lastModified),
    "x-amz-version-id": versionIdHeader(bucket, version),
    ...requestChargedHeaders(context, bucket),
  });
}

export async function restoreObject(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const versionId = requestedVersionId(context);
  const version = findVersion(context, bucket, key, versionId);
  authorize(context, { action: "s3:RestoreObject", bucket, key, acl: "object", grant: "OWNER", version });

  const root = parseXml(await readRequiredDocument(context));
  if (root.name !== "RestoreRequest") throw malformedXml();
  if (child(root, "SelectParameters") || child(root, "OutputLocation")) {
    throw new S3Error("NotImplemented", {
      message: "A header you provided implies functionality that is not implemented",
      details: { Header: "SelectParameters" },
    });
  }
  const tier = childText(child(root, "GlacierJobParameters"), "Tier") ?? childText(root, "Tier") ?? "Standard";
  if (!["Standard", "Bulk", "Expedited"].includes(tier)) throw malformedXml();
  const daysText = childText(root, "Days");
  if (daysText === undefined || !/^\d+$/.test(daysText.trim()) || Number(daysText) < 1) throw malformedXml();

  if (!ARCHIVE_STORAGE_CLASSES.includes(version.storageClass)) {
    throw new S3Error("InvalidObjectState", {
      message: "Restore is not allowed for the object's current storage class",
      details: { StorageClass: version.storageClass },
    });
  }

  // A restore of S3 takes minutes to hours. This server completes it at once.
  const alreadyRestored = isRestored(version, context.now);
  // The restored copy expires at the first midnight in UTC after the number of days.
  const day = 24 * 60 * 60 * 1000;
  const expiry = (Math.floor((context.now.getTime() + Number(daysText) * day) / day) + 1) * day;
  version.restore = { ongoing: false, expiry: new Date(expiry) };
  return emptyResponse(alreadyRestored ? 200 : 202, requestChargedHeaders(context, bucket));
}

/** True when the sender can read the object. The list operations use it for `fetch-owner`. */
export function canReadObject(context: RequestContext, bucket: Bucket, version: ObjectVersion): boolean {
  return isAuthorized(context, {
    action: "s3:GetObject",
    bucket,
    key: version.key,
    acl: "object",
    grant: "READ",
    version,
  });
}
