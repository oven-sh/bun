// The bucket policy of Amazon S3: the validation of the document that
// PutBucketPolicy stores, and the evaluation of a request against it.

import { S3Error } from "./errors.ts";
import type { Owner } from "./signature.ts";

export interface PolicyStatement {
  sid?: string;
  effect: "Allow" | "Deny";
  /** Exactly one of principal / notPrincipal is set. */
  principal?: PolicyPrincipal;
  notPrincipal?: PolicyPrincipal;
  /** Exactly one of actions / notActions is set. Values as written in the document. */
  actions?: string[];
  notActions?: string[];
  /** Exactly one of resources / notResources is set. */
  resources?: string[];
  notResources?: string[];
  /** operator -> condition key -> values (always normalized to string arrays). */
  conditions?: Record<string, Record<string, string[]>>;
}

/** `"*"` means everyone, anonymous requests included. */
export type PolicyPrincipal =
  | "*"
  | { aws?: string[]; canonicalUser?: string[]; service?: string[]; federated?: string[] };

export interface BucketPolicy {
  /** The document exactly as the client sent it. GetBucketPolicy returns this text. */
  text: string;
  version?: string;
  id?: string;
  statements: PolicyStatement[];
}

export interface PolicyRequest {
  /** The account that signed the request. `undefined` is an anonymous request. */
  principal: Owner | undefined;
  /** For example "s3:GetObject". */
  action: string;
  /** For example "arn:aws:s3:::my-bucket" or "arn:aws:s3:::my-bucket/photos/cat.jpg". */
  resource: string;
  /** Condition keys of the request. Names are matched case-insensitively. A missing key is `undefined`. */
  context: Record<string, string | string[] | undefined>;
}

type Json = null | boolean | number | string | Json[] | { [name: string]: Json };
type JsonObject = { [name: string]: Json };

/** A bucket policy has a size limit of 20 KB. */
const MAX_POLICY_BYTES = 20480;
const VERSIONS = ["2012-10-17", "2008-10-17"];
const POLICY_ELEMENTS = ["Version", "Id", "Statement"];
const STATEMENT_ELEMENTS = [
  "Sid",
  "Effect",
  "Principal",
  "NotPrincipal",
  "Action",
  "NotAction",
  "Resource",
  "NotResource",
  "Condition",
];
const PRINCIPAL_TYPES = {
  AWS: "aws",
  CanonicalUser: "canonicalUser",
  Service: "service",
  Federated: "federated",
} as const;

const S3_ARN = /^arn:(?:aws|aws-cn|aws-us-gov):s3:::/;
const PRINCIPAL_ARN_PREFIX = /^arn:(?:aws|aws-cn|aws-us-gov):(?:iam|sts)::/;
const PRINCIPAL_ARN = /^arn:(?:aws|aws-cn|aws-us-gov):(iam|sts)::(\d{12}):(.*)$/s;
const ACCOUNT_ID = /^\d{12}$/;
const ACTION = /^s3:[a-z0-9*?]+$/i;

const OPERATORS = [
  "StringEquals",
  "StringNotEquals",
  "StringEqualsIgnoreCase",
  "StringNotEqualsIgnoreCase",
  "StringLike",
  "StringNotLike",
  "NumericEquals",
  "NumericNotEquals",
  "NumericLessThan",
  "NumericLessThanEquals",
  "NumericGreaterThan",
  "NumericGreaterThanEquals",
  "DateEquals",
  "DateNotEquals",
  "DateLessThan",
  "DateLessThanEquals",
  "DateGreaterThan",
  "DateGreaterThanEquals",
  "Bool",
  "BinaryEquals",
  "IpAddress",
  "NotIpAddress",
  "ArnEquals",
  "ArnLike",
  "ArnNotEquals",
  "ArnNotLike",
  "Null",
] as const;
type OperatorName = (typeof OPERATORS)[number];
const OPERATOR_NAMES = new Map<string, OperatorName>(OPERATORS.map(name => [name.toLowerCase(), name]));

