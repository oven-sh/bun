// CreateMultipartUpload, UploadPart, UploadPartCopy, CompleteMultipartUpload,
// AbortMultipartUpload, ListParts and ListMultipartUploads.

import { authorize } from "../authorize.ts";
import { MAX_DOCUMENT_SIZE, MAX_OBJECT_SIZE, readPayload } from "../body.ts";
import {
  checksumElementName,
  checksumHeaderName,
  checksumMismatch,
  CHECKSUM_ALGORITHMS,
  compositeChecksum,
  computeChecksum,
  parseChecksumAlgorithm,
  type Checksum,
  type ChecksumAlgorithm,
  type ChecksumType,
} from "../checksums.ts";
import { emptyResponse, parseInteger, xmlResponse, type RequestContext } from "../context.ts";
import { compareUtf8, unquoteETag, uriEncode, urlEncodeListValue } from "../encoding.ts";
import { invalidArgument, invalidRequest, malformedXml, S3Error } from "../errors.ts";
import {
  customerEncryptionFromHeaders,
  encryptionHeaders,
  metadataFromHeaders,
  tagsFromHeader,
  versionIdHeader,
} from "../metadata.ts";
import {
  newUploadId,
  ObjectData,
  type Bucket,
  type MultipartUpload,
  type ObjectPart,
  type ObjectVersion,
  type UploadedPart,
} from "../store.ts";
import { children, childText, parseXml, type XmlNode } from "../xml.ts";
import {
  checkWriteConditions,
  newObjectOwnership,
  requestChargedHeaders,
  requireBucket,
  requireKey,
} from "./common.ts";
import { findCopySource } from "./object.ts";

/** Each part of a multipart upload, but not the last one, has this size at least: 5 MiB. */
export const MIN_PART_SIZE = 5 * 1024 * 1024;
export const MAX_PART_NUMBER = 10000;

const MAX_LIST_ENTRIES = 1000;

function noSuchUpload(uploadId: string): S3Error {
  return new S3Error("NoSuchUpload", { details: { UploadId: uploadId } });
}

function findUpload(context: RequestContext, bucket: Bucket, key: string): MultipartUpload {
  const uploadId = context.query.get("uploadId") ?? "";
  const upload = bucket.uploads.get(uploadId);
  if (!upload || upload.key !== key) throw noSuchUpload(uploadId);
  return upload;
}

function partNumberOf(context: RequestContext): number {
  const value = context.query.get("partNumber");
  const number = parseInteger(value, "partNumber", {
    min: 1,
    max: MAX_PART_NUMBER,
    message: "Part number must be an integer between 1 and 10000, inclusive",
  });
  if (number === undefined) {
    throw invalidArgument("Part number must be an integer between 1 and 10000, inclusive", "partNumber", value);
  }
  return number;
}

function checksumTypeOf(algorithm: ChecksumAlgorithm | undefined, value: string | null): ChecksumType | undefined {
  if (value === null || value === "") {
    if (!algorithm) return undefined;
    return algorithm === "CRC64NVME" ? "FULL_OBJECT" : "COMPOSITE";
  }
  const type = value.toUpperCase();
  if (type !== "COMPOSITE" && type !== "FULL_OBJECT") {
    throw invalidRequest("Value for x-amz-checksum-type header is invalid.");
  }
  if (!algorithm) {
    throw invalidRequest("The x-amz-checksum-type header can only be used with the x-amz-checksum-algorithm header.");
  }
  if (type === "FULL_OBJECT" && (algorithm === "SHA1" || algorithm === "SHA256")) {
    throw invalidRequest(
      `The FULL_OBJECT checksum type cannot be used with the ${algorithm.toLowerCase()} checksum algorithm.`,
    );
  }
  if (type === "COMPOSITE" && algorithm === "CRC64NVME") {
    throw invalidRequest("The COMPOSITE checksum type cannot be used with the crc64nvme checksum algorithm.");
  }
  return type;
}

