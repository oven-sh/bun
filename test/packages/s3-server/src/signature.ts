// AWS Signature Version 4 for Amazon S3: the verification of a request that
// has an `Authorization` header or the query parameters of a presigned URL.

import {
  formatAmzDate,
  parseAmzDate,
  parseHttpDate,
  percentDecode,
  percentDecodeToString,
  uriEncode,
} from "./encoding.ts";
import { invalidArgument, invalidRequest, S3Error } from "./errors.ts";

export const ALGORITHM = "AWS4-HMAC-SHA256";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const STREAMING_PAYLOAD = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
export const STREAMING_PAYLOAD_TRAILER = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";
export const STREAMING_UNSIGNED_PAYLOAD_TRAILER = "STREAMING-UNSIGNED-PAYLOAD-TRAILER";
export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** The request time can differ from the server time by 15 minutes. */
export const MAX_SKEW_MS = 15 * 60 * 1000;
/** A presigned URL is valid for 7 days at most. */
export const MAX_EXPIRES_SECONDS = 7 * 24 * 60 * 60;

export interface Owner {
  /** The canonical user ID: 64 hexadecimal characters. */
  id: string;
  displayName: string;
  /** The 12-digit AWS account ID. A bucket policy names an account with it. */
  accountId?: string;
}

export interface Credential {
  accessKeyId: string;
  secretAccessKey: string;
  /** When set, each request must send this value in `x-amz-security-token`. */
  sessionToken?: string;
  /** The account that the access key belongs to. */
  owner: Owner;
}

/** One parameter of the query string, percent-decoded. */
export interface QueryParameter {
  name: string;
  value: string;
}

export interface SignedRequest {
  /** `post` is the signature in the form of PostObject. */
  type: "header" | "query" | "post";
  credential: Credential;
  /** The time of the request as `YYYYMMDDTHHMMSSZ`. */
  timestamp: string;
  /** `YYYYMMDD/region/s3/aws4_request`. */
  scope: string;
  region: string;
  /** The signature of the request. It is the seed for the chunk signatures of a streaming body. */
  signature: string;
  signingKey: Buffer;
  /** The payload hash that the client declared: a SHA-256 in hex, or one of the special values. */
  payloadHash: string;
  signedHeaders: string[];
}

export type Authentication = { type: "anonymous" } | SignedRequest;

export interface AuthenticationInput {
  method: string;
  /** The path of the request URL as the client sent it, percent-encoded. */
  path: string;
  query: QueryParameter[];
  headers: Headers;
  now: Date;
  /** When set, the region of the credential scope must have this value. */
  region: string | undefined;
  findCredential(accessKeyId: string): Credential | undefined;
}

export function sha256Hex(data: string | Uint8Array): string {
  return Bun.SHA256.hash(data, "hex");
}

function hmac(key: string | Uint8Array, data: string): Buffer {
  return new Bun.CryptoHasher("sha256", key).update(data).digest();
}

const signingKeys = new Map<string, Buffer>();

/** The signing key of a credential scope. A key is the same for one day, so the function keeps the last keys. */
export function deriveSigningKey(secretAccessKey: string, date: string, region: string, service = "s3"): Buffer {
  const scope = [secretAccessKey, date, region, service].join("\n");
  let key = signingKeys.get(scope);
  if (!key) {
    key = hmac(hmac(hmac(hmac("AWS4" + secretAccessKey, date), region), service), "aws4_request");
    if (signingKeys.size >= 64) signingKeys.clear();
    signingKeys.set(scope, key);
  }
  return key;
}

export function signString(signingKey: Uint8Array, stringToSign: string): string {
  return hmac(signingKey, stringToSign).toString("hex");
}

/** The canonical URI. S3 encodes each path segment one time and does not normalize the path. */
export function canonicalUri(decodedPath: string | Uint8Array): string {
  return uriEncode(decodedPath, false);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The canonical query string. The parameters are in the order of their
 * encoded names. Parameters that have one name are in the order of their
 * encoded values.
 */
export function canonicalQueryString(query: QueryParameter[]): string {
  return query
    .map(({ name, value }): [string, string] => [uriEncode(name, true), uriEncode(value, true)])
    .sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]))
    .map(([name, value]) => name + "=" + value)
    .join("&");
}

function canonicalHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalRequest(parts: {
  method: string;
  canonicalUri: string;
  canonicalQueryString: string;
  /** Lowercase names with their values, in the order of `signedHeaders`. */
  headers: [name: string, value: string][];
  payloadHash: string;
}): string {
  return [
    parts.method,
    parts.canonicalUri,
    parts.canonicalQueryString,
    ...parts.headers.map(([name, value]) => name + ":" + canonicalHeaderValue(value)),
    "",
    parts.headers.map(([name]) => name).join(";"),
    parts.payloadHash,
  ].join("\n");
}

export function stringToSign(timestamp: string, scope: string, canonical: string): string {
  return [ALGORITHM, timestamp, scope, sha256Hex(canonical)].join("\n");
}

/** The string to sign of one chunk of a `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` body. */
export function chunkStringToSign(
  timestamp: string,
  scope: string,
  previousSignature: string,
  chunk: Uint8Array,
): string {
  return ["AWS4-HMAC-SHA256-PAYLOAD", timestamp, scope, previousSignature, EMPTY_SHA256, sha256Hex(chunk)].join("\n");
}

/** The string to sign of the trailing headers of a `STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER` body. */
export function trailerStringToSign(
  timestamp: string,
  scope: string,
  previousSignature: string,
  trailers: [name: string, value: string][],
): string {
  const canonical = trailers.map(([name, value]) => `${name}:${value}\n`).join("");
  return ["AWS4-HMAC-SHA256-TRAILER", timestamp, scope, previousSignature, sha256Hex(canonical)].join("\n");
}

export function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** The bytes of the text in hexadecimal with spaces between them, a field of the signature errors. */
export function hexBytes(text: string): string {
  return Buffer.from(text, "utf8")
    .toString("hex")
    .replace(/(..)(?=.)/g, "$1 ");
}

