// The CORS configuration of a bucket: the document of PutBucketCors and
// GetBucketCors, and the response headers of a cross-origin request.

import { invalidRequest, malformedXml, S3Error } from "./errors.ts";
import { parseXml, xmlDocument, type XmlElement } from "./xml.ts";

export interface CorsRule {
  id?: string;
  allowedOrigins: string[];
  /** Uppercase: GET, PUT, POST, DELETE, HEAD. */
  allowedMethods: string[];
  allowedHeaders: string[];
  exposeHeaders: string[];
  maxAgeSeconds?: number;
}

export interface CorsMatch {
  rule: CorsRule;
  /**
   * The value for Access-Control-Allow-Origin: "*" when the rule allows the
   * origin with the literal "*", else the origin of the request.
   */
  allowOrigin: string;
}

const METHODS: readonly string[] = ["GET", "PUT", "POST", "DELETE", "HEAD"];
const MAX_RULES = 100;
const MAX_ID_LENGTH = 255;
const MAX_INT32 = 2 ** 31 - 1;

const VARY = "Origin, Access-Control-Request-Headers, Access-Control-Request-Method";
const NOT_ENABLED = "CORSResponse: CORS is not enabled for this bucket.";
// S3 sends the word "evalution" with this spelling.
const NOT_ALLOWED =
  "CORSResponse: This CORS request is not allowed. This is usually because the evalution of Origin, request method / Access-Control-Request-Method or Access-Control-Request-Headers are not whitelisted by the resource's CORS spec.";

function parseMaxAgeSeconds(text: string): number {
  if (!/^[0-9]+$/.test(text)) throw malformedXml();
  const value = Number(text);
  if (value > MAX_INT32) throw malformedXml();
  return value;
}

/** Reads one `<CORSRule>`. It checks the structure and not the values. */
function parseRule(element: XmlElement): CorsRule {
  if (element.name !== "CORSRule" || element.text.trim() !== "") throw malformedXml();
  const rule: CorsRule = { allowedOrigins: [], allowedMethods: [], allowedHeaders: [], exposeHeaders: [] };
  for (const item of element.children) {
    if (item.children.length > 0) throw malformedXml();
    switch (item.name) {
      case "ID":
        if (rule.id !== undefined || item.text.length > MAX_ID_LENGTH) throw malformedXml();
        rule.id = item.text;
        break;
      case "AllowedOrigin":
        rule.allowedOrigins.push(item.text);
        break;
      case "AllowedMethod":
        rule.allowedMethods.push(item.text);
        break;
      case "AllowedHeader":
        rule.allowedHeaders.push(item.text);
        break;
      case "ExposeHeader":
        rule.exposeHeaders.push(item.text);
        break;
      case "MaxAgeSeconds":
        if (rule.maxAgeSeconds !== undefined) throw malformedXml();
        rule.maxAgeSeconds = parseMaxAgeSeconds(item.text);
        break;
      default:
        throw malformedXml();
    }
  }
  if (rule.allowedOrigins.length === 0 || rule.allowedMethods.length === 0) throw malformedXml();
  return rule;
}

function hasManyWildcards(value: string): boolean {
  return value.indexOf("*") !== value.lastIndexOf("*");
}

function validateRule(rule: CorsRule): void {
  for (const method of rule.allowedMethods) {
    if (!METHODS.includes(method)) {
      throw invalidRequest(`Found unsupported HTTP method in CORS config. Unsupported method is ${method}`);
    }
  }
  for (const origin of rule.allowedOrigins) {
    if (hasManyWildcards(origin)) {
      throw invalidRequest(`AllowedOrigin "${origin}" can not have more than one wildcard.`);
    }
  }
  for (const header of rule.allowedHeaders) {
    if (hasManyWildcards(header)) {
      throw invalidRequest(`AllowedHeader "${header}" can not have more than one wildcard.`);
    }
  }
  for (const header of rule.exposeHeaders) {
    if (header.includes("*")) {
      throw invalidRequest(
        `ExposeHeader "${header}" contains wildcard. We currently do not support wildcard for ExposeHeader.`,
      );
    }
  }
}

/** Parses and validates the body of PutBucketCors. Throws the S3Error that Amazon S3 sends. */
export function parseCorsConfiguration(body: string | Uint8Array): CorsRule[] {
  const root = parseXml(body);
  if (root.name !== "CORSConfiguration" || root.text.trim() !== "") throw malformedXml();
  if (root.children.length === 0 || root.children.length > MAX_RULES) throw malformedXml();
  // The structure of every rule comes before the values of any rule. A
  // document with an error of each kind gets MalformedXML.
  const rules = root.children.map(parseRule);
  for (const rule of rules) validateRule(rule);
  return rules;
}