function malformed(message?: string): S3Error {
  return new S3Error("MalformedPolicy", { message });
}

function invalidSyntax(): S3Error {
  return malformed("Invalid policy syntax.");
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: Json | undefined): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every(item => typeof item === "string")) return value as string[];
  return undefined;
}

/**
 * Finds the name that an object of the document has two times. `JSON.parse`
 * keeps the last value of such a name. The text must be valid JSON.
 */
function findDuplicateName(text: string): string | undefined {
  // One entry for each open container: the names of an object, `undefined` for an array.
  const open: (Set<string> | undefined)[] = [];
  let isName = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{") {
      open.push(new Set());
      isName = true;
    } else if (char === "[") {
      open.push(undefined);
    } else if (char === "}" || char === "]") {
      open.pop();
      isName = false;
    } else if (char === ",") {
      isName = open.at(-1) !== undefined;
    } else if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const names = open.at(-1);
      if (isName && names) {
        const name: string = JSON.parse(text.slice(i, end + 1));
        if (names.has(name)) return name;
        names.add(name);
        isName = false;
      }
      i = end;
    }
  }
  return undefined;
}

function parseDocument(text: string): JsonObject {
  if (!/^[ \t\r\n]*\{/.test(text)) throw malformed();
  let document: Json;
  try {
    document = JSON.parse(text);
  } catch {
    throw malformed();
  }
  if (!isObject(document)) throw malformed();
  const duplicate = findDuplicateName(text);
  if (duplicate !== undefined) throw malformed(`Statement/policy already has instance of ${duplicate}`);
  return document;
}

/** Parses and validates the body of PutBucketPolicy. Throws S3Error("MalformedPolicy") with the S3 message. */
export function parseBucketPolicy(text: string, bucketName: string): BucketPolicy {
  if (Buffer.byteLength(text, "utf8") > MAX_POLICY_BYTES) {
    throw malformed("Policy exceeds the maximum allowed document size.");
  }
  const document = parseDocument(text);
  for (const name of Object.keys(document)) {
    if (!POLICY_ELEMENTS.includes(name)) throw malformed(`Unknown field ${name}`);
  }

  const policy: BucketPolicy = { text, statements: [] };
  const { Version: version, Id: id, Statement: statement } = document;
  if (version !== undefined) {
    if (typeof version !== "string" || !VERSIONS.includes(version)) {
      throw malformed("The policy must contain a valid version string");
    }
    policy.version = version;
  }
  if (id !== undefined) {
    if (typeof id !== "string") throw invalidSyntax();
    policy.id = id;
  }
  if (statement === undefined) throw malformed("Missing required field Statement");
  const statements = Array.isArray(statement) ? statement : [statement];
  if (statements.length === 0) throw malformed("Could not parse the policy: Statement is empty!");
  policy.statements = statements.map(item => parseStatement(item, bucketName));
  return policy;
}

function parseStatement(value: Json, bucketName: string): PolicyStatement {
  if (!isObject(value)) throw invalidSyntax();
  for (const name of Object.keys(value)) {
    if (!STATEMENT_ELEMENTS.includes(name)) throw malformed(`Unknown field ${name}`);
  }
  for (const name of ["Principal", "Action", "Resource"]) {
    if (value[name] !== undefined && value["Not" + name] !== undefined) {
      throw malformed(`Statement/policy already has instance of ${name}`);
    }
  }

  const { Effect: effect, Sid: sid } = value;
  if (effect === undefined) throw malformed("Missing required field Effect");
  if (effect !== "Allow" && effect !== "Deny") {
    throw malformed(`Invalid effect: ${typeof effect === "string" ? effect : JSON.stringify(effect)}`);
  }
  const statement: PolicyStatement = { effect };
  if (sid !== undefined) {
    if (typeof sid !== "string") throw invalidSyntax();
    statement.sid = sid;
  }

  if (value.Principal !== undefined) statement.principal = parsePrincipal(value.Principal);
  else if (value.NotPrincipal !== undefined) statement.notPrincipal = parsePrincipal(value.NotPrincipal);
  else throw malformed("Missing required field Principal");

  const isAction = (action: string) => action === "*" || ACTION.test(action);
  if (value.Action !== undefined) {
    statement.actions = parseList(value.Action, "Action", "Policy has invalid action", isAction);
  } else if (value.NotAction !== undefined) {
    statement.notActions = parseList(value.NotAction, "Action", "Policy has invalid action", isAction);
  } else {
    throw malformed("Missing required field Action");
  }

  const isResource = (resource: string) => isResourceOfBucket(resource, bucketName);
  if (value.Resource !== undefined) {
    statement.resources = parseList(value.Resource, "Resource", "Policy has invalid resource", isResource);
  } else if (value.NotResource !== undefined) {
    statement.notResources = parseList(value.NotResource, "Resource", "Policy has invalid resource", isResource);
  } else {
    throw malformed("Missing required field Resource");
  }

  if (value.Condition !== undefined) statement.conditions = parseConditions(value.Condition);
  checkActionsApply(statement);
  return statement;
}

function parseList(value: Json, element: string, invalid: string, isValid: (item: string) => boolean): string[] {
  const items = stringList(value);
  if (!items) throw invalidSyntax();
  if (items.length === 0) throw malformed(`Missing required field ${element} cannot be empty!`);
  if (!items.every(isValid)) throw malformed(invalid);
  return items;
}

// A bucket policy names only its own bucket and the objects in it.
function isResourceOfBucket(resource: string, bucketName: string): boolean {
  const match = S3_ARN.exec(resource);
  if (!match) return false;
  const path = resource.slice(match[0].length);
  return path === bucketName || path.startsWith(bucketName + "/");
}

function parsePrincipal(value: Json): PolicyPrincipal {
  if (value === "*") return "*";
  if (!isObject(value)) throw malformed("Invalid principal in policy");
  const principal: Exclude<PolicyPrincipal, "*"> = {};
  const types = Object.keys(value);
  for (const type of types) {
    const values = stringList(value[type]);
    if (!Object.hasOwn(PRINCIPAL_TYPES, type) || !values || values.length === 0) {
      throw malformed("Invalid principal in policy");
    }
    if (type === "AWS" && !values.every(isAwsPrincipal)) throw malformed("Invalid principal in policy");
    principal[PRINCIPAL_TYPES[type as keyof typeof PRINCIPAL_TYPES]] = values;
  }
  if (types.length === 0) throw malformed("Invalid principal in policy");
  return principal;
}

function isAwsPrincipal(value: string): boolean {
  return value === "*" || ACCOUNT_ID.test(value) || PRINCIPAL_ARN_PREFIX.test(value);
}

interface Operator {
  /** The name without the qualifier and without `IfExists`. */
  name: OperatorName;
  qualifier?: "ForAllValues" | "ForAnyValue";
  ifExists: boolean;
}

function parseOperator(text: string): Operator | undefined {
  const colon = text.indexOf(":");
  const prefix = text.slice(0, colon + 1).toLowerCase();
  let qualifier: Operator["qualifier"];
  if (prefix === "forallvalues:") qualifier = "ForAllValues";
  else if (prefix === "foranyvalue:") qualifier = "ForAnyValue";
  else if (prefix !== "") return undefined;

  let lower = text.slice(colon + 1).toLowerCase();
  const ifExists = !OPERATOR_NAMES.has(lower) && lower.endsWith("ifexists");
  if (ifExists) lower = lower.slice(0, -"ifexists".length);
  const name = OPERATOR_NAMES.get(lower);
  // IAM does not accept `IfExists` on `Null`.
  if (name === undefined || (name === "Null" && ifExists)) return undefined;
  return { name, qualifier, ifExists };
}

function parseConditions(value: Json): Record<string, Record<string, string[]>> {
  if (!isObject(value)) throw invalidSyntax();
  const blocks = Object.entries(value).map(([operator, keys]) => {
    if (!parseOperator(operator)) throw malformed(`Invalid Condition type : ${operator}`);
    if (!isObject(keys)) throw invalidSyntax();
    const entries = Object.entries(keys).map(([key, values]) => [key, conditionValues(values)] as const);
    return [operator, Object.fromEntries(entries)] as const;
  });
  return Object.fromEntries(blocks);
}

function conditionValues(value: Json): string[] {
  return (Array.isArray(value) ? value : [value]).map(item => {
    if (typeof item === "string") return item;
    if (typeof item === "number" || typeof item === "boolean") return String(item);
    throw invalidSyntax();
  });
}

const OBJECT_ACTIONS = `AbortMultipartUpload BypassGovernanceRetention DeleteObject DeleteObjectTagging
  DeleteObjectVersion DeleteObjectVersionTagging GetObject GetObjectAcl GetObjectAttributes GetObjectLegalHold
  GetObjectRetention GetObjectTagging GetObjectTorrent GetObjectVersion GetObjectVersionAcl
  GetObjectVersionAttributes GetObjectVersionForReplication GetObjectVersionTagging GetObjectVersionTorrent
  InitiateReplication ListMultipartUploadParts ObjectOwnerOverrideToBucketOwner PutObject PutObjectAcl
  PutObjectLegalHold PutObjectRetention PutObjectTagging PutObjectVersionAcl PutObjectVersionTagging
  ReplicateDelete ReplicateObject ReplicateTags RestoreObject`;

const BUCKET_ACTIONS = `CreateBucket DeleteBucket DeleteBucketPolicy DeleteBucketWebsite GetAccelerateConfiguration
  GetAnalyticsConfiguration GetBucketAcl GetBucketCORS GetBucketLocation GetBucketLogging GetBucketNotification
  GetBucketObjectLockConfiguration GetBucketOwnershipControls GetBucketPolicy GetBucketPolicyStatus
  GetBucketPublicAccessBlock GetBucketRequestPayment GetBucketTagging GetBucketVersioning GetBucketWebsite
  GetEncryptionConfiguration GetIntelligentTieringConfiguration GetInventoryConfiguration
  GetLifecycleConfiguration GetMetricsConfiguration GetReplicationConfiguration ListBucket
  ListBucketMultipartUploads ListBucketVersions PutAccelerateConfiguration PutAnalyticsConfiguration
  PutBucketAcl PutBucketCORS PutBucketLogging PutBucketNotification PutBucketObjectLockConfiguration
  PutBucketOwnershipControls PutBucketPolicy PutBucketPublicAccessBlock PutBucketRequestPayment
  PutBucketTagging PutBucketVersioning PutBucketWebsite PutEncryptionConfiguration
  PutIntelligentTieringConfiguration PutInventoryConfiguration PutLifecycleConfiguration
  PutMetricsConfiguration PutReplicationConfiguration`;

const ACTION_KINDS = new Map<string, "bucket" | "object">([
  ...OBJECT_ACTIONS.split(/\s+/).map(name => ["s3:" + name.toLowerCase(), "object"] as const),
  ...BUCKET_ACTIONS.split(/\s+/).map(name => ["s3:" + name.toLowerCase(), "bucket"] as const),
]);

// S3 refuses a statement with an action that applies to none of its resources,
// for example s3:ListBucket with only object ARNs. An action that is not in the
// table applies to every resource.
function checkActionsApply(statement: PolicyStatement): void {
  const { actions, resources } = statement;
  if (!actions || !resources) return;
  const kinds = new Set(resources.map(resource => (resource.includes("/") ? "object" : "bucket")));
  for (const action of actions) {
    const pattern = action.toLowerCase();
    let known = false;
    let applies = false;
    for (const [name, kind] of ACTION_KINDS) {
      if (!wildcardMatch(pattern, name, false)) continue;
      known = true;
      applies ||= kinds.has(kind);
    }
    if (known && !applies) throw malformed("Action does not apply to any resource(s) in statement");
  }
}

const ANY = Symbol("*");
const ONE = Symbol("?");
type Token = string | typeof ANY | typeof ONE;

/** `variables` makes `${*}`, `${?}` and `${$}` the literal characters `*`, `?` and `$`. */
function tokenize(pattern: string, variables: boolean): Token[] {
  const chars = Array.from(pattern);
  const tokens: Token[] = [];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const escaped = chars[i + 2];
    if (
      variables &&
      char === "$" &&
      chars[i + 1] === "{" &&
      chars[i + 3] === "}" &&
      (escaped === "*" || escaped === "?" || escaped === "$")
    ) {
      tokens.push(escaped);
      i += 3;
    } else {
      tokens.push(char === "*" ? ANY : char === "?" ? ONE : char);
    }
  }
  return tokens;
}