export async function createMultipartUpload(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const tags = tagsFromHeader(context.headers.get("x-amz-tagging"));
  // The access decision comes before the checks of the other headers.
  authorize(context, { action: "s3:PutObject", bucket, key, acl: "bucket", grant: "WRITE", requestTags: tags });
  const metadata = metadataFromHeaders(context, bucket, context.headers);
  const { owner, acl } = newObjectOwnership(context, bucket);

  const checksumAlgorithm = parseChecksumAlgorithm(
    context.headers.get("x-amz-checksum-algorithm"),
    "x-amz-checksum-algorithm",
  );
  const checksumType = checksumTypeOf(checksumAlgorithm, context.headers.get("x-amz-checksum-type"));
  await context.request.arrayBuffer();

  const upload: MultipartUpload = {
    ...metadata,
    uploadId: newUploadId(context.now),
    key,
    initiated: context.now,
    owner,
    initiator: context.sender ?? owner,
    acl,
    tags,
    parts: new Map(),
    checksumAlgorithm,
    checksumType,
  };
  bucket.uploads.set(upload.uploadId, upload);

  return xmlResponse(
    "InitiateMultipartUploadResult",
    { Bucket: bucket.name, Key: key, UploadId: upload.uploadId },
    {
      "x-amz-checksum-algorithm": checksumAlgorithm,
      "x-amz-checksum-type": checksumType,
      ...encryptionHeaders(upload),
      ...requestChargedHeaders(context, bucket),
    },
  );
}

/** An upload with SSE-C needs the customer key in each request that sends a part. */
function checkPartEncryption(context: RequestContext, upload: MultipartUpload): void {
  const provided = customerEncryptionFromHeaders(context, context.headers);
  if (!upload.customerEncryption) {
    if (provided) {
      throw invalidRequest("The encryption parameters are not applicable to this object.");
    }
    return;
  }
  if (!provided) {
    throw invalidRequest(
      "The multipart upload initiate requested encryption. Subsequent part requests must include the appropriate encryption parameters.",
    );
  }
  if (provided.keyMd5 !== upload.customerEncryption.keyMd5) {
    throw invalidRequest("The provided encryption parameters did not match the ones used originally.");
  }
}

function algorithmMismatch(expected: ChecksumAlgorithm, actual: ChecksumAlgorithm): S3Error {
  return invalidRequest(
    `Checksum Type mismatch occurred, expected checksum Type: ${expected.toLowerCase()}, actual checksum Type: ${actual.toLowerCase()}`,
  );
}

/** A part has a checksum of the algorithm of its upload. The headers tell that before the body arrives. */
function checkPartAlgorithm(context: RequestContext, upload: MultipartUpload): void {
  const expected = upload.checksumAlgorithm;
  if (!expected) return;
  const trailers = (context.headers.get("x-amz-trailer") ?? "").split(",").map(name => name.trim().toLowerCase());
  for (const algorithm of CHECKSUM_ALGORITHMS) {
    const name = checksumHeaderName(algorithm);
    if (algorithm !== expected && (context.headers.has(name) || trailers.includes(name))) {
      throw algorithmMismatch(expected, algorithm);
    }
  }
}

/** The checksum that the server keeps for a part: the one of the request, or one that it computes. */
function partChecksum(
  upload: MultipartUpload,
  declared: { algorithm: ChecksumAlgorithm; value: string } | undefined,
  data: () => Uint8Array | Uint8Array[],
): ObjectPart["checksum"] {
  const algorithm = upload.checksumAlgorithm;
  if (!algorithm) return undefined;
  if (declared?.algorithm === algorithm) return declared;
  return { algorithm, value: computeChecksum(algorithm, data()) };
}

