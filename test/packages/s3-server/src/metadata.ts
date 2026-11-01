// The properties of an object that travel in HTTP headers: how the server
// reads them from an upload and how it writes them to a response.

import { checksumHeaderName } from "./checksums.ts";
import type { RequestContext, ResponseHeaders } from "./context.ts";
import { httpDate, percentDecodeToString, utf8Length } from "./encoding.ts";
import { invalidArgument, invalidRequest, malformedXml, S3Error } from "./errors.ts";
import {
  STORAGE_CLASSES,
  type Bucket,
  type CustomerEncryption,
  type ObjectLock,
  type ObjectMetadata,
  type ObjectVersion,
  type ServerSideEncryption,
  type StorageClass,
  type Tag,
} from "./store.ts";
import { child, children, childText, parseXml, xmlDocument } from "./xml.ts";

/** The limit for the names and values of the `x-amz-meta-*` headers of one object. */
const MAX_USER_METADATA_BYTES = 2048;
const USER_METADATA_PREFIX = "x-amz-meta-";

const SSE_ALGORITHM = "x-amz-server-side-encryption";
const SSE_KMS_KEY = "x-amz-server-side-encryption-aws-kms-key-id";
const SSE_BUCKET_KEY = "x-amz-server-side-encryption-bucket-key-enabled";
const SSEC_ALGORITHM = "x-amz-server-side-encryption-customer-algorithm";
const SSEC_KEY = "x-amz-server-side-encryption-customer-key";
const SSEC_KEY_MD5 = "x-amz-server-side-encryption-customer-key-md5";

export function parseStorageClass(value: string | null): StorageClass {
  if (value === null || value === "") return "STANDARD";
  if (!(STORAGE_CLASSES as readonly string[]).includes(value)) throw new S3Error("InvalidStorageClass");
  return value as StorageClass;
}

/** The part of a header value that is one encoded word of RFC 2047. */
const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/** S3 decodes the encoded words of RFC 2047 in a user metadata value before it stores the value. */
function decodeMetadataValue(value: string): string {
  if (!value.includes("=?")) return value;
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(ENCODED_WORD, (word, charset: string, encoding: string, text: string) => {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(
              text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
              "latin1",
            );
      try {
        // An unknown character set throws.
        return new TextDecoder(charset as "utf-8", { fatal: true }).decode(bytes);
      } catch {
        return word;
      }
    });
}

/**
 * S3 returns a user metadata value that has other characters than printable
 * US-ASCII as an encoded word of RFC 2047.
 */
function encodeMetadataValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Reads the customer key headers of SSE-C. `prefix` is empty for the object of
 * the request and `x-amz-copy-source-` for the source of a copy.
 */
export function customerEncryptionFromHeaders(
  context: RequestContext,
  headers: Headers,
  copySource = false,
): CustomerEncryption | undefined {
  const name = (header: string) => (copySource ? header.replace("x-amz-", "x-amz-copy-source-") : header);
  const algorithm = headers.get(name(SSEC_ALGORITHM));
  const key = headers.get(name(SSEC_KEY));
  const keyMd5 = headers.get(name(SSEC_KEY_MD5));
  if (algorithm === null && key === null && keyMd5 === null) return undefined;

  if (!context.secure) {
    throw invalidRequest(
      "Requests specifying Server Side Encryption with Customer provided keys must be made over a secure connection.",
    );
  }
  if (algorithm === null) {
    throw invalidArgument(
      "Requests specifying Server Side Encryption with Customer provided keys must provide a valid encryption algorithm.",
      name(SSEC_ALGORITHM),
      "null",
    );
  }
  if (algorithm !== "AES256") {
    throw new S3Error("InvalidEncryptionAlgorithmError", {
      details: { ArgumentName: name(SSEC_ALGORITHM), ArgumentValue: algorithm },
    });
  }
  if (key === null) {
    throw invalidArgument(
      "Requests specifying Server Side Encryption with Customer provided keys must provide an appropriate secret key.",
      name(SSEC_KEY),
      "null",
    );
  }
  if (keyMd5 === null) {
    throw invalidArgument(
      "Requests specifying Server Side Encryption with Customer provided keys must provide the client calculated MD5 of the secret key.",
      name(SSEC_KEY_MD5),
      "null",
    );
  }
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32) {
    throw invalidArgument("The secret key was invalid for the specified algorithm.", name(SSEC_KEY), "");
  }
  const computed = new Bun.CryptoHasher("md5").update(bytes).digest("base64");
  if (computed !== keyMd5) {
    throw invalidArgument(
      "The calculated MD5 hash of the key did not match the hash that was provided.",
      name(SSEC_KEY_MD5),
      keyMd5,
    );
  }
  return { algorithm: "AES256", keyMd5 };
}

