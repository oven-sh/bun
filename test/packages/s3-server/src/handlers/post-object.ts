// PostObject: the upload of an object with an HTML form. The form has the key
// and the properties of the object, the signature, and the policy document
// that limits what the form can have.

import { authorize } from "../authorize.ts";
import { declaredLength, MAX_OBJECT_SIZE, readPayload } from "../body.ts";
import {
  checksumFromHeaders,
  checksumHeaderName,
  checksumMismatch,
  computeChecksum,
  parseChecksumAlgorithm,
  type Checksum,
} from "../checksums.ts";
import { emptyResponse, rawXmlResponse, type RequestContext, type ResponseHeaders } from "../context.ts";
import { decodeUtf8, parseAmzDate, uriEncode, utf8Length } from "../encoding.ts";
import { invalidArgument, invalidRequest, S3Error } from "../errors.ts";
import { encryptionHeaders, metadataFromHeaders, parseTagging, versionIdHeader } from "../metadata.ts";
import {
  ALGORITHM,
  credentialParameterError,
  deriveSigningKey,
  hexBytes,
  parseCredentialScope,
  resolveCredential,
  signaturesEqual,
  signString,
  UNSIGNED_PAYLOAD,
  type SignedRequest,
} from "../signature.ts";
import { ObjectData } from "../store.ts";
import { xmlDocument } from "../xml.ts";
import { MAX_KEY_BYTES, newObjectOwnership, requestChargedHeaders, requireBucket } from "./common.ts";

/** The limit of S3 for the fields that come before the file: 20 KB. */
const MAX_FIELDS_SIZE = 20_000;

const FILENAME_VARIABLE = "${filename}";

/** The fields of Signature Version 4, with their names as S3 writes them in an error. */
const SIGNATURE_FIELDS: [field: string, name: string][] = [
  ["x-amz-signature", "X-Amz-Signature"],
  ["x-amz-algorithm", "X-Amz-Algorithm"],
  ["x-amz-credential", "X-Amz-Credential"],
  ["x-amz-date", "X-Amz-Date"],
];

/** The fields that become the headers of the object, with the `x-amz-*` fields. */
const PROPERTY_FIELDS = [
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-type",
  "expires",
];

/** The headers of the request that apply to an upload with a form. The form has all others. */
const REQUEST_HEADERS = [
  "host",
  "origin",
  "referer",
  "user-agent",
  "x-amz-expected-bucket-owner",
  "x-amz-request-payer",
];

interface Form {
  /** The fields that come before the file. The names are lowercase. */
  fields: Map<string, string>;
  file: Uint8Array;
}

interface FieldCondition {
  operator: "eq" | "starts-with";
  /** The name of the field in lowercase. `undefined` when the condition has no `$` before the name. */
  field: string | undefined;
  value: string;
  /** The condition as S3 writes it in an error. */
  text: string;
}

interface SizeCondition {
  operator: "content-length-range";
  min: number;
  max: number;
}

type Condition = FieldCondition | SizeCondition;

interface Policy {
  expiration: Date;
  conditions: Condition[];
}

function missingField(name: string): S3Error {
  return invalidArgument(
    `Bucket POST must contain a field named '${name}'.  If it is specified, please check the order of the fields.`,
    name,
    "",
  );
}

function invalidPolicy(detail: string): S3Error {
  return new S3Error("InvalidPolicyDocument", { message: "Invalid Policy: " + detail });
}

function policyViolation(detail: string): S3Error {
  return new S3Error("AccessDenied", { message: "Invalid according to Policy: " + detail });
}

function signatureFieldError(message: string, details?: Record<string, string>): S3Error {
  return new S3Error("AuthorizationQueryParametersError", { message, details });
}

function tooLarge(size: number, limit: number): S3Error {
  return new S3Error("EntityTooLarge", { details: { ProposedSize: size, MaxSizeAllowed: limit } });
}