export async function uploadPart(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const partNumber = partNumberOf(context);
  const upload = findUpload(context, bucket, key);
  authorize(context, { action: "s3:PutObject", bucket, key, acl: "bucket", grant: "WRITE" });
  checkPartEncryption(context, upload);
  checkPartAlgorithm(context, upload);

  const payload = await readPayload(context, MAX_OBJECT_SIZE);
  // The upload can end while the body of the part arrives.
  if (bucket.uploads.get(upload.uploadId) !== upload) throw noSuchUpload(upload.uploadId);

  const part: UploadedPart = {
    partNumber,
    data: new ObjectData([payload.data]),
    size: payload.data.length,
    etag: payload.md5.toString("hex"),
    lastModified: context.now,
    checksum: partChecksum(upload, payload.checksum, () => payload.data),
  };
  upload.parts.set(partNumber, part);

  return emptyResponse(200, {
    "etag": `"${part.etag}"`,
    ...(part.checksum ? { [checksumHeaderName(part.checksum.algorithm)]: part.checksum.value } : {}),
    ...encryptionHeaders(upload),
    ...requestChargedHeaders(context, bucket),
  });
}

export async function uploadPartCopy(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const partNumber = partNumberOf(context);
  const upload = findUpload(context, bucket, key);
  authorize(context, { action: "s3:PutObject", bucket, key, acl: "bucket", grant: "WRITE" });
  checkPartEncryption(context, upload);

  const source = findCopySource(context);
  const size = source.version.size;
  let data = source.version.data;
  const rangeHeader = context.headers.get("x-amz-copy-source-range");
  if (rangeHeader !== null) {
    const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader.trim());
    if (!match) {
      throw invalidArgument(
        "The x-amz-copy-source-range value must be of the form bytes=first-last where first and last are the zero-based offsets of the first and last bytes to copy",
        "x-amz-copy-source-range",
        rangeHeader,
      );
    }
    const first = Number(match[1]);
    const last = Number(match[2]);
    if (first > last || last >= size) {
      throw invalidArgument(
        `Range specified is not valid for source object of size: ${size}`,
        "x-amz-copy-source-range",
        rangeHeader,
      );
    }
    data = data.slice(first, last + 1);
  }
  if (data.size > MAX_OBJECT_SIZE) {
    throw new S3Error("EntityTooLarge", { details: { ProposedSize: data.size, MaxSizeAllowed: MAX_OBJECT_SIZE } });
  }

  await context.request.arrayBuffer();
  if (bucket.uploads.get(upload.uploadId) !== upload) throw noSuchUpload(upload.uploadId);
  const chunks = data.chunks as Uint8Array[];
  const hasher = new Bun.CryptoHasher("md5");
  for (const chunk of chunks) hasher.update(chunk);

  const part: UploadedPart = {
    partNumber,
    data,
    size: data.size,
    etag: hasher.digest("hex"),
    lastModified: context.now,
    checksum: partChecksum(upload, undefined, () => chunks),
  };
  upload.parts.set(partNumber, part);

  return xmlResponse(
    "CopyPartResult",
    {
      LastModified: part.lastModified,
      ETag: `"${part.etag}"`,
      ...(part.checksum ? { [checksumElementName(part.checksum.algorithm)]: part.checksum.value } : {}),
    },
    {
      "x-amz-copy-source-version-id": versionIdHeader(source.bucket, source.version),
      ...encryptionHeaders(upload),
      ...requestChargedHeaders(context, bucket),
    },
  );
}

/**
 * The URL of the object, as the `Location` element of CompleteMultipartUploadResult has it.
 * S3 encodes each `/` of the key there.
 */
function objectLocation(context: RequestContext, bucket: Bucket, key: string): string {
  const scheme = context.secure ? "https" : "http";
  const host = context.headers.get("host") ?? "";
  const path = context.virtualHosted ? "" : "/" + uriEncode(bucket.name, false);
  return `${scheme}://${host}${path}/${uriEncode(key, true)}`;
}

interface RequestedPart {
  partNumber: number;
  /** Without the quotes. */
  etag: string;
  checksums: Partial<Record<ChecksumAlgorithm, string>>;
}