/**
 * Checks the customer key of a request that reads an object. An object that
 * has SSE-C needs the key that the upload had.
 */
export function checkCustomerEncryption(context: RequestContext, version: ObjectVersion, copySource = false): void {
  const provided = customerEncryptionFromHeaders(context, context.headers, copySource);
  if (!version.customerEncryption) {
    if (provided) {
      throw invalidRequest("The encryption parameters are not applicable to this object.");
    }
    return;
  }
  if (!provided) {
    throw invalidRequest(
      "The object was stored using a form of Server Side Encryption. The correct parameters must be provided to retrieve the object.",
    );
  }
  if (provided.keyMd5 !== version.customerEncryption.keyMd5) {
    throw new S3Error("AccessDenied", {
      message:
        "Access Denied. The calculated MD5 hash of the key did not match the hash that was stored with the object.",
    });
  }
}

function encryptionFromHeaders(
  context: RequestContext,
  headers: Headers,
): { encryption: ServerSideEncryption; customerEncryption: CustomerEncryption | undefined } {
  const customerEncryption = customerEncryptionFromHeaders(context, headers);
  const algorithm = headers.get(SSE_ALGORITHM);
  const kmsKeyId = headers.get(SSE_KMS_KEY);

  if (algorithm === null) {
    if (kmsKeyId !== null) {
      throw invalidArgument(
        "Server Side Encryption with KMS managed key requires HTTP header x-amz-server-side-encryption : aws:kms",
        SSE_KMS_KEY,
        kmsKeyId,
      );
    }
    return { encryption: { algorithm: "AES256" }, customerEncryption };
  }
  if (customerEncryption) {
    throw invalidArgument(
      "Server Side Encryption with Customer provided key is incompatible with the encryption method specified",
      SSE_ALGORITHM,
      algorithm,
    );
  }
  if (algorithm !== "AES256" && algorithm !== "aws:kms" && algorithm !== "aws:kms:dsse") {
    throw invalidArgument("The encryption method specified is not supported", SSE_ALGORITHM, algorithm);
  }
  if (algorithm === "AES256") {
    if (kmsKeyId !== null) {
      throw invalidArgument(
        "Server Side Encryption with KMS managed key requires HTTP header x-amz-server-side-encryption : aws:kms",
        SSE_KMS_KEY,
        kmsKeyId,
      );
    }
    return { encryption: { algorithm }, customerEncryption };
  }
  return {
    encryption: {
      algorithm,
      kmsKeyId: kmsKeyArn(context, kmsKeyId),
      bucketKeyEnabled: headers.get(SSE_BUCKET_KEY)?.toLowerCase() === "true" ? true : undefined,
    },
    customerEncryption,
  };
}

/**
 * The key that S3 reports for an object with SSE-KMS. It is an ARN also when
 * the request has the ID of the key only. Without a key in the request, S3
 * uses the key `aws/s3` of the account.
 */
function kmsKeyArn(context: RequestContext, keyId: string | null): string {
  const account = `arn:aws:kms:${context.server.region}:${context.sender?.accountId ?? "000000000000"}:`;
  if (keyId === null) return account + "alias/aws/s3";
  if (keyId.startsWith("arn:")) return keyId;
  return account + (keyId.startsWith("alias/") ? keyId : "key/" + keyId);
}

/**
 * S3 refuses a request that reads an object and has the header of SSE-S3 or
 * SSE-KMS. Only an upload can select the encryption.
 */
export function checkNoEncryptionHeader(headers: Headers): void {
  const algorithm = headers.get(SSE_ALGORITHM);
  if (algorithm !== null) {
    throw invalidArgument(
      "x-amz-server-side-encryption header is not supported for this operation.",
      SSE_ALGORITHM,
      algorithm,
    );
  }
}