/** Matches a text against a pattern in which `*` is any sequence and `?` is one character. */
function wildcardMatch(pattern: string, text: string, variables: boolean): boolean {
  const tokens = tokenize(pattern, variables);
  const chars = Array.from(text);
  let token = 0;
  let char = 0;
  let lastAny = -1;
  let retry = 0;
  while (char < chars.length) {
    if (token < tokens.length && (tokens[token] === ONE || tokens[token] === chars[char])) {
      token++;
      char++;
    } else if (token < tokens.length && tokens[token] === ANY) {
      lastAny = token++;
      retry = char;
    } else if (lastAny !== -1) {
      token = lastAny + 1;
      char = ++retry;
    } else {
      return false;
    }
  }
  while (tokens[token] === ANY) token++;
  return token === tokens.length;
}

/** The text with `${*}`, `${?}` and `${$}` as the characters that they stand for. */
function literal(value: string): string {
  return value.replace(/\$\{([*?$])\}/g, "$1");
}

function awsPrincipalMatches(value: string, requester: Owner | undefined): boolean {
  if (value === "*") return true;
  if (requester?.accountId === undefined) return false;
  if (ACCOUNT_ID.test(value)) return value === requester.accountId;
  const match = PRINCIPAL_ARN.exec(value);
  if (!match) return false;
  const [, service, account, name] = match;
  // The server has no IAM users and no roles. The account is the identity.
  const isIdentity =
    service === "iam"
      ? name === "root" || /^(?:user|role)\/./s.test(name)
      : /^(?:assumed-role|federated-user)\/./s.test(name);
  return isIdentity && account === requester.accountId;
}