function parseRequestedParts(document: Uint8Array): RequestedPart[] {
  const root = parseXml(document);
  if (root.name !== "CompleteMultipartUpload") throw malformedXml();
  const elements = children(root, "Part");
  if (elements.length === 0 || elements.length > MAX_PART_NUMBER) throw malformedXml();
  return elements.map(element => {
    const number = childText(element, "PartNumber")?.trim();
    const etag = childText(element, "ETag");
    if (number === undefined || etag === undefined || !/^-?\d+$/.test(number)) throw malformedXml();
    const checksums: RequestedPart["checksums"] = {};
    for (const algorithm of CHECKSUM_ALGORITHMS) {
      const value = childText(element, checksumElementName(algorithm))?.trim();
      if (value !== undefined) checksums[algorithm] = value;
    }
    return { partNumber: Number(number), etag: unquoteETag(etag), checksums };
  });
}

/** The parts that the request lists, or the error of S3 for a list that the upload cannot take. */
function selectParts(upload: MultipartUpload, requested: RequestedPart[]): UploadedPart[] {
  const { uploadId, checksumAlgorithm, checksumType } = upload;
  let previous = 0;
  for (const { partNumber } of requested) {
    if (partNumber < 1) throw invalidArgument("PartNumber must be >= 1", "PartNumber", partNumber);
    // The part numbers of an upload with a checksum algorithm start at 1 and have no gaps.
    if (partNumber <= previous || (checksumAlgorithm !== undefined && partNumber !== previous + 1)) {
      throw new S3Error("InvalidPartOrder", { details: { UploadId: uploadId } });
    }
    previous = partNumber;
  }

  const parts: UploadedPart[] = [];
  for (const { partNumber, etag, checksums } of requested) {
    const part = upload.parts.get(partNumber);
    let valid = part !== undefined && part.etag === etag;
    for (const algorithm of CHECKSUM_ALGORITHMS) {
      const value = checksums[algorithm];
      if (value === undefined) continue;
      if (part?.checksum?.algorithm !== algorithm || part.checksum.value !== value) valid = false;
    }
    if (!part || !valid) {
      throw new S3Error("InvalidPart", { details: { UploadId: uploadId, PartNumber: partNumber, ETag: etag } });
    }
    // S3 joins the part checksums of the request to the composite checksum. A full object checksum needs none.
    if (checksumAlgorithm !== undefined && checksumType === "COMPOSITE" && checksums[checksumAlgorithm] === undefined) {
      const name = checksumAlgorithm.toLowerCase();
      throw invalidRequest(
        `The upload was created using a ${name} checksum. The complete request must include the checksum for each part. It was missing for part ${partNumber} in the request.`,
      );
    }
    parts.push(part);
  }

  for (const part of parts.slice(0, -1)) {
    if (part.size < MIN_PART_SIZE) {
      throw new S3Error("EntityTooSmall", {
        details: {
          ProposedSize: part.size,
          MinSizeAllowed: MIN_PART_SIZE,
          PartNumber: part.partNumber,
          ETag: part.etag,
        },
      });
    }
  }
  return parts;
}

/**
 * The checksum headers of CompleteMultipartUpload describe the object and not
 * the document of the request. The reader of the body does not see them.
 */
function withoutObjectChecksum(context: RequestContext): RequestContext {
  const headers = new Headers(context.headers);
  for (const algorithm of CHECKSUM_ALGORITHMS) headers.delete(checksumHeaderName(algorithm));
  headers.delete("x-amz-sdk-checksum-algorithm");
  return { ...context, headers };
}

/** The checksum of the object that the request declares. It can have the composite form, with `-N`. */
function declaredObjectChecksum(headers: Headers): { algorithm: ChecksumAlgorithm; value: string } | undefined {
  let found: { algorithm: ChecksumAlgorithm; value: string } | undefined;
  for (const algorithm of CHECKSUM_ALGORITHMS) {
    const value = headers.get(checksumHeaderName(algorithm));
    if (value === null) continue;
    if (found) {
      throw invalidRequest("Expecting a single x-amz-checksum- header. Multiple checksum Types are not allowed.");
    }
    found = { algorithm, value: value.trim() };
  }
  return found;
}