/** Parses the body with the form parser of Bun, after the checks that the body of each request has. */
async function parseForm(context: RequestContext, contentType: string, limit: number) {
  const { data } = await readPayload(context, limit);
  try {
    return await new Response(data, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new S3Error("MalformedPOSTRequest");
  }
}

async function readForm(context: RequestContext): Promise<Form> {
  const contentType = context.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*(;|$)/i.test(contentType.trim())) {
    throw new S3Error("PreconditionFailed", {
      details: { Condition: "Bucket POST must be of the enclosure-type multipart/form-data" },
    });
  }
  // The fields and the boundaries add to the size of the file.
  const limit = MAX_OBJECT_SIZE + 2 * MAX_FIELDS_SIZE;
  const length = declaredLength(context.headers) ?? 0;
  if (length > limit) throw tooLarge(length, MAX_OBJECT_SIZE);

  const form = await parseForm(context, contentType, limit);
  const fields = new Map<string, string>();
  let size = 0;
  for (const [name, value] of form.entries()) {
    const lower = name.toLowerCase();
    if (lower === "file") {
      // S3 ignores each field that comes after the file.
      const isText = typeof value === "string";
      const file = isText ? Buffer.from(value, "utf8") : new Uint8Array(await value.arrayBuffer());
      // S3 uses the part of the file name after the last slash or backslash.
      const path = isText ? "" : String(value.name ?? "");
      const fileName = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
      for (const [field, text] of fields) fields.set(field, text.replaceAll(FILENAME_VARIABLE, fileName));
      return { fields, file };
    }
    // A client can send a field as a file part. S3 reads it as text.
    const text = typeof value === "string" ? value : await value.text();
    size += utf8Length(name) + utf8Length(text);
    if (size > MAX_FIELDS_SIZE) throw new S3Error("MaxPostPreDataLengthExceededError");
    if (!fields.has(lower)) fields.set(lower, text);
  }
  throw invalidArgument("POST requires exactly one file upload per request.", "file", 0);
}

/**
 * Verifies the signature of the form. The string to sign is the value of the
 * `policy` field as the form has it, in base64. The result is `undefined` for
 * a form that has no signature and no policy.
 */
function authenticateForm(context: RequestContext, fields: Map<string, string>): SignedRequest | undefined {
  const policy = fields.get("policy");
  if (!SIGNATURE_FIELDS.some(([field]) => fields.has(field))) {
    if (fields.has("signature") || fields.has("awsaccesskeyid")) {
      if (!fields.has("signature")) throw missingField("Signature");
      if (!fields.has("awsaccesskeyid")) throw missingField("AWSAccessKeyId");
      throw invalidRequest(
        "The authorization mechanism you have provided is not supported. Please use AWS4-HMAC-SHA256.",
      );
    }
    // S3 does not accept a policy that no signature protects.
    if (policy !== undefined) throw new S3Error("AccessDenied");
    return undefined;
  }
  for (const [field, name] of SIGNATURE_FIELDS) {
    if (!fields.has(field)) throw missingField(name);
  }
  if (policy === undefined) throw missingField("policy");

  if (fields.get("x-amz-algorithm") !== ALGORITHM) {
    throw signatureFieldError('X-Amz-Algorithm only supports "AWS4-HMAC-SHA256 and AWS4-ECDSA-P256-SHA256"');
  }
  const { accessKeyId, date, region, service, terminator } = parseCredentialScope(
    fields.get("x-amz-credential")!,
    context.server.enforcedRegion,
    credentialParameterError,
  );

  const timestamp = fields.get("x-amz-date")!;
  if (!parseAmzDate(timestamp)) {
    throw signatureFieldError("X-Amz-Date must be in the ISO8601 Long Format \"yyyyMMdd'T'HHmmss'Z'\"");
  }
  if (timestamp.slice(0, 8) !== date) {
    throw signatureFieldError(
      `Invalid credential date "${date}". This date is not the same as X-Amz-Date: "${timestamp.slice(0, 8)}".`,
    );
  }

  const credential = resolveCredential(
    accessKeyId => context.server.findCredential(accessKeyId),
    accessKeyId,
    fields.get("x-amz-security-token"),
  );

  const signingKey = deriveSigningKey(credential.secretAccessKey, date, region);
  const signature = signString(signingKey, policy);
  const provided = fields.get("x-amz-signature")!;
  if (!signaturesEqual(signature, provided.toLowerCase())) {
    throw new S3Error("SignatureDoesNotMatch", {
      details: {
        AWSAccessKeyId: accessKeyId,
        StringToSign: policy,
        SignatureProvided: provided,
        StringToSignBytes: hexBytes(policy),
      },
    });
  }
  return {
    type: "post",
    credential,
    timestamp,
    scope: `${date}/${region}/${service}/${terminator}`,
    region,
    signature,
    signingKey,
    payloadHash: UNSIGNED_PAYLOAD,
    signedHeaders: [],
  };
}

