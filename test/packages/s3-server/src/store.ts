// The state of the server: buckets, object versions and multipart uploads.
// All of it is in memory. Nothing here knows about HTTP.

import type { Grant } from "./acl.ts";
import type { Checksum, ChecksumAlgorithm, ChecksumType } from "./checksums.ts";
import type { CorsRule } from "./cors.ts";
import { compareUtf8, randomId } from "./encoding.ts";
import type { BucketPolicy } from "./policy.ts";
import type { Owner } from "./signature.ts";

export const STORAGE_CLASSES = [
  "STANDARD",
  "REDUCED_REDUNDANCY",
  "STANDARD_IA",
  "ONEZONE_IA",
  "INTELLIGENT_TIERING",
  "GLACIER",
  "DEEP_ARCHIVE",
  "OUTPOSTS",
  "GLACIER_IR",
  "SNOW",
  "EXPRESS_ONEZONE",
  "FSX_OPENZFS",
] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

/** S3 does not serve an object of these classes until a restore request completes. */
export const ARCHIVE_STORAGE_CLASSES: readonly StorageClass[] = ["GLACIER", "DEEP_ARCHIVE"];

export interface Tag {
  key: string;
  value: string;
}

export interface ServerSideEncryption {
  algorithm: "AES256" | "aws:kms" | "aws:kms:dsse";
  kmsKeyId?: string;
  bucketKeyEnabled?: boolean;
}

export interface CustomerEncryption {
  algorithm: "AES256";
  /** Base64 of the MD5 of the key. The server does not keep the key. */
  keyMd5: string;
}

export interface ObjectLock {
  mode?: "GOVERNANCE" | "COMPLIANCE";
  retainUntil?: Date;
  legalHold?: boolean;
}

/** The properties of an object that a client sets in the request headers of an upload. */
export interface ObjectMetadata {
  contentType: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  expires?: string;
  websiteRedirectLocation?: string;
  /** The `x-amz-meta-*` headers. The names are lowercase and do not have the prefix. */
  userMetadata: Record<string, string>;
  storageClass: StorageClass;
  encryption: ServerSideEncryption;
  customerEncryption?: CustomerEncryption;
  lock?: ObjectLock;
}

/** The bytes of an object or of a part. It keeps the buffers of the uploads and does not copy them. */
export class ObjectData {
  static readonly EMPTY = new ObjectData([]);

  readonly chunks: readonly Uint8Array[];
  readonly size: number;

  constructor(chunks: readonly Uint8Array[]) {
    this.chunks = chunks.filter(chunk => chunk.length > 0);
    this.size = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
  }

  static concat(list: readonly ObjectData[]): ObjectData {
    return new ObjectData(list.flatMap(data => data.chunks));
  }

  /** The bytes from `start` to `end`. The byte at `end` is not included. */
  slice(start: number, end: number): ObjectData {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    for (const chunk of this.chunks) {
      if (offset >= end) break;
      const from = Math.max(start - offset, 0);
      const to = Math.min(end - offset, chunk.length);
      if (from < to) chunks.push(chunk.subarray(from, to));
      offset += chunk.length;
    }
    return new ObjectData(chunks);
  }

  /** The body of a response that sends the bytes. */
  body(): Uint8Array | Blob {
    return this.chunks.length === 1 ? this.chunks[0] : new Blob(this.chunks as Uint8Array[]);
  }

  /** The bytes in one buffer. It copies them when the data has more than one buffer. */
  bytes(): Uint8Array {
    return this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
  }
}

export interface ObjectPart {
  partNumber: number;
  size: number;
  etag: string;
  checksum?: { algorithm: ChecksumAlgorithm; value: string };
}

export interface ObjectVersion extends ObjectMetadata {
  key: string;
  /** `"null"` for an object that was written while the bucket had no versioning or suspended versioning. */
  versionId: string;
  deleteMarker: boolean;
  data: ObjectData;
  size: number;
  /** Without the quotes. A multipart object has the suffix `-N`, the number of parts. */
  etag: string;
  lastModified: Date;
  owner: Owner;
  acl: Grant[];
  tags: Tag[];
  /** The parts of an object that a multipart upload made. */
  parts?: ObjectPart[];
  checksum?: Checksum;
  /** The state of a restore request for an object in an archive storage class. */
  restore?: { ongoing: boolean; expiry?: Date };
}

export interface UploadedPart extends ObjectPart {
  data: ObjectData;
  lastModified: Date;
}

export interface MultipartUpload extends ObjectMetadata {
  uploadId: string;
  key: string;
  initiated: Date;
  owner: Owner;
  initiator: Owner;
  acl: Grant[];
  tags: Tag[];
  parts: Map<number, UploadedPart>;
  checksumAlgorithm?: ChecksumAlgorithm;
  checksumType?: ChecksumType;
}

export type VersioningStatus = "Enabled" | "Suspended";

export interface DeleteResult {
  /** The version that the request removed, or the version ID of the delete marker that it made. */
  versionId?: string;
  /** The request made a delete marker, or the version that it removed was one. */
  deleteMarker: boolean;
}

/** S3 keeps the time of an object version with a precision of one second. */
function wholeSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

export class Bucket {
  readonly name: string;
  readonly creationDate: Date;
  readonly owner: Owner;
  readonly region: string;