function checkDeclaredChecksum(
  headers: Headers,
  algorithm: ChecksumAlgorithm,
  type: ChecksumType,
): { algorithm: ChecksumAlgorithm; value: string } | undefined {
  const declaredType = headers.get("x-amz-checksum-type");
  if (declaredType !== null && declaredType.trim().toUpperCase() !== type) {
    throw new S3Error("BadDigest", {
      message: `The upload was created using the ${type} checksum mode. The complete request must use the same checksum mode.`,
    });
  }
  const declared = declaredObjectChecksum(headers);
  if (declared && declared.algorithm !== algorithm) throw algorithmMismatch(algorithm, declared.algorithm);
  return declared;
}

/** What the server keeps of an upload that is complete. With it, the same request gets the same answer again. */
interface CompletedUpload {
  key: string;
  version: WeakRef<ObjectVersion>;
  /** The part numbers and the entity tags of the request, see `partList`. */
  parts: string;
}

const MAX_COMPLETED_UPLOADS = 1000;
const completedUploads = new WeakMap<Bucket, Map<string, CompletedUpload>>();

function partList(requested: RequestedPart[]): string {
  return requested.map(part => `${part.partNumber}:${part.etag}`).join(",");
}

function rememberCompleted(bucket: Bucket, uploadId: string, completed: CompletedUpload): void {
  let uploads = completedUploads.get(bucket);
  if (!uploads) completedUploads.set(bucket, (uploads = new Map()));
  uploads.set(uploadId, completed);
  if (uploads.size > MAX_COMPLETED_UPLOADS) uploads.delete(uploads.keys().next().value!);
}

/**
 * The object of an upload that is complete, for a request that repeats the
 * one that completed it. S3 answers such a request with success.
 */
function completedObject(bucket: Bucket, uploadId: string, requested: RequestedPart[]): ObjectVersion {
  const completed = completedUploads.get(bucket)?.get(uploadId);
  const version = completed?.version.deref();
  if (
    !completed ||
    !version ||
    bucket.version(completed.key, version.versionId) !== version ||
    partList(requested) !== completed.parts
  ) {
    throw noSuchUpload(uploadId);
  }
  return version;
}

function completeResponse(context: RequestContext, bucket: Bucket, version: ObjectVersion): Response {
  const { checksum } = version;
  return xmlResponse(
    "CompleteMultipartUploadResult",
    {
      Location: objectLocation(context, bucket, version.key),
      Bucket: bucket.name,
      Key: version.key,
      ETag: `"${version.etag}"`,
      ...(checksum ? { [checksumElementName(checksum.algorithm)]: checksum.value, ChecksumType: checksum.type } : {}),
    },
    {
      "x-amz-version-id": versionIdHeader(bucket, version),
      ...encryptionHeaders(version),
      ...requestChargedHeaders(context, bucket),
    },
  );
}