/** `2013-05-24T00:00:00Z`, the format of the times in the error documents. */
function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Finds an `X-Amz-*` parameter. The letter case of its name has no effect. */
function findParameter(query: QueryParameter[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return query.find(parameter => parameter.name.toLowerCase() === lower)?.value;
}

/** The parts of `<access key>/<date>/<region>/s3/aws4_request`. */
export interface CredentialScope {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  terminator: string;
}

/** Makes the error of the place that has the credential: the header, the query or the form. */
export type ScopeError = (message: string, details?: Record<string, string>) => S3Error;

/**
 * Reads a credential with its scope and checks the scope. `region` is the
 * region that the scope must have, when the server has one.
 */
export function parseCredentialScope(value: string, region: string | undefined, error: ScopeError): CredentialScope {
  const parts = value.split("/");
  const [date, scopeRegion, service, terminator] = parts.slice(-4);
  const accessKeyId = parts.slice(0, -4).join("/");
  if (parts.length < 5 || accessKeyId === "") {
    throw error('the Credential is mal-formed; expecting "<YOUR-AKID>/YYYYMMDD/REGION/SERVICE/aws4_request".');
  }
  if (!/^\d{8}$/.test(date)) {
    throw error(`incorrect date format "${date}". This date in the credential must be in the format "yyyyMMdd".`);
  }
  if (terminator !== "aws4_request") {
    throw error(`incorrect terminal "${terminator}". This endpoint uses "aws4_request".`);
  }
  if (service !== "s3") {
    throw error(`incorrect service "${service}". This endpoint belongs to "s3".`);
  }
  if (region !== undefined && scopeRegion !== region) {
    throw error(`the region '${scopeRegion}' is wrong; expecting '${region}'`, { Region: region });
  }
  return { accessKeyId, date, region: scopeRegion, service, terminator };
}

// The server is as a region of S3 that has Signature Version 4 only.
const SIGNATURE_V2 = "The authorization mechanism you have provided is not supported. Please use AWS4-HMAC-SHA256.";

/**
 * Verifies the authentication of a request. It returns the identity of the
 * signer, or `anonymous` for a request that carries no authentication. It
 * throws the `S3Error` that Amazon S3 sends for a request it refuses.
 */
export function authenticate(input: AuthenticationInput): Authentication {
  const authorization = input.headers.get("authorization");
  const hasQueryV4 =
    findParameter(input.query, "X-Amz-Algorithm") !== undefined ||
    findParameter(input.query, "X-Amz-Signature") !== undefined ||
    findParameter(input.query, "X-Amz-Credential") !== undefined;
  // Signature Version 2 in the query string uses these exact names.
  const hasQueryV2 =
    input.query.some(parameter => parameter.name === "Signature") ||
    input.query.some(parameter => parameter.name === "AWSAccessKeyId");

  if (authorization !== null && authorization !== "") {
    if (hasQueryV4 || hasQueryV2) {
      throw invalidArgument(
        "Only one auth mechanism allowed; only the X-Amz-Algorithm query parameter, Signature query string parameter or the Authorization header should be specified",
        "Authorization",
        authorization,
      );
    }
    return authenticateHeader(input, authorization);
  }
  if (hasQueryV4) return authenticateQuery(input);
  if (hasQueryV2) throw invalidRequest(SIGNATURE_V2);
  return { type: "anonymous" };
}

function authenticateHeader(input: AuthenticationInput, authorization: string): SignedRequest {
  const space = authorization.indexOf(" ");
  const scheme = space === -1 ? authorization : authorization.slice(0, space);
  if (scheme === "AWS") throw invalidRequest(SIGNATURE_V2);
  if (scheme !== ALGORITHM) {
    throw invalidArgument("Unsupported Authorization Type", "Authorization", authorization);
  }

  const fields = new Map<string, string>();
  for (const part of authorization.slice(scheme.length).split(",")) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf("=");
    if (equals > 0) fields.set(trimmed.slice(0, equals), trimmed.slice(equals + 1));
  }
  const credentialField = fields.get("Credential");
  const signedHeadersField = fields.get("SignedHeaders");
  const signature = fields.get("Signature");
  if (credentialField === undefined || signedHeadersField === undefined || signature === undefined) {
    throw malformedHeader(
      "the authorization header requires three components: Credential, SignedHeaders, and Signature.",
    );
  }

  const parsed = parseCredentialScope(credentialField, input.region, malformedHeader);

  const payloadHash = input.headers.get("x-amz-content-sha256");
  if (payloadHash === null) {
    throw invalidRequest("Missing required header for this request: x-amz-content-sha256");
  }
  if (!isValidPayloadHash(payloadHash)) {
    throw invalidArgument(
      "x-amz-content-sha256 must be UNSIGNED-PAYLOAD, STREAMING-UNSIGNED-PAYLOAD-TRAILER, STREAMING-AWS4-HMAC-SHA256-PAYLOAD, STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER, STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD, STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD-TRAILER or a valid sha256 value.",
      "x-amz-content-sha256",
      payloadHash,
    );
  }

  // x-amz-date has priority over Date.
  const amzDate = input.headers.get("x-amz-date");
  const time = amzDate !== null ? parseAmzDate(amzDate) : parseHttpDate(input.headers.get("date"));
  if (!time) {
    throw new S3Error("AccessDenied", {
      message: "AWS authentication requires a valid Date or x-amz-date header",
    });
  }
  const timestamp = formatAmzDate(time);
  if (timestamp.slice(0, 8) !== parsed.date) {
    throw malformedHeader(
      `Invalid credential date "${parsed.date}". This date is not the same as X-Amz-Date: "${timestamp.slice(0, 8)}".`,
    );
  }

  const signedHeaders = parseSignedHeaders(input, signedHeadersField);
  const credential = resolveCredential(
    accessKeyId => input.findCredential(accessKeyId),
    parsed.accessKeyId,
    input.headers.get("x-amz-security-token"),
  );
  const signed = verify(input, {
    type: "header",
    credential,
    timestamp,
    scope: scopeOf(parsed),
    region: parsed.region,
    date: parsed.date,
    signature,
    payloadHash,
    signedHeaders,
    query: input.query,
  });

  // S3 looks at the access key and the signature before it compares the time with its clock.
  if (Math.abs(input.now.getTime() - time.getTime()) > MAX_SKEW_MS) {
    throw new S3Error("RequestTimeTooSkewed", {
      details: {
        RequestTime: amzDate ?? input.headers.get("date") ?? "",
        ServerTime: isoSeconds(input.now),
        MaxAllowedSkewMilliseconds: MAX_SKEW_MS,
      },
    });
  }
  return signed;
}