/** The body of GetBucketCors: a `<CORSConfiguration>` document. */
export function serializeCorsConfiguration(rules: CorsRule[]): string {
  return xmlDocument("CORSConfiguration", {
    CORSRule: rules.map(rule => ({
      ID: rule.id,
      AllowedMethod: rule.allowedMethods,
      AllowedOrigin: rule.allowedOrigins,
      AllowedHeader: rule.allowedHeaders,
      MaxAgeSeconds: rule.maxAgeSeconds,
      ExposeHeader: rule.exposeHeaders,
    })),
  });
}

/** The pattern has one `*` at most. The `*` matches any sequence of characters, also the empty one. */
function matchesPattern(pattern: string, value: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === value;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return value.length >= prefix.length + suffix.length && value.startsWith(prefix) && value.endsWith(suffix);
}

function allowsHeader(rule: CorsRule, header: string): boolean {
  const name = header.trim().toLowerCase();
  return rule.allowedHeaders.some(pattern => matchesPattern(pattern.toLowerCase(), name));
}

/**
 * Finds the first rule that allows the request. `requestHeaders` is the list from
 * Access-Control-Request-Headers of a preflight request. It is `undefined` for an actual request.
 */
export function matchCorsRule(
  rules: CorsRule[],
  origin: string,
  method: string,
  requestHeaders?: string[],
): CorsMatch | undefined {
  for (const rule of rules) {
    if (!rule.allowedMethods.includes(method)) continue;
    if (!rule.allowedOrigins.some(pattern => matchesPattern(pattern, origin))) continue;
    // A rule without AllowedHeader does not match a preflight request that names a header.
    if (requestHeaders?.some(header => !allowsHeader(rule, header))) continue;
    return { rule, allowOrigin: rule.allowedOrigins.includes("*") ? "*" : origin };
  }
  return undefined;
}

function responseHeaders(match: CorsMatch, requestHeaders: string[] | undefined): Record<string, string> {
  const { rule, allowOrigin } = match;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": rule.allowedMethods.join(", "),
  };
  if (requestHeaders !== undefined) headers["Access-Control-Allow-Headers"] = requestHeaders.join(", ");
  if (rule.exposeHeaders.length > 0) headers["Access-Control-Expose-Headers"] = rule.exposeHeaders.join(", ");
  if (rule.maxAgeSeconds !== undefined) headers["Access-Control-Max-Age"] = String(rule.maxAgeSeconds);
  if (allowOrigin !== "*") headers["Access-Control-Allow-Credentials"] = "true";
  headers["Vary"] = VARY;
  return headers;
}

/**
 * The CORS response headers for an actual (not preflight) request that has an Origin header.
 * Returns an empty object when no rule matches or the bucket has no CORS configuration.
 */
export function corsResponseHeaders(
  rules: CorsRule[] | undefined,
  origin: string,
  method: string,
): Record<string, string> {
  if (rules === undefined || origin === "") return {};
  const match = matchCorsRule(rules, origin, method);
  return match ? responseHeaders(match, undefined) : {};
}

/** The names in Access-Control-Request-Headers, in lowercase. `undefined` when the request names no header. */
function parseRequestHeaders(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  const names = value
    .split(",")
    .map(name => name.trim().toLowerCase())
    .filter(name => name !== "");
  return names.length > 0 ? names : undefined;
}

/**
 * Answers a preflight request (HTTP OPTIONS). Returns the response headers of the 200 response.
 * Throws the S3Error that Amazon S3 sends when it refuses the preflight.
 * `resourceType` is "BUCKET" or "OBJECT" and goes into the error document.
 */
export function preflightResponseHeaders(
  rules: CorsRule[] | undefined,
  headers: { get(name: string): string | null },
  resourceType: "BUCKET" | "OBJECT",
): Record<string, string> {
  const origin = headers.get("origin");
  if (origin === null || origin === "") {
    throw new S3Error("BadRequest", { message: "Insufficient information. Origin request header needed." });
  }
  const method = headers.get("access-control-request-method");
  if (method === null || !METHODS.includes(method)) {
    // The message has the text "null" when the request does not have the header.
    throw new S3Error("BadRequest", { message: `Invalid Access-Control-Request-Method: ${method}` });
  }
  const details = { Method: method, ResourceType: resourceType };
  if (rules === undefined) throw new S3Error("AccessForbidden", { message: NOT_ENABLED, details });
  const requestHeaders = parseRequestHeaders(headers.get("access-control-request-headers"));
  const match = matchCorsRule(rules, origin, method, requestHeaders);
  if (!match) throw new S3Error("AccessForbidden", { message: NOT_ALLOWED, details });
  return responseHeaders(match, requestHeaders);
}
