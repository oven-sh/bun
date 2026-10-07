// ListObjects, ListObjectsV2 and ListObjectVersions.

import { authorize } from "../authorize.ts";
import { xmlResponse, type RequestContext } from "../context.ts";
import { compareUtf8, decodeUtf8, urlEncodeListValue } from "../encoding.ts";
import { invalidArgument, S3Error } from "../errors.ts";
import type { Bucket, ObjectVersion } from "../store.ts";
import { XmlFragment, type XmlNode } from "../xml.ts";
import { checkVersionId, requestChargedHeaders, requireBucket } from "./common.ts";

/** S3 returns at most this number of entries in one response. */
const MAX_KEYS = 1000;
const MAX_INT32 = 2147483647;

interface ListParameters {
  prefix: string;
  delimiter: string | undefined;
  maxKeys: number;
  encode: (value: string) => string;
  encodingType: string | undefined;
  /** The request asks for the `RestoreStatus` element of each object. */
  restoreStatus: boolean;
}

/** A value that is not a 32-bit integer and a negative value have different messages in S3. */
function parseMaxKeys(text: string | undefined): number {
  if (text === undefined || text === "") return MAX_KEYS;
  const value = /^-?\d+$/.test(text) ? Number(text) : NaN;
  if (!(value >= -MAX_INT32 - 1 && value <= MAX_INT32)) {
    throw invalidArgument("Provided max-keys not an integer or within integer range", "max-keys", text);
  }
  if (value < 0) {
    throw invalidArgument("Argument maxKeys must be an integer between 0 and 2147483647", "maxKeys", text);
  }
  return Math.min(value, MAX_KEYS);
}

function listParameters(context: RequestContext): ListParameters {
  const { query } = context;
  const maxKeys = parseMaxKeys(query.get("max-keys"));
  const encodingType = query.get("encoding-type");
  if (encodingType !== undefined && encodingType !== "url") {
    throw invalidArgument("Invalid Encoding Method specified in Request", "encoding-type", encodingType);
  }
  const optional = (context.headers.get("x-amz-optional-object-attributes") ?? "").split(",");
  return {
    prefix: query.get("prefix") ?? "",
    // An empty delimiter is the same as no delimiter.
    delimiter: query.get("delimiter") || undefined,
    maxKeys,
    encode: encodingType === "url" ? urlEncodeListValue : value => value,
    encodingType,
    restoreStatus: optional.some(name => name.trim() === "RestoreStatus"),
  };
}

/** The index of the first key that is not before `target` in the order of the list. */
function lowerBound(keys: string[], target: string): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareUtf8(keys[middle], target) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The index after the block of keys that start with `prefix`. The block
 * starts at `from`. The step of the search grows, so a block of many keys
 * costs few comparisons.
 */
function endOfBlock(keys: string[], from: number, prefix: string): number {
  let low = from + 1;
  let high = low;
  for (let step = 1; high < keys.length && keys[high].startsWith(prefix); step *= 2) {
    low = high + 1;
    high += step;
  }
  high = Math.min(high, keys.length);
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle].startsWith(prefix)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The common prefix that a key rolls up into, when the request has a delimiter. */
function commonPrefixOf(key: string, prefix: string, delimiter: string | undefined): string | undefined {
  if (delimiter === undefined) return undefined;
  const index = key.indexOf(delimiter, prefix.length);
  return index === -1 ? undefined : key.slice(0, index + delimiter.length);
}

/** S3 lists a key or a common prefix only when it is after the marker. The keys in a common prefix do not count. */
function isAfter(value: string, marker: string | undefined): boolean {
  return marker === undefined || compareUtf8(value, marker) > 0;
}

type Item = { version: ObjectVersion; commonPrefix?: undefined } | { commonPrefix: string; version?: undefined };

interface Page {
  items: Item[];
  truncated: boolean;
  /** The last key or common prefix of the page. */
  last: string | undefined;
}

/**
 * Lists the keys that have a current object. The result is the sequence of
 * keys and common prefixes in the order of S3, after `after`. A common prefix
 * counts as one item.
 */
function listCurrent(bucket: Bucket, parameters: ListParameters, after: string | undefined): Page {
  const { prefix, delimiter, maxKeys } = parameters;
  const items: Item[] = [];
  let truncated = false;
  if (maxKeys === 0) return { items, truncated, last: undefined };

  const keys = bucket.sortedKeys();
  const start = after !== undefined && compareUtf8(after, prefix) > 0 ? after : prefix;
  let index = lowerBound(keys, start);
  while (index < keys.length) {
    const key = keys[index];
    if (!key.startsWith(prefix)) break;

    let item: Item | undefined;
    const commonPrefix = commonPrefixOf(key, prefix, delimiter);
    if (commonPrefix !== undefined) {
      const end = endOfBlock(keys, index, commonPrefix);
      if (isAfter(commonPrefix, after)) {
        // A key whose newest version is a delete marker does not make a common prefix.
        for (let i = index; i < end && !item; i++) {
          if (bucket.current(keys[i])) item = { commonPrefix };
        }
      }
      index = end;
    } else {
      index++;
      const version = isAfter(key, after) ? bucket.current(key) : undefined;
      if (version) item = { version };
    }

    if (!item) continue;
    if (items.length === maxKeys) {
      truncated = true;
      break;
    }
    items.push(item);
  }

  const last = items[items.length - 1];
  return { items, truncated, last: last?.version?.key ?? last?.commonPrefix };
}