function authenticateQuery(input: AuthenticationInput): SignedRequest {
  const algorithm = findParameter(input.query, "X-Amz-Algorithm");
  const credentialField = findParameter(input.query, "X-Amz-Credential");
  const signature = findParameter(input.query, "X-Amz-Signature");
  const amzDate = findParameter(input.query, "X-Amz-Date");
  const signedHeadersField = findParameter(input.query, "X-Amz-SignedHeaders");
  const expiresField = findParameter(input.query, "X-Amz-Expires");

  if (
    algorithm === undefined ||
    credentialField === undefined ||
    signature === undefined ||
    amzDate === undefined ||
    signedHeadersField === undefined ||
    expiresField === undefined
  ) {
    throw new S3Error("AuthorizationQueryParametersError");
  }
  if (algorithm !== ALGORITHM) {
    throw queryError('X-Amz-Algorithm only supports "AWS4-HMAC-SHA256 and AWS4-ECDSA-P256-SHA256"');
  }

  const parsed = parseCredentialScope(credentialField, input.region, credentialParameterError);

  const time = parseAmzDate(amzDate);
  if (!time) {
    throw queryError("X-Amz-Date must be in the ISO8601 Long Format \"yyyyMMdd'T'HHmmss'Z'\"");
  }
  if (amzDate.slice(0, 8) !== parsed.date) {
    throw queryError(
      `Invalid credential date "${parsed.date}". This date is not the same as X-Amz-Date: "${amzDate.slice(0, 8)}".`,
    );
  }

  if (!/^-?\d+$/.test(expiresField)) throw queryError("X-Amz-Expires should be a number");
  const expires = Number(expiresField);
  if (expires < 0) throw queryError("X-Amz-Expires must be non-negative");
  if (expires > MAX_EXPIRES_SECONDS) {
    throw queryError(
      "X-Amz-Expires must be less than a week (in seconds); that is, the given X-Amz-Expires must be less than 604800 seconds",
    );
  }

  const signedHeaders = parseSignedHeaders(input, signedHeadersField);
  const credential = resolveCredential(
    accessKeyId => input.findCredential(accessKeyId),
    parsed.accessKeyId,
    findParameter(input.query, "X-Amz-Security-Token") ?? input.headers.get("x-amz-security-token"),
  );
  const signed = verify(input, {
    type: "query",
    credential,
    timestamp: amzDate,
    scope: scopeOf(parsed),
    region: parsed.region,
    date: parsed.date,
    signature,
    // The signature of a presigned URL does not cover the body, unless the request declares a payload hash.
    payloadHash:
      findParameter(input.query, "X-Amz-Content-Sha256") ??
      input.headers.get("x-amz-content-sha256") ??
      UNSIGNED_PAYLOAD,
    signedHeaders,
    query: input.query.filter(parameter => parameter.name.toLowerCase() !== "x-amz-signature"),
  });

  // S3 looks at the access key and the signature before it looks at the time. The
  // URL is valid from X-Amz-Date to the end of the last of the X-Amz-Expires
  // seconds. With X-Amz-Expires=0 it is never valid.
  const expiresAt = time.getTime() + expires * 1000;
  if (expires === 0 || input.now.getTime() > expiresAt) {
    throw new S3Error("AccessDenied", {
      message: "Request has expired",
      details: {
        "X-Amz-Expires": expires,
        Expires: isoSeconds(new Date(expiresAt)),
        ServerTime: isoSeconds(input.now),
      },
    });
  }
  if (time.getTime() - input.now.getTime() > MAX_SKEW_MS) {
    throw new S3Error("AccessDenied", {
      message: "Request is not yet valid",
      details: { "X-Amz-Date": amzDate, ServerTime: isoSeconds(input.now) },
    });
  }
  return signed;
}