/** The default retention of the object lock configuration of the bucket, for an object that `now` makes. */
function defaultRetention(bucket: Bucket, now: Date): ObjectLock | undefined {
  const configuration = bucket.configurations.get("object-lock");
  if (!bucket.objectLockEnabled || configuration === undefined) return undefined;
  let rule;
  try {
    rule = child(child(parseXml(configuration), "Rule"), "DefaultRetention");
  } catch {
    return undefined;
  }
  const mode = childText(rule, "Mode")?.trim();
  const days = Number(childText(rule, "Days") ?? 0);
  const years = Number(childText(rule, "Years") ?? 0);
  if (mode !== "GOVERNANCE" && mode !== "COMPLIANCE") return undefined;
  const retainUntil = new Date(now);
  if (days > 0) retainUntil.setUTCDate(retainUntil.getUTCDate() + days);
  else if (years > 0) retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + years);
  else return undefined;
  return Number.isNaN(retainUntil.getTime()) ? undefined : { mode, retainUntil };
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** The time of a date in the ISO 8601 format with a time zone. `undefined` for another text. */
export function parseIsoDate(text: string): number | undefined {
  const time = ISO_8601.test(text) ? Date.parse(text) : NaN;
  return Number.isNaN(time) ? undefined : time;
}

function lockFromHeaders(bucket: Bucket, headers: Headers, now: Date): ObjectLock | undefined {
  const mode = headers.get("x-amz-object-lock-mode");
  const until = headers.get("x-amz-object-lock-retain-until-date");
  const hold = headers.get("x-amz-object-lock-legal-hold");
  if (mode === null && until === null && hold === null) return defaultRetention(bucket, now);
  if (!bucket.objectLockEnabled) throw invalidRequest("Bucket is missing Object Lock Configuration");

  // The retention of the request has priority over the default retention of the bucket.
  const lock: ObjectLock = mode === null && until === null ? { ...defaultRetention(bucket, now) } : {};
  if (mode !== null || until !== null) {
    if (mode === null || until === null) {
      throw invalidArgument(
        "x-amz-object-lock-retain-until-date and x-amz-object-lock-mode must both be supplied",
        mode === null ? "x-amz-object-lock-mode" : "x-amz-object-lock-retain-until-date",
        "",
      );
    }
    if (mode !== "GOVERNANCE" && mode !== "COMPLIANCE") {
      throw invalidArgument("Unknown wormMode directive.", "x-amz-object-lock-mode", mode);
    }
    const time = parseIsoDate(until);
    if (time === undefined) {
      throw invalidArgument(
        "The retain until date must be provided in ISO 8601 format",
        "x-amz-object-lock-retain-until-date",
        until,
      );
    }
    if (time <= now.getTime()) {
      throw invalidArgument(
        "The retain until date must be in the future!",
        "x-amz-object-lock-retain-until-date",
        until,
      );
    }
    lock.mode = mode;
    lock.retainUntil = new Date(time);
  }
  if (hold !== null) {
    if (hold !== "ON" && hold !== "OFF") {
      throw invalidArgument("Legal hold must be either of 'ON' or 'OFF'", "x-amz-object-lock-legal-hold", hold);
    }
    lock.legalHold = hold === "ON";
  }
  return lock;
}

/** S3 removes `aws-chunked` from the content encoding that it stores and keeps the rest as the client wrote it. */
function storedContentEncoding(value: string | null): string | undefined {
  if (value === null) return undefined;
  const encodings = value.split(",").filter(encoding => encoding.trim().toLowerCase() !== "aws-chunked");
  return encodings.join(",").trim() || undefined;
}