function principalMatches(principal: PolicyPrincipal, requester: Owner | undefined): boolean {
  if (principal === "*") return true;
  if (principal.aws?.some(value => awsPrincipalMatches(value, requester))) return true;
  return requester !== undefined && (principal.canonicalUser ?? []).includes(requester.id);
}

function actionMatches(patterns: string[], action: string): boolean {
  const lower = action.toLowerCase();
  return patterns.some(pattern => wildcardMatch(pattern.toLowerCase(), lower, false));
}

function resourceMatches(patterns: string[], resource: string): boolean {
  // The partition of the ARN does not identify the bucket.
  const text = resource.replace(S3_ARN, "arn:aws:s3:::");
  return patterns.some(pattern => wildcardMatch(pattern.replace(S3_ARN, "arn:aws:s3:::"), text, true));
}

function statementMatches(statement: PolicyStatement, request: PolicyRequest, context: Context): boolean {
  const { principal, notPrincipal, actions, notActions, resources, notResources, conditions } = statement;
  if (principal !== undefined && !principalMatches(principal, request.principal)) return false;
  if (notPrincipal !== undefined && principalMatches(notPrincipal, request.principal)) return false;
  if (actions !== undefined && !actionMatches(actions, request.action)) return false;
  if (notActions !== undefined && actionMatches(notActions, request.action)) return false;
  if (resources !== undefined && !resourceMatches(resources, request.resource)) return false;
  if (notResources !== undefined && resourceMatches(notResources, request.resource)) return false;
  return conditions === undefined || conditionsHold(conditions, context);
}