function isValidPayloadHash(value: string): boolean {
  return (
    value === UNSIGNED_PAYLOAD ||
    value === STREAMING_PAYLOAD ||
    value === STREAMING_PAYLOAD_TRAILER ||
    value === STREAMING_UNSIGNED_PAYLOAD_TRAILER ||
    /^[0-9a-fA-F]{64}$/.test(value)
  );
}

function malformedHeader(detail: string, details?: Record<string, string>): S3Error {
  return new S3Error("AuthorizationHeaderMalformed", {
    message: "The authorization header is malformed; " + detail,
    details,
  });
}

function queryError(message: string, details?: Record<string, string>): S3Error {
  return new S3Error("AuthorizationQueryParametersError", { message, details });
}

/** The error for the credential of a presigned URL and of a form. */
export function credentialParameterError(message: string, details?: Record<string, string>): S3Error {
  return queryError("Error parsing the X-Amz-Credential parameter; " + message, details);
}

function scopeOf(parsed: CredentialScope): string {
  return `${parsed.date}/${parsed.region}/${parsed.service}/${parsed.terminator}`;
}

/** The names of the signed headers. The signature must cover `host` and each `x-amz-*` header of the request. */
function parseSignedHeaders(input: AuthenticationInput, field: string): string[] {
  const signedHeaders = field.split(";").map(name => name.trim().toLowerCase());
  const unsigned: string[] = [];
  if (!signedHeaders.includes("host")) unsigned.push("host");
  for (const [name] of input.headers) {
    if (name.startsWith("x-amz-") && !signedHeaders.includes(name)) unsigned.push(name);
  }
  if (unsigned.length > 0) {
    throw new S3Error("AccessDenied", {
      message: "There were headers present in the request which were not signed",
      details: { HeadersNotSigned: unsigned.join(", ") },
    });
  }
  return signedHeaders;
}

/** Finds the credential of an access key and checks the session token of the request. */
export function resolveCredential(
  find: (accessKeyId: string) => Credential | undefined,
  accessKeyId: string,
  token: string | null | undefined,
): Credential {
  const credential = find(accessKeyId);
  if (!credential) {
    throw new S3Error("InvalidAccessKeyId", { details: { AWSAccessKeyId: accessKeyId } });
  }
  if (credential.sessionToken !== undefined) {
    // AWS does not know the access key of temporary credentials without its token.
    if (token === null || token === undefined) {
      throw new S3Error("InvalidAccessKeyId", { details: { AWSAccessKeyId: accessKeyId } });
    }
    if (!signaturesEqual(token, credential.sessionToken)) {
      throw new S3Error("InvalidToken", { details: { "Token-0": token } });
    }
  } else if (token !== null && token !== undefined) {
    throw new S3Error("InvalidToken", { details: { "Token-0": token } });
  }
  return credential;
}

function verify(
  input: AuthenticationInput,
  request: Omit<SignedRequest, "signingKey"> & { date: string; query: QueryParameter[] },
): SignedRequest {
  const headers = request.signedHeaders.map((name): [string, string] => [name, input.headers.get(name) ?? ""]);
  const canonical = canonicalRequest({
    method: input.method,
    canonicalUri: canonicalUri(percentDecodeToString(input.path) ?? percentDecode(input.path)),
    canonicalQueryString: canonicalQueryString(request.query),
    headers,
    payloadHash: request.payloadHash,
  });
  const toSign = stringToSign(request.timestamp, request.scope, canonical);
  const signingKey = deriveSigningKey(request.credential.secretAccessKey, request.date, request.region);
  const expected = signString(signingKey, toSign);

  if (!signaturesEqual(expected, request.signature.toLowerCase())) {
    throw new S3Error("SignatureDoesNotMatch", {
      details: {
        AWSAccessKeyId: request.credential.accessKeyId,
        StringToSign: toSign,
        SignatureProvided: request.signature,
        StringToSignBytes: hexBytes(toSign),
        CanonicalRequest: canonical,
        CanonicalRequestBytes: hexBytes(canonical),
      },
    });
  }

  return {
    type: request.type,
    credential: request.credential,
    timestamp: request.timestamp,
    scope: request.scope,
    region: request.region,
    signature: expected,
    signingKey,
    payloadHash: request.payloadHash,
    signedHeaders: request.signedHeaders,
  };
}