/** Reads the metadata of a new object from the headers of PutObject, CreateMultipartUpload or CopyObject. */
export function metadataFromHeaders(context: RequestContext, bucket: Bucket, headers: Headers): ObjectMetadata {
  const userMetadata: Record<string, string> = {};
  let userMetadataBytes = 0;
  for (const [name, value] of headers) {
    if (!name.startsWith(USER_METADATA_PREFIX)) continue;
    const short = name.slice(USER_METADATA_PREFIX.length);
    const decoded = decodeMetadataValue(value);
    userMetadata[short] = decoded;
    userMetadataBytes += utf8Length(short) + utf8Length(decoded);
  }
  if (userMetadataBytes > MAX_USER_METADATA_BYTES) {
    throw new S3Error("MetadataTooLarge", {
      details: { Size: userMetadataBytes, MaxSizeAllowed: MAX_USER_METADATA_BYTES },
    });
  }

  const redirect = headers.get("x-amz-website-redirect-location") ?? undefined;
  if (redirect !== undefined && !/^(\/|https?:\/\/)/.test(redirect)) {
    throw invalidArgument(
      "The website redirect location must have a prefix of 'http://' or 'https://' or '/'.",
      "x-amz-website-redirect-location",
      redirect,
    );
  }

  return {
    contentType: headers.get("content-type") || "binary/octet-stream",
    cacheControl: headers.get("cache-control") ?? undefined,
    contentDisposition: headers.get("content-disposition") ?? undefined,
    contentEncoding: storedContentEncoding(headers.get("content-encoding")),
    contentLanguage: headers.get("content-language") ?? undefined,
    expires: headers.get("expires") ?? undefined,
    websiteRedirectLocation: redirect,
    userMetadata,
    storageClass: parseStorageClass(headers.get("x-amz-storage-class")),
    lock: lockFromHeaders(bucket, headers, context.now),
    ...encryptionFromHeaders(context, headers),
  };
}

/** The response headers that describe the encryption of an object. */
export function encryptionHeaders(metadata: {
  encryption: ServerSideEncryption;
  customerEncryption?: CustomerEncryption;
}): ResponseHeaders {
  if (metadata.customerEncryption) {
    return {
      [SSEC_ALGORITHM]: metadata.customerEncryption.algorithm,
      "x-amz-server-side-encryption-customer-key-MD5": metadata.customerEncryption.keyMd5,
    };
  }
  return {
    [SSE_ALGORITHM]: metadata.encryption.algorithm,
    [SSE_KMS_KEY]: metadata.encryption.kmsKeyId,
    [SSE_BUCKET_KEY]: metadata.encryption.bucketKeyEnabled ? "true" : undefined,
  };
}

export function versionIdHeader(bucket: Bucket, version: { versionId: string }): string | undefined {
  // A bucket that never had versioning does not report version IDs.
  return bucket.versioning === undefined ? undefined : version.versionId;
}

/** True when the object is in an archive storage class and has a restored copy that `now` can read. */
export function isRestored(version: ObjectVersion, now: Date): boolean {
  const restore = version.restore;
  return restore !== undefined && !restore.ongoing && restore.expiry!.getTime() > now.getTime();
}

/**
 * The response headers of GetObject and HeadObject. `taggingCount` is for a
 * sender that can read the tags of the object. `now` is the time of the request.
 */
export function objectHeaders(
  bucket: Bucket,
  version: ObjectVersion,
  options: { checksumMode: boolean; taggingCount: boolean; now?: Date },
): ResponseHeaders {
  const headers: ResponseHeaders = {
    "accept-ranges": "bytes",
    "etag": `"${version.etag}"`,
    "last-modified": httpDate(version.lastModified),
    "content-type": version.contentType,
    "cache-control": version.cacheControl,
    "content-disposition": version.contentDisposition,
    "content-encoding": version.contentEncoding,
    "content-language": version.contentLanguage,
    "expires": version.expires,
    "x-amz-version-id": versionIdHeader(bucket, version),
    "x-amz-storage-class": version.storageClass === "STANDARD" ? undefined : version.storageClass,
    "x-amz-website-redirect-location": version.websiteRedirectLocation,
    ...encryptionHeaders(version),
  };
  for (const name in version.userMetadata) {
    headers[USER_METADATA_PREFIX + name] = encodeMetadataValue(version.userMetadata[name]);
  }
  if (options.taggingCount && version.tags.length > 0) headers["x-amz-tagging-count"] = String(version.tags.length);
  if (options.checksumMode && version.checksum) {
    headers[checksumHeaderName(version.checksum.algorithm)] = version.checksum.value;
    headers["x-amz-checksum-type"] = version.checksum.type;
  }
  if (version.restore?.ongoing) {
    headers["x-amz-restore"] = 'ongoing-request="true"';
  } else if (version.restore && (options.now === undefined || isRestored(version, options.now))) {
    // The header goes away when the restored copy expires.
    headers["x-amz-restore"] = `ongoing-request="false", expiry-date="${httpDate(version.restore.expiry!)}"`;
  }
  if (version.lock?.mode) {
    headers["x-amz-object-lock-mode"] = version.lock.mode;
    headers["x-amz-object-lock-retain-until-date"] = version.lock.retainUntil!.toISOString();
  }
  if (version.lock?.legalHold !== undefined) {
    headers["x-amz-object-lock-legal-hold"] = version.lock.legalHold ? "ON" : "OFF";
  }
  return headers;
}