function conditionText(operator: string, name: string, value: string): string {
  return "[" + [operator, name, value].map(item => JSON.stringify(item)).join(", ") + "]";
}

/** A limit of `content-length-range`: a number, or the digits of a number in a string. */
function parseLimit(value: unknown): number | undefined {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function parseCondition(raw: unknown): Condition {
  if (Array.isArray(raw)) {
    const operator = typeof raw[0] === "string" ? raw[0].toLowerCase() : undefined;
    if (operator === "content-length-range") {
      const min = parseLimit(raw[1]);
      const max = parseLimit(raw[2]);
      if (raw.length !== 3 || min === undefined || max === undefined) {
        throw invalidPolicy("Invalid Condition: content-length-range requires a minimum and a maximum size.");
      }
      return { operator, min, max };
    }
    if (operator !== "eq" && operator !== "starts-with") {
      throw invalidPolicy(`Invalid Condition: unknown operation '${String(raw[0])}'.`);
    }
    const [, name, value] = raw;
    if (raw.length !== 3 || typeof name !== "string" || typeof value !== "string") {
      throw invalidPolicy(`Invalid Condition: '${raw[0]}' requires a field name and a value.`);
    }
    return {
      operator,
      field: name.startsWith("$") ? name.slice(1).toLowerCase() : undefined,
      value,
      text: conditionText(raw[0], name, value),
    };
  }
  if (typeof raw !== "object" || raw === null) {
    throw invalidPolicy("Invalid Condition: a condition is a list or an object.");
  }
  const entries = Object.entries(raw);
  if (entries.length !== 1) {
    throw invalidPolicy("Invalid Simple-Condition: Simple-Conditions must have exactly one property specified.");
  }
  const [name, value] = entries[0];
  if (typeof value !== "string") {
    throw invalidPolicy("Invalid Simple-Condition: the value of the property must be a string.");
  }
  return { operator: "eq", field: name.toLowerCase(), value, text: conditionText("eq", "$" + name, value) };
}

/** The time of an expiration: ISO 8601 in UTC, with `Z`, with or without a fraction of a second. */
function parseExpiration(value: unknown): Date | undefined {
  const match = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z$/.exec(value) : null;
  if (!match) return undefined;
  const date = new Date(match[1] + (match[2] ?? ".").slice(0, 4).padEnd(4, "0") + "Z");
  // JavaScript reads February 30 as a day of March.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(match[1]) ? date : undefined;
}

function parsePolicy(encoded: string): Policy {
  const base64 = encoded.replace(/\s+/g, "");
  const text = /^[A-Za-z0-9+/]*={0,2}$/.test(base64) ? decodeUtf8(Buffer.from(base64, "base64")) : undefined;
  let document: unknown;
  try {
    document = text === undefined ? undefined : JSON.parse(text);
  } catch {
    document = undefined;
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw invalidPolicy("Invalid JSON.");
  }

  // The names of the properties are case-sensitive.
  for (const name in document) {
    if (name !== "expiration" && name !== "conditions") throw invalidPolicy(`Unexpected: '${name}'`);
  }
  const { expiration: time, conditions } = document as { expiration?: unknown; conditions?: unknown };
  if (time === undefined) throw invalidPolicy("Policy missing expiration.");
  const expiration = parseExpiration(time);
  if (!expiration) throw invalidPolicy(`Invalid 'expiration' value: '${String(time)}'`);

  if (conditions === undefined) throw invalidPolicy("Policy missing conditions.");
  if (!Array.isArray(conditions)) throw invalidPolicy("Invalid 'conditions' value: must be a List.");
  return { expiration, conditions: conditions.map(parseCondition) };
}

function conditionHolds(condition: FieldCondition, actual: string): boolean {
  if (condition.operator === "eq") return actual === condition.value;
  // S3 reads a content type that has commas as a list. Each item must have the prefix.
  const values = condition.field === "content-type" ? actual.split(",").map(item => item.trim()) : [actual];
  return values.every(item => item.startsWith(condition.value));
}

/** Checks the fields of the form against the policy. The size of the file has its check after this one. */
function checkPolicy(policy: Policy, fields: Map<string, string>, bucketName: string, now: Date): void {
  if (policy.expiration.getTime() <= now.getTime()) throw policyViolation("Policy expired.");

  const covered = new Set<string>();
  for (const condition of policy.conditions) {
    if (condition.operator === "content-length-range") continue;
    const { field } = condition;
    if (field !== undefined) covered.add(field);
    // The bucket is the bucket of the request. A field that the form does not have is empty.
    const actual = field === "bucket" ? bucketName : ((field === undefined ? undefined : fields.get(field)) ?? "");
    if (field === undefined || !conditionHolds(condition, actual)) {
      throw policyViolation("Policy Condition failed: " + condition.text);
    }
  }
  // S3 wants a condition for the bucket and for each field, with these exceptions.
  for (const name of [...fields.keys(), "bucket"]) {
    if (name === "x-amz-signature" || name === "policy" || name.startsWith("x-ignore-")) continue;
    if (!covered.has(name)) throw policyViolation("Extra input fields: " + name);
  }
}

function checkSize(policy: Policy | undefined, size: number): void {
  for (const condition of policy?.conditions ?? []) {
    if (condition.operator !== "content-length-range") continue;
    if (size < condition.min) {
      throw new S3Error("EntityTooSmall", { details: { ProposedSize: size, MinSizeAllowed: condition.min } });
    }
    if (size > condition.max) throw tooLarge(size, condition.max);
  }
  if (size > MAX_OBJECT_SIZE) throw tooLarge(size, MAX_OBJECT_SIZE);
}

/** The fields that set the properties of the object, as the headers that PutObject has for them. */
function propertyHeaders(context: RequestContext, fields: Map<string, string>): Headers {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = context.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const [name, value] of fields) {
    const isSignature = name === "x-amz-security-token" || SIGNATURE_FIELDS.some(([field]) => field === name);
    const isProperty = PROPERTY_FIELDS.includes(name) || (name.startsWith("x-amz-") && !isSignature);
    if (name !== "acl" && !isProperty) continue;
    try {
      // A header has bytes. The text of the form is in UTF-8.
      headers.set(name === "acl" ? "x-amz-acl" : name, Buffer.from(value, "utf8").toString("latin1"));
    } catch {
      // The name or the value has a character that no header can have, for example a line break.
      throw new S3Error("InvalidArgument", { details: { ArgumentName: name, ArgumentValue: value } });
    }
  }
  return headers;
}