/**
 * "Deny" when a Deny statement matches (explicit deny wins).
 * Else "Allow" when an Allow statement matches. Else `undefined` (the policy says nothing).
 */
export function evaluateBucketPolicy(policy: BucketPolicy, request: PolicyRequest): "Allow" | "Deny" | undefined {
  const context: Context = new Map();
  for (const [name, value] of Object.entries(request.context)) {
    if (value === undefined) continue;
    const values = (Array.isArray(value) ? value : [value]).map(String);
    const key = name.toLowerCase();
    context.set(key, [...(context.get(key) ?? []), ...values]);
  }

  let result: "Allow" | undefined;
  for (const statement of policy.statements) {
    if (!statementMatches(statement, request, context)) continue;
    if (statement.effect === "Deny") return "Deny";
    result = "Allow";
  }
  return result;
}

/** The condition keys of a request. The names are lowercase. */
type Context = Map<string, string[]>;

function parseNumber(text: string): number | undefined {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : undefined;
}

const ISO_DATE = /^(\d{4})-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?)?$/i;

/** The instant in milliseconds of an ISO 8601 date or of a number of seconds since the epoch. */
function parseDate(text: string): number | undefined {
  const seconds = parseNumber(text);
  if (seconds !== undefined) return seconds * 1000;
  const match = ISO_DATE.exec(text);
  if (!match) return undefined;
  const fields = match.slice(1, 7).map(part => (part === undefined ? undefined : Number(part)));
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = fields;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const isReal =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  if (!isReal) return undefined;

  // A time without a zone is in UTC.
  const zone = /^([+-])(\d{2}):?(\d{2})?$/.exec(match[8] ?? "");
  const offset = zone ? (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3] ?? 0)) : 0;
  return date.getTime() + Number(match[7] ?? 0) * 1000 - offset * 60_000;
}