function ownerNode(owner: { id: string; displayName: string }): XmlNode {
  return { ID: owner.id, DisplayName: owner.displayName };
}

function restoreStatus(version: ObjectVersion, parameters: ListParameters): XmlNode {
  if (!parameters.restoreStatus || !version.restore) return undefined;
  return {
    IsRestoreInProgress: version.restore.ongoing,
    RestoreExpiryDate: version.restore.ongoing ? undefined : version.restore.expiry,
  };
}

function contents(page: Page, parameters: ListParameters, withOwner: boolean): XmlNode[] {
  const out: XmlNode[] = [];
  for (const { version } of page.items) {
    if (version === undefined) continue;
    out.push({
      Key: parameters.encode(version.key),
      LastModified: version.lastModified,
      ETag: `"${version.etag}"`,
      ChecksumAlgorithm: version.checksum?.algorithm,
      ChecksumType: version.checksum?.type,
      Size: version.size,
      Owner: withOwner ? ownerNode(version.owner) : undefined,
      StorageClass: version.storageClass,
      RestoreStatus: restoreStatus(version, parameters),
    });
  }
  return out;
}

function commonPrefixes(page: Page, parameters: ListParameters): XmlNode[] {
  const out: XmlNode[] = [];
  for (const item of page.items) {
    if (item.commonPrefix !== undefined) out.push({ Prefix: parameters.encode(item.commonPrefix) });
  }
  return out;
}

export async function listObjects(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:ListBucket", bucket, acl: "bucket", grant: "READ" });
  const parameters = listParameters(context);
  const marker = context.query.get("marker") ?? "";
  const page = listCurrent(bucket, parameters, marker === "" ? undefined : marker);

  return xmlResponse(
    "ListBucketResult",
    {
      Name: bucket.name,
      Prefix: parameters.encode(parameters.prefix),
      Marker: parameters.encode(marker),
      // Without a delimiter the client uses the last key of the page as the next marker.
      NextMarker: page.truncated && parameters.delimiter !== undefined ? parameters.encode(page.last!) : undefined,
      MaxKeys: parameters.maxKeys,
      Delimiter: parameters.delimiter === undefined ? undefined : parameters.encode(parameters.delimiter),
      EncodingType: parameters.encodingType,
      IsTruncated: page.truncated,
      Contents: contents(page, parameters, true),
      CommonPrefixes: commonPrefixes(page, parameters),
    },
    { "x-amz-bucket-region": bucket.region, ...requestChargedHeaders(context, bucket) },
  );
}

const TOKEN_VERSION = "1";

/** The token has characters that a client must encode in the query string, as the tokens of S3 have. */
function encodeContinuationToken(last: string): string {
  return TOKEN_VERSION + Buffer.from(last, "utf8").toString("base64");
}

function decodeContinuationToken(token: string): string {
  const last = token.startsWith(TOKEN_VERSION)
    ? decodeUtf8(Buffer.from(token.slice(TOKEN_VERSION.length), "base64"))
    : undefined;
  if (last === undefined || last === "" || encodeContinuationToken(last) !== token) {
    throw invalidArgument("The continuation token provided is incorrect", "continuation-token", token);
  }
  return last;
}

export async function listObjectsV2(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:ListBucket", bucket, acl: "bucket", grant: "READ" });
  const parameters = listParameters(context);
  const { query } = context;
  const token = query.get("continuation-token");
  const startAfter = query.get("start-after") ?? "";
  const fetchOwner = query.get("fetch-owner")?.toLowerCase() === "true";

  // The token has priority over start-after.
  let after: string | undefined;
  if (token !== undefined) after = decodeContinuationToken(token);
  else if (startAfter !== "") after = startAfter;
  const page = listCurrent(bucket, parameters, after);

  return xmlResponse(
    "ListBucketResult",
    {
      Name: bucket.name,
      Prefix: parameters.encode(parameters.prefix),
      StartAfter: startAfter === "" ? undefined : parameters.encode(startAfter),
      ContinuationToken: token,
      NextContinuationToken: page.truncated ? encodeContinuationToken(page.last!) : undefined,
      KeyCount: page.items.length,
      MaxKeys: parameters.maxKeys,
      Delimiter: parameters.delimiter === undefined ? undefined : parameters.encode(parameters.delimiter),
      EncodingType: parameters.encodingType,
      IsTruncated: page.truncated,
      Contents: contents(page, parameters, fetchOwner),
      CommonPrefixes: commonPrefixes(page, parameters),
    },
    { "x-amz-bucket-region": bucket.region, ...requestChargedHeaders(context, bucket) },
  );
}