function verifyChecksum(headers: Headers, file: Uint8Array): Checksum | undefined {
  const declared = checksumFromHeaders(headers);
  const requested = parseChecksumAlgorithm(headers.get("x-amz-checksum-algorithm"), "x-amz-checksum-algorithm");
  if (declared && requested && declared.algorithm !== requested) {
    throw invalidRequest("Value for x-amz-checksum-algorithm header is invalid.");
  }
  const algorithm = declared?.algorithm ?? requested;
  if (!algorithm) return undefined;
  const value = computeChecksum(algorithm, file);
  if (declared && declared.value !== value) throw checksumMismatch(algorithm);
  return { algorithm, value, type: "FULL_OBJECT" };
}

function objectLocation(context: RequestContext, bucketName: string, key: string): string {
  const scheme = context.secure ? "https" : "http";
  const host = context.headers.get("host") ?? "";
  const path = context.virtualHosted ? "" : "/" + uriEncode(bucketName, false);
  // S3 encodes each slash of the key in this URL.
  return `${scheme}://${host}${path}/${uriEncode(key, true)}`;
}

/** The URL of `success_action_redirect` with the result of the upload. `undefined` for a URL that S3 cannot use. */
function redirectLocation(url: string, bucketName: string, key: string, etag: string): string | undefined {
  if (!/^https?:\/\/[\x21-\x7e]+$/i.test(url) || !URL.canParse(url)) return undefined;
  const hash = url.indexOf("#");
  const base = hash === -1 ? url : url.slice(0, hash);
  const result = `bucket=${uriEncode(bucketName, true)}&key=${uriEncode(key, true)}&etag=${uriEncode(etag, true)}`;
  return base + (base.includes("?") ? "&" : "?") + result + (hash === -1 ? "" : url.slice(hash));
}