type Comparison = (value: string, expected: string) => boolean;

function ordered(parse: (text: string) => number | undefined, holds: (difference: number) => boolean): Comparison {
  return (value, expected) => {
    const left = parse(value);
    const right = parse(expected);
    return left !== undefined && right !== undefined && holds(left - right);
  };
}

const stringEquals: Comparison = (value, expected) => value === literal(expected);
const stringEqualsIgnoreCase: Comparison = (value, expected) => value.toLowerCase() === literal(expected).toLowerCase();
const stringLike: Comparison = (value, expected) => wildcardMatch(expected, value, true);
const numericEquals = ordered(parseNumber, difference => difference === 0);
const dateEquals = ordered(parseDate, difference => difference === 0);

// IAM compares each of the 6 parts of an ARN on its own. A wildcard does not
// go across a colon, except in the last part. ArnEquals and ArnLike are the same.
const arnLike: Comparison = (value, expected) => {
  const patterns = splitArn(expected);
  const parts = splitArn(value);
  if (patterns.length !== parts.length) return false;
  return patterns.every((pattern, index) => wildcardMatch(pattern, parts[index], true));
};

function splitArn(arn: string): string[] {
  const parts = arn.split(":");
  return parts.length <= 6 ? parts : [...parts.slice(0, 5), parts.slice(5).join(":")];
}