  versioning: VersioningStatus | undefined;
  mfaDelete = false;
  acl: Grant[];
  policy: BucketPolicy | undefined;
  cors: CorsRule[] | undefined;
  tags: Tag[] | undefined;
  requestPayer: "BucketOwner" | "Requester" = "BucketOwner";
  objectLockEnabled = false;
  ownership: "BucketOwnerEnforced" | "BucketOwnerPreferred" | "ObjectWriter" | undefined;
  /** Configuration documents that the server keeps and returns and does not act on. The key is the subresource. */
  readonly configurations = new Map<string, string>();

  /** The versions of each key, the newest first. A key without versions is not in the map. */
  readonly objects = new Map<string, ObjectVersion[]>();
  /** The multipart uploads in progress, by upload ID. */
  readonly uploads = new Map<string, MultipartUpload>();

  #sortedKeys: string[] | undefined;

  constructor(name: string, owner: Owner, region: string, creationDate: Date, acl: Grant[]) {
    this.name = name;
    this.owner = owner;
    this.region = region;
    this.creationDate = creationDate;
    this.acl = acl;
  }

  /** The keys in the order of their UTF-8 bytes. A key whose newest version is a delete marker is included. */
  sortedKeys(): string[] {
    return (this.#sortedKeys ??= [...this.objects.keys()].sort(compareUtf8));
  }

  /** The newest version of the key. It can be a delete marker. */
  latest(key: string): ObjectVersion | undefined {
    return this.objects.get(key)?.[0];
  }

  version(key: string, versionId: string): ObjectVersion | undefined {
    return this.objects.get(key)?.find(version => version.versionId === versionId);
  }

  /** The object that a request without a version ID reads: the newest version, unless it is a delete marker. */
  current(key: string): ObjectVersion | undefined {
    const latest = this.latest(key);
    return latest && !latest.deleteMarker ? latest : undefined;
  }

  /** Makes the version the newest one of its key. It sets the version ID from the versioning state of the bucket. */
  put(version: Omit<ObjectVersion, "versionId">): ObjectVersion {
    const stored = version as ObjectVersion;
    stored.lastModified = wholeSeconds(stored.lastModified);
    const versions = this.objects.get(stored.key);
    if (this.versioning === "Enabled") {
      stored.versionId = randomId(32);
      if (versions) versions.unshift(stored);
      else this.#insertKey(stored.key, [stored]);
      return stored;
    }
    stored.versionId = "null";
    if (versions) {
      const index = versions.findIndex(existing => existing.versionId === "null");
      if (index !== -1) versions.splice(index, 1);
      versions.unshift(stored);
    } else {
      this.#insertKey(stored.key, [stored]);
    }
    return stored;
  }

  /**
   * Deletes as `DeleteObject` does. Without a version ID the result depends on
   * the versioning state: the object goes away, or a delete marker becomes the
   * newest version. With a version ID that version goes away permanently.
   */
  delete(key: string, versionId: string | undefined, owner: Owner, now: Date): DeleteResult {
    const versions = this.objects.get(key);
    if (versionId !== undefined) {
      const index = versions?.findIndex(version => version.versionId === versionId) ?? -1;
      if (!versions || index === -1) return { versionId, deleteMarker: false };
      const [removed] = versions.splice(index, 1);
      if (versions.length === 0) this.#removeKey(key);
      return { versionId, deleteMarker: removed.deleteMarker };
    }

    if (this.versioning === undefined) {
      if (versions) this.#removeKey(key);
      return { deleteMarker: false };
    }

    const marker: ObjectVersion = {
      key,
      versionId: this.versioning === "Enabled" ? randomId(32) : "null",
      deleteMarker: true,
      data: ObjectData.EMPTY,
      size: 0,
      etag: "",
      lastModified: wholeSeconds(now),
      owner,
      acl: [],
      tags: [],
      contentType: "",
      userMetadata: {},
      storageClass: "STANDARD",
      encryption: { algorithm: "AES256" },
    };
    if (!versions) {
      this.#insertKey(key, [marker]);
    } else {
      if (marker.versionId === "null") {
        const index = versions.findIndex(existing => existing.versionId === "null");
        if (index !== -1) versions.splice(index, 1);
      }
      versions.unshift(marker);
    }
    return { versionId: marker.versionId, deleteMarker: true };
  }

  /** True when the bucket has no object version and no delete marker. */
  get isEmpty(): boolean {
    return this.objects.size === 0;
  }

  #insertKey(key: string, versions: ObjectVersion[]): void {
    this.objects.set(key, versions);
    this.#sortedKeys = undefined;
  }

  #removeKey(key: string): void {
    this.objects.delete(key);
    this.#sortedKeys = undefined;
  }
}

let uploadSequence = 0;

/**
 * A new upload ID. The IDs are in the order of their creation when a program
 * compares them as text. ListMultipartUploads needs that for `upload-id-marker`.
 */
export function newUploadId(now: Date): string {
  const time = Math.max(0, now.getTime()).toString(36).padStart(9, "0");
  const sequence = (uploadSequence++).toString(36).padStart(6, "0");
  return time + sequence + randomId(49);
}

const IP_ADDRESS = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** The naming rules of a general purpose bucket. */
export function isValidBucketName(name: string): boolean {
  if (name.length < 3 || name.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return false;
  // Each label between two dots begins and ends with a letter or a digit.
  if (name.includes("..") || name.includes(".-") || name.includes("-.")) return false;
  if (IP_ADDRESS.test(name)) return false;
  if (name.startsWith("xn--") || name.startsWith("sthree-") || name.startsWith("amzn-s3-demo-")) return false;
  for (const suffix of ["-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3"]) {
    if (name.endsWith(suffix)) return false;
  }
  return true;
}