export async function completeMultipartUpload(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const uploadId = context.query.get("uploadId") ?? "";
  const known = bucket.uploads.get(uploadId) ?? completedUploads.get(bucket)?.get(uploadId);
  if (known?.key !== key) throw noSuchUpload(uploadId);
  authorize(context, { action: "s3:PutObject", bucket, key, acl: "bucket", grant: "WRITE" });

  const document = await readPayload(withoutObjectChecksum(context), MAX_DOCUMENT_SIZE);
  const requested = parseRequestedParts(document.data);
  // The upload can end while the document arrives.
  const upload = bucket.uploads.get(uploadId);
  if (!upload) return completeResponse(context, bucket, completedObject(bucket, uploadId, requested));

  const parts = selectParts(upload, requested);
  const size = parts.reduce((total, part) => total + part.size, 0);
  const expectedSize = context.headers.get("x-amz-mp-object-size");
  if (expectedSize !== null && Number(expectedSize) !== size) {
    throw invalidRequest("The provided 'x-amz-mp-object-size' header does not match what was computed");
  }

  const data = ObjectData.concat(parts.map(part => part.data));

  let checksum: Checksum | undefined;
  if (upload.checksumAlgorithm) {
    const algorithm = upload.checksumAlgorithm;
    const type = upload.checksumType ?? "COMPOSITE";
    const declared = checkDeclaredChecksum(context.headers, algorithm, type);
    checksum = {
      algorithm,
      type,
      value:
        type === "COMPOSITE"
          ? compositeChecksum(
              algorithm,
              parts.map(part => part.checksum!.value),
            )
          : computeChecksum(algorithm, data.chunks as Uint8Array[]),
    };
    if (declared && declared.value !== checksum.value) throw checksumMismatch(algorithm);
  }

  checkWriteConditions(context, bucket, key);

  const digests = Buffer.concat(parts.map(part => Buffer.from(part.etag, "hex")));
  const etag = new Bun.CryptoHasher("md5").update(digests).digest("hex") + "-" + parts.length;

  bucket.uploads.delete(uploadId);
  const {
    uploadId: _uploadId,
    initiated,
    initiator: _initiator,
    parts: _parts,
    checksumAlgorithm: _algorithm,
    checksumType: _type,
    ...properties
  } = upload;
  const version = bucket.put({
    ...properties,
    deleteMarker: false,
    data,
    size,
    etag,
    // The time of an object from a multipart upload is the time when the upload started.
    lastModified: initiated,
    // A request for a part of the object counts the parts from 1, also when the upload had gaps.
    parts: parts.map(({ size, etag, checksum }, index) => ({ partNumber: index + 1, size, etag, checksum })),
    checksum,
  });
  rememberCompleted(bucket, uploadId, { key, version: new WeakRef(version), parts: partList(requested) });

  return completeResponse(context, bucket, version);
}

export async function abortMultipartUpload(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const upload = findUpload(context, bucket, key);
  const { initiator } = upload;
  authorize(context, { action: "s3:AbortMultipartUpload", bucket, key, acl: "bucket", grant: "OWNER", initiator });
  bucket.uploads.delete(upload.uploadId);
  return emptyResponse(204, requestChargedHeaders(context, bucket));
}

function ownerNode(owner: { id: string; displayName: string }): XmlNode {
  return { ID: owner.id, DisplayName: owner.displayName };
}

export async function listParts(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const key = requireKey(context);
  const upload = findUpload(context, bucket, key);
  const { initiator } = upload;
  authorize(context, { action: "s3:ListMultipartUploadParts", bucket, key, acl: "bucket", grant: "OWNER", initiator });

  const maxParts = Math.min(
    parseInteger(context.query.get("max-parts"), "max-parts") ?? MAX_LIST_ENTRIES,
    MAX_LIST_ENTRIES,
  );
  const marker = parseInteger(context.query.get("part-number-marker"), "part-number-marker") ?? 0;

  const after = [...upload.parts.values()]
    .filter(part => part.partNumber > marker)
    .sort((a, b) => a.partNumber - b.partNumber);
  const page = after.slice(0, maxParts);
  // As in the other lists, a maximum of 0 gives a list that is empty and complete.
  const truncated = maxParts > 0 && page.length < after.length;

  return xmlResponse(
    "ListPartsResult",
    {
      Bucket: bucket.name,
      Key: key,
      UploadId: upload.uploadId,
      Initiator: ownerNode(upload.initiator),
      Owner: ownerNode(upload.owner),
      StorageClass: upload.storageClass,
      ChecksumAlgorithm: upload.checksumAlgorithm,
      ChecksumType: upload.checksumType,
      PartNumberMarker: marker,
      NextPartNumberMarker: page.length > 0 ? page[page.length - 1].partNumber : marker,
      MaxParts: maxParts,
      IsTruncated: truncated,
      Part: page.map(part => ({
        PartNumber: part.partNumber,
        LastModified: part.lastModified,
        ETag: `"${part.etag}"`,
        Size: part.size,
        ...(part.checksum ? { [checksumElementName(part.checksum.algorithm)]: part.checksum.value } : {}),
      })),
    },
    requestChargedHeaders(context, bucket),
  );
}