const COMPARISONS: Record<Exclude<OperatorName, "Null">, { negated?: true; matches: Comparison }> = {
  StringEquals: { matches: stringEquals },
  StringNotEquals: { negated: true, matches: stringEquals },
  StringEqualsIgnoreCase: { matches: stringEqualsIgnoreCase },
  StringNotEqualsIgnoreCase: { negated: true, matches: stringEqualsIgnoreCase },
  StringLike: { matches: stringLike },
  StringNotLike: { negated: true, matches: stringLike },
  NumericEquals: { matches: numericEquals },
  NumericNotEquals: { negated: true, matches: numericEquals },
  NumericLessThan: { matches: ordered(parseNumber, difference => difference < 0) },
  NumericLessThanEquals: { matches: ordered(parseNumber, difference => difference <= 0) },
  NumericGreaterThan: { matches: ordered(parseNumber, difference => difference > 0) },
  NumericGreaterThanEquals: { matches: ordered(parseNumber, difference => difference >= 0) },
  DateEquals: { matches: dateEquals },
  DateNotEquals: { negated: true, matches: dateEquals },
  DateLessThan: { matches: ordered(parseDate, difference => difference < 0) },
  DateLessThanEquals: { matches: ordered(parseDate, difference => difference <= 0) },
  DateGreaterThan: { matches: ordered(parseDate, difference => difference > 0) },
  DateGreaterThanEquals: { matches: ordered(parseDate, difference => difference >= 0) },
  Bool: { matches: (value, expected) => value.toLowerCase() === expected.toLowerCase() },
  BinaryEquals: { matches: (value, expected) => Buffer.from(value, "base64").equals(Buffer.from(expected, "base64")) },
  IpAddress: { matches: ipAddressMatches },
  NotIpAddress: { negated: true, matches: ipAddressMatches },
  ArnEquals: { matches: arnLike },
  ArnLike: { matches: arnLike },
  ArnNotEquals: { negated: true, matches: arnLike },
  ArnNotLike: { negated: true, matches: arnLike },
};

function parseIPv4(text: string): number[] | undefined {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) {
    return undefined;
  }
  return parts.map(Number);
}