const TAG_CHARACTERS = /^[\p{L}\p{Z}\p{N}_.:/=+\-@]*$/u;

export function validateTags(tags: Tag[], resource: "object" | "bucket"): Tag[] {
  const limit = resource === "object" ? 10 : 50;
  if (tags.length > limit) {
    throw new S3Error("BadRequest", {
      message:
        resource === "object" ? "Object tags cannot be greater than 10" : "Bucket tag count cannot be greater than 50",
    });
  }
  const seen = new Set<string>();
  // The limits count Unicode characters.
  const length = (text: string) => [...text].length;
  for (const { key, value } of tags) {
    if (length(key) < 1 || length(key) > 128 || !TAG_CHARACTERS.test(key)) {
      throw new S3Error("InvalidTag", {
        message: "The TagKey you have provided is invalid",
        details: { TagKey: key },
      });
    }
    if (length(value) > 256 || !TAG_CHARACTERS.test(value)) {
      throw new S3Error("InvalidTag", {
        message: "The TagValue you have provided is invalid",
        details: { TagKey: key, TagValue: value },
      });
    }
    if (key.toLowerCase().startsWith("aws:")) {
      throw new S3Error("InvalidTag", {
        message: "System tags cannot be added/updated by requester",
        details: { TagKey: key },
      });
    }
    if (seen.has(key)) {
      throw new S3Error("InvalidTag", {
        message: "Cannot provide multiple Tags with the same key",
        details: { TagKey: key },
      });
    }
    seen.add(key);
  }
  return tags;
}

/** Parses the `x-amz-tagging` header: the tags as URL query parameters. */
export function tagsFromHeader(value: string | null): Tag[] {
  if (value === null || value === "") return [];
  const invalid = () =>
    invalidArgument(
      "The header 'x-amz-tagging' shall be encoded as UTF-8 then URLEncoded URL query parameters without tag name duplicates.",
      "x-amz-tagging",
      value,
    );
  const tags: Tag[] = [];
  const seen = new Set<string>();
  for (const part of value.split("&")) {
    if (part === "") continue;
    const equals = part.indexOf("=");
    const key = percentDecodeToString(equals === -1 ? part : part.slice(0, equals), true);
    const tagValue = equals === -1 ? "" : percentDecodeToString(part.slice(equals + 1), true);
    if (key === undefined || tagValue === undefined || key === "" || seen.has(key)) throw invalid();
    seen.add(key);
    tags.push({ key, value: tagValue });
  }
  return validateTags(tags, "object");
}

/** Parses the `<Tagging>` body of PutObjectTagging and PutBucketTagging. */
export function parseTagging(body: Uint8Array, resource: "object" | "bucket"): Tag[] {
  const root = parseXml(body);
  if (root.name !== "Tagging") throw malformedXml();
  const tagSet = child(root, "TagSet");
  if (!tagSet) throw malformedXml();
  const tags: Tag[] = [];
  for (const element of children(tagSet, "Tag")) {
    const key = childText(element, "Key");
    const value = childText(element, "Value");
    if (key === undefined || value === undefined) throw malformedXml();
    tags.push({ key, value });
  }
  return validateTags(tags, resource);
}

export function serializeTagging(tags: Tag[]): string {
  return xmlDocument("Tagging", { TagSet: { Tag: tags.map(tag => ({ Key: tag.key, Value: tag.value })) } });
}