export async function postObject(context: RequestContext): Promise<Response> {
  const bucket = requireBucket(context);
  const { fields, file } = await readForm(context);

  const key = fields.get("key");
  if (key === undefined) throw missingField("key");
  if (key === "") throw invalidArgument("User key must have a length greater than 0.", "key", "");
  const keySize = utf8Length(key);
  if (keySize > MAX_KEY_BYTES) {
    throw new S3Error("KeyTooLongError", { details: { Size: keySize, MaxSizeAllowed: MAX_KEY_BYTES } });
  }
  context.key = key;

  const signed = authenticateForm(context, fields);
  const policy = signed && parsePolicy(fields.get("policy")!);
  if (policy) checkPolicy(policy, fields, bucket.name, context.now);
  checkSize(policy, file.length);

  const headers = propertyHeaders(context, fields);
  // The form has what the headers and the signature of a PUT request have.
  const form: RequestContext = {
    ...context,
    headers,
    authentication: signed ?? context.authentication,
    sender: signed ? signed.credential.owner : context.sender,
  };
  const metadata = metadataFromHeaders(form, bucket, headers);
  const tagging = fields.get("tagging") ?? "";
  const tags = tagging === "" ? [] : parseTagging(Buffer.from(tagging, "utf8"), "object");
  const { owner, acl } = newObjectOwnership(form, bucket);
  authorize(form, { action: "s3:PutObject", bucket, key, acl: "bucket", grant: "WRITE", requestTags: tags });
  const checksum = verifyChecksum(headers, file);

  const version = bucket.put({
    ...metadata,
    key,
    deleteMarker: false,
    data: new ObjectData([file]),
    size: file.length,
    etag: new Bun.CryptoHasher("md5").update(file).digest("hex"),
    lastModified: context.now,
    owner,
    acl,
    tags,
    checksum,
  });

  const etag = `"${version.etag}"`;
  const location = objectLocation(context, bucket.name, key);
  const responseHeaders: ResponseHeaders = {
    etag,
    location,
    "x-amz-version-id": versionIdHeader(bucket, version),
    ...(checksum
      ? { [checksumHeaderName(checksum.algorithm)]: checksum.value, "x-amz-checksum-type": checksum.type }
      : {}),
    ...encryptionHeaders(version),
    ...requestChargedHeaders(form, bucket),
  };

  const redirect = fields.get("success_action_redirect") ?? fields.get("redirect");
  const target = redirect === undefined ? undefined : redirectLocation(redirect, bucket.name, key, etag);
  if (target !== undefined) return emptyResponse(303, { ...responseHeaders, location: target });

  switch (fields.get("success_action_status")) {
    case "200":
      return emptyResponse(200, responseHeaders);
    case "201":
      return rawXmlResponse(
        xmlDocument("PostResponse", { Location: location, Bucket: bucket.name, Key: key, ETag: etag }, null),
        responseHeaders,
        201,
      );
    default:
      return emptyResponse(204, responseHeaders);
  }
}