function parseIPv6(text: string): number[] | undefined {
  let address = text.split("%", 1)[0];
  let tail: number[] | undefined;
  if (address.includes(".")) {
    // The last 32 bits can have the form of an IPv4 address.
    const colon = address.lastIndexOf(":");
    tail = parseIPv4(address.slice(colon + 1));
    if (!tail || colon === -1) return undefined;
    address = address.slice(0, colon + 1) + "0:0";
  }

  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const [head, rest] = halves.map(half => (half === "" ? [] : half.split(":")));
  const groups = [...head, ...(rest ?? [])];
  if (!groups.every(group => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  if (rest === undefined ? groups.length !== 8 : groups.length > 7) return undefined;

  const zeros = new Array<string>(8 - groups.length).fill("0");
  const bytes = [...head, ...zeros, ...(rest ?? [])].flatMap(group => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
  if (tail) bytes.splice(12, 4, ...tail);
  return bytes;
}

interface Network {
  address: number[];
  prefix: number;
}

/** Parses an address or a CIDR block. An address alone is a network of one address. */
function parseNetwork(text: string): Network | undefined {
  const [host, length, ...more] = text.trim().split("/");
  const address = host.includes(":") ? parseIPv6(host) : parseIPv4(host);
  if (!address || more.length > 0) return undefined;
  const bits = address.length * 8;
  if (length === undefined) return { address, prefix: bits };
  if (!/^\d{1,3}$/.test(length) || Number(length) > bits) return undefined;
  return { address, prefix: Number(length) };
}

function ipAddressMatches(value: string, expected: string): boolean {
  const network = parseNetwork(expected);
  let address = value.includes("/") ? undefined : parseNetwork(value)?.address;
  if (!network || !address) return false;
  // A socket for IPv4 and IPv6 reports an IPv4 client as ::ffff:a.b.c.d.
  const isMapped = address.length === 16 && address.every((byte, i) => i >= 12 || byte === (i < 10 ? 0 : 0xff));
  if (isMapped && network.address.length === 4) address = address.slice(12);
  if (address.length !== network.address.length) return false;

  for (let bit = 0; bit < network.prefix; bit += 8) {
    const mask = 0xff & (0xff << Math.max(0, bit + 8 - network.prefix));
    if ((address[bit / 8] & mask) !== (network.address[bit / 8] & mask)) return false;
  }
  return true;
}

function conditionHolds(operator: Operator, expected: string[], values: string[] | undefined): boolean {
  const isMissing = values === undefined || values.length === 0;
  if (operator.name === "Null") {
    return expected.some(value => (value.toLowerCase() === "true") === isMissing);
  }
  const { negated, matches } = COMPARISONS[operator.name];
  if (isMissing) {
    if (operator.ifExists || operator.qualifier === "ForAllValues") return true;
    return negated === true && operator.qualifier === undefined;
  }

  const holds = (value: string) =>
    negated
      ? expected.every(candidate => !matches(value, candidate))
      : expected.some(candidate => matches(value, candidate));
  if (operator.qualifier === "ForAllValues") return values.every(holds);
  if (operator.qualifier === "ForAnyValue") return values.some(holds);
  return negated ? values.every(holds) : values.some(holds);
}

function conditionsHold(conditions: Record<string, Record<string, string[]>>, context: Context): boolean {
  for (const [name, keys] of Object.entries(conditions)) {
    const operator = parseOperator(name);
    if (!operator) return false;
    for (const [key, expected] of Object.entries(keys)) {
      if (!conditionHolds(operator, expected, context.get(key.toLowerCase()))) return false;
    }
  }
  return true;
}

/** The condition keys that make a statement for everyone not public when they have fixed values. */
const FIXED_VALUE_KEYS = new Set(
  [
    "aws:SourceIp",
    "aws:SourceArn",
    "aws:SourceVpc",
    "aws:SourceVpce",
    "aws:SourceOwner",
    "aws:SourceAccount",
    "aws:userid",
    "aws:PrincipalOrgID",
    "aws:PrincipalArn",
    "aws:PrincipalAccount",
    "s3:x-amz-server-side-encryption-aws-kms-key-id",
    "s3:DataAccessPointArn",
    "s3:DataAccessPointAccount",
  ].map(key => key.toLowerCase()),
);

/** The operators that hold only when the request value is one of the listed values. */
const LIMITING_OPERATORS: readonly OperatorName[] = [
  "StringEquals",
  "StringEqualsIgnoreCase",
  "StringLike",
  "ArnEquals",
  "ArnLike",
  "IpAddress",
];

function hasWildcard(value: string): boolean {
  return /[*?]|\$\{/.test(value);
}

function isFixedValue(key: string, value: string): boolean {
  if (key === "s3:dataaccesspointarn") {
    // The name of the access point can be a wildcard when the account is fixed.
    const [partition, service, region, account] = value.split(":").slice(1);
    if (ACCOUNT_ID.test(account ?? "") && ![partition, service, region].some(hasWildcard)) return true;
  }
  if (hasWildcard(value)) return false;
  // S3 takes a block that is larger than /8 for IPv4 or /32 for IPv6 as the full internet.
  const network = key === "aws:sourceip" ? parseNetwork(value) : undefined;
  return network === undefined || network.prefix >= (network.address.length === 4 ? 8 : 32);
}

function limitsToFixedValues(conditions: PolicyStatement["conditions"]): boolean {
  for (const [name, keys] of Object.entries(conditions ?? {})) {
    const operator = parseOperator(name);
    // A condition that holds for a request without the key does not limit the statement.
    if (!operator || operator.ifExists || operator.qualifier === "ForAllValues") continue;
    if (!LIMITING_OPERATORS.includes(operator.name)) continue;
    for (const [name, values] of Object.entries(keys)) {
      const key = name.toLowerCase();
      if (FIXED_VALUE_KEYS.has(key) && values.every(value => isFixedValue(key, value))) return true;
    }
  }
  return false;
}

function isForEveryone(statement: PolicyStatement): boolean {
  const { principal, notPrincipal } = statement;
  if (principal !== undefined) return principal === "*" || principal.aws?.includes("*") === true;
  // NotPrincipal applies to all principals but the listed ones. This includes anonymous requests.
  return notPrincipal !== "*" && notPrincipal?.aws?.includes("*") !== true;
}

/** What GetBucketPolicyStatus reports as IsPublic. */
export function isPublicPolicy(policy: BucketPolicy): boolean {
  return policy.statements.some(
    statement => statement.effect === "Allow" && isForEveryone(statement) && !limitsToFixedValues(statement.conditions),
  );
}