function versionIdMarkerOf(context: RequestContext, keyMarker: string): string | undefined {
  const marker = context.query.get("version-id-marker");
  if (marker === undefined) return undefined;
  if (marker === "") throw invalidArgument("A version-id marker cannot be empty.", "version-id-marker", marker);
  if (keyMarker === "") {
    throw invalidArgument("A version-id marker cannot be specified without a key marker.", "version-id-marker", marker);
  }
  try {
    return checkVersionId(marker);
  } catch (error) {
    if (!(error instanceof S3Error)) throw error;
    throw invalidArgument("Invalid version id specified", "version-id-marker", marker);
  }
}

function versionEntry(
  version: ObjectVersion,
  isLatest: boolean,
  parameters: ListParameters,
): [tag: string, node: XmlNode] {
  const common = {
    Key: parameters.encode(version.key),
    VersionId: version.versionId,
    IsLatest: isLatest,
    LastModified: version.lastModified,
  };
  if (version.deleteMarker) return ["DeleteMarker", { ...common, Owner: ownerNode(version.owner) }];
  return [
    "Version",
    {
      ...common,
      ETag: `"${version.etag}"`,
      ChecksumAlgorithm: version.checksum?.algorithm,
      ChecksumType: version.checksum?.type,
      Size: version.size,
      Owner: ownerNode(version.owner),
      StorageClass: version.storageClass,
      RestoreStatus: restoreStatus(version, parameters),
    },
  ];
}

export async function listObjectVersions(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  authorize(context, { action: "s3:ListBucketVersions", bucket, acl: "bucket", grant: "READ" });
  const parameters = listParameters(context);
  const { prefix, delimiter, maxKeys, encode } = parameters;
  const keyMarker = context.query.get("key-marker") ?? "";
  const versionIdMarker = versionIdMarkerOf(context, keyMarker);
  const after = keyMarker === "" ? undefined : keyMarker;

  const entries: [tag: string, node: XmlNode][] = [];
  const prefixes: string[] = [];
  let truncated = false;
  // The markers of the next page name the last entry of this page.
  let nextKeyMarker: string | undefined;
  let nextVersionIdMarker: string | undefined;

  const keys = bucket.sortedKeys();
  const start = after !== undefined && compareUtf8(after, prefix) > 0 ? after : prefix;
  let index = maxKeys === 0 ? keys.length : lowerBound(keys, start);
  scan: while (index < keys.length) {
    const key = keys[index];
    if (!key.startsWith(prefix)) break;

    const commonPrefix = commonPrefixOf(key, prefix, delimiter);
    if (commonPrefix !== undefined) {
      index = endOfBlock(keys, index, commonPrefix);
      if (!isAfter(commonPrefix, after)) continue;
      if (entries.length + prefixes.length === maxKeys) {
        truncated = true;
        break;
      }
      prefixes.push(commonPrefix);
      nextKeyMarker = commonPrefix;
      nextVersionIdMarker = undefined;
      continue;
    }

    index++;
    const versions = bucket.objects.get(key)!;
    let first = 0;
    if (key === after) {
      // The key of the marker continues after the version of the marker. Without a version marker it is complete.
      first = versionIdMarker === undefined ? -1 : versions.findIndex(v => v.versionId === versionIdMarker);
      if (first === -1) continue;
      first++;
    }
    for (let i = first; i < versions.length; i++) {
      if (entries.length + prefixes.length === maxKeys) {
        truncated = true;
        break scan;
      }
      entries.push(versionEntry(versions[i], i === 0, parameters));
      nextKeyMarker = key;
      nextVersionIdMarker = versions[i].versionId;
    }
  }

  return xmlResponse(
    "ListVersionsResult",
    new XmlFragment([
      ["Name", bucket.name],
      ["Prefix", encode(prefix)],
      ["KeyMarker", encode(keyMarker)],
      ["VersionIdMarker", versionIdMarker ?? ""],
      ["NextKeyMarker", truncated ? encode(nextKeyMarker!) : undefined],
      ["NextVersionIdMarker", truncated ? nextVersionIdMarker : undefined],
      ["MaxKeys", maxKeys],
      ["Delimiter", delimiter === undefined ? undefined : encode(delimiter)],
      ["EncodingType", parameters.encodingType],
      ["IsTruncated", truncated],
      ...entries,
      ["CommonPrefixes", prefixes.map(value => ({ Prefix: encode(value) }))],
    ]),
    { "x-amz-bucket-region": bucket.region, ...requestChargedHeaders(context, bucket) },
  );
}