export async function listMultipartUploads(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:ListBucketMultipartUploads", bucket, acl: "bucket", grant: "READ" });

  const { query } = context;
  const prefix = query.get("prefix") ?? "";
  const delimiter = query.get("delimiter") || undefined;
  const keyMarker = query.get("key-marker") ?? "";
  // S3 ignores the upload ID marker of a request that has no key marker.
  const uploadIdMarker = keyMarker === "" ? "" : (query.get("upload-id-marker") ?? "");
  const maxUploads = Math.min(
    parseInteger(query.get("max-uploads"), "max-uploads") ?? MAX_LIST_ENTRIES,
    MAX_LIST_ENTRIES,
  );
  const encodingType = query.get("encoding-type");
  if (encodingType !== undefined && encodingType !== "url") {
    throw invalidArgument("Invalid Encoding Method specified in Request", "encoding-type", encodingType);
  }
  const encode = (value: string) => (encodingType === "url" ? urlEncodeListValue(value) : value);

  const uploads = [...bucket.uploads.values()]
    .filter(upload => upload.key.startsWith(prefix))
    .sort((a, b) => compareUtf8(a.key, b.key) || (a.uploadId < b.uploadId ? -1 : a.uploadId > b.uploadId ? 1 : 0));

  const listed: MultipartUpload[] = [];
  const commonPrefixes: string[] = [];
  let truncated = false;
  let nextKeyMarker = "";
  let nextUploadIdMarker = "";

  for (const upload of uploads) {
    const order = compareUtf8(upload.key, keyMarker);
    if (keyMarker !== "") {
      if (order < 0) continue;
      if (order === 0 && (uploadIdMarker === "" || upload.uploadId <= uploadIdMarker)) continue;
    }
    let commonPrefix: string | undefined;
    if (delimiter !== undefined) {
      const index = upload.key.indexOf(delimiter, prefix.length);
      if (index !== -1) commonPrefix = upload.key.slice(0, index + delimiter.length);
    }
    if (commonPrefix !== undefined) {
      if (commonPrefixes[commonPrefixes.length - 1] === commonPrefix) continue;
      if (keyMarker !== "" && compareUtf8(commonPrefix, keyMarker) <= 0) continue;
    }
    if (listed.length + commonPrefixes.length >= maxUploads) {
      truncated = maxUploads > 0;
      break;
    }
    if (commonPrefix !== undefined) {
      commonPrefixes.push(commonPrefix);
      nextKeyMarker = commonPrefix;
      nextUploadIdMarker = "";
    } else {
      listed.push(upload);
      nextKeyMarker = upload.key;
      nextUploadIdMarker = upload.uploadId;
    }
  }

  return xmlResponse(
    "ListMultipartUploadsResult",
    {
      Bucket: bucket.name,
      KeyMarker: encode(keyMarker),
      UploadIdMarker: uploadIdMarker,
      // S3 names the last entry of the list also when the list is complete.
      NextKeyMarker: encode(nextKeyMarker),
      NextUploadIdMarker: nextUploadIdMarker,
      Delimiter: delimiter === undefined ? undefined : encode(delimiter),
      Prefix: encode(prefix),
      MaxUploads: maxUploads,
      EncodingType: encodingType,
      IsTruncated: truncated,
      Upload: listed.map(upload => ({
        Key: encode(upload.key),
        UploadId: upload.uploadId,
        Initiator: ownerNode(upload.initiator),
        Owner: ownerNode(upload.owner),
        StorageClass: upload.storageClass,
        Initiated: upload.initiated,
        ChecksumAlgorithm: upload.checksumAlgorithm,
        ChecksumType: upload.checksumType,
      })),
      CommonPrefixes: commonPrefixes.map(value => ({ Prefix: encode(value) })),
    },
    requestChargedHeaders(context, bucket),
  );
}
