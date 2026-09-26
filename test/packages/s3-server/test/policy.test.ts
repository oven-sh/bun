import { describe, expect, test } from "bun:test";
import { S3Error } from "../src/errors.ts";
import {
  evaluateBucketPolicy,
  isPublicPolicy,
  parseBucketPolicy,
  type BucketPolicy,
  type PolicyPrincipal,
  type PolicyRequest,
} from "../src/policy.ts";
import type { Owner } from "../src/signature.ts";

type Document = Record<string, unknown>;

const ARN = "arn:aws:s3:::b";
const OBJECTS = ARN + "/*";
const NOT_JSON = "Policies must be valid JSON and the first byte must be '{'";
const INVALID_PRINCIPAL = "Invalid principal in policy";
const INVALID_ACTION = "Policy has invalid action";
const INVALID_RESOURCE = "Policy has invalid resource";
const INVALID_SYNTAX = "Invalid policy syntax.";

const alice: Owner = { id: Buffer.alloc(64, "a").toString(), displayName: "alice", accountId: "111122223333" };
const bob: Owner = { id: Buffer.alloc(64, "b").toString(), displayName: "bob", accountId: "444455556666" };
/** An owner that the server made without an account ID. */
const carol: Owner = { id: Buffer.alloc(64, "c").toString(), displayName: "carol" };

/** A valid statement. A value of `undefined` removes the element. */
function statement(elements: Document = {}): Document {
  return { Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: OBJECTS, ...elements };
}

function policy(...statements: Document[]): BucketPolicy {
  return parseBucketPolicy(JSON.stringify({ Version: "2012-10-17", Statement: statements }), "b");
}

function request(parts: Partial<PolicyRequest> = {}): PolicyRequest {
  return { principal: undefined, action: "s3:GetObject", resource: ARN + "/a/b.txt", context: {}, ...parts };
}

/** The decision for a request on a policy that has one statement with this condition. */
function decide(condition: Document, context: PolicyRequest["context"]): "Allow" | "Deny" | undefined {
  return evaluateBucketPolicy(policy(statement({ Condition: condition })), request({ context }));
}

/** The error that the parser throws for the document, or `undefined` when it accepts the document. */
function failure(document: string | Document, bucket = "b"): unknown {
  const text = typeof document === "string" ? document : JSON.stringify(document);
  try {
    parseBucketPolicy(text, bucket);
  } catch (error) {
    if (!(error instanceof S3Error)) throw error;
    return { code: error.code, status: error.status, message: error.message };
  }
  return undefined;
}

function malformed(message: string) {
  return { code: "MalformedPolicy", status: 400, message };
}

describe("parseBucketPolicy", () => {
  test("keeps the text and reads every element", () => {
    const text = `\n\t {
      "Version": "2012-10-17",
      "Id": "policy-1",
      "Statement": [
        {
          "Sid": "read",
          "Effect": "Allow",
          "Principal": { "AWS": ["111122223333", "arn:aws:iam::444455556666:root"], "CanonicalUser": "abc" },
          "Action": ["s3:GetObject", "s3:getobjectversion"],
          "Resource": ["arn:aws:s3:::b/*", "arn:aws:s3:::b"],
          "Condition": {
            "StringEquals": { "s3:prefix": ["a/", "b/"], "aws:username": "alice" },
            "ForAnyValue:StringLikeIfExists": { "aws:TagKeys": "team-*" }
          }
        },
        {
          "Effect": "Deny",
          "NotPrincipal": { "Service": "cloudfront.amazonaws.com", "Federated": ["cognito-identity.amazonaws.com"] },
          "NotAction": "s3:List*",
          "NotResource": "arn:aws:s3:::b/public/*"
        }
      ]
    }\n`;
    expect(parseBucketPolicy(text, "b")).toEqual({
      text,
      version: "2012-10-17",
      id: "policy-1",
      statements: [
        {
          sid: "read",
          effect: "Allow",
          principal: { aws: ["111122223333", "arn:aws:iam::444455556666:root"], canonicalUser: ["abc"] },
          actions: ["s3:GetObject", "s3:getobjectversion"],
          resources: ["arn:aws:s3:::b/*", "arn:aws:s3:::b"],
          conditions: {
            "StringEquals": { "s3:prefix": ["a/", "b/"], "aws:username": ["alice"] },
            "ForAnyValue:StringLikeIfExists": { "aws:TagKeys": ["team-*"] },
          },
        },
        {
          effect: "Deny",
          notPrincipal: { service: ["cloudfront.amazonaws.com"], federated: ["cognito-identity.amazonaws.com"] },
          notActions: ["s3:List*"],
          notResources: ["arn:aws:s3:::b/public/*"],
        },
      ],
    });
  });

  test("accepts one statement that is not in an array, without Version", () => {
    const text = JSON.stringify({ Statement: statement() });
    const parsed = parseBucketPolicy(text, "b");
    expect(parsed).toEqual({
      text,
      statements: [{ effect: "Allow", principal: "*", actions: ["s3:GetObject"], resources: [OBJECTS] }],
    });
    expect(Object.keys(parsed).sort()).toEqual(["statements", "text"]);
  });

  test.each(["2012-10-17", "2008-10-17"])("accepts the version %s", version => {
    const parsed = parseBucketPolicy(JSON.stringify({ Version: version, Statement: [statement()] }), "b");
    expect(parsed.version).toBe(version);
  });

  test("changes condition values that are numbers and booleans to strings", () => {
    const parsed = policy(
      statement({
        Condition: {
          NumericLessThanEquals: { "s3:max-keys": 10, "s3:signatureAge": [600000, "700000", 1.5] },
          Bool: { "aws:SecureTransport": true, "aws:MultiFactorAuthPresent": [false, "true"] },
          StringEquals: {},
        },
      }),
    );
    expect(parsed.statements[0].conditions).toEqual({
      NumericLessThanEquals: { "s3:max-keys": ["10"], "s3:signatureAge": ["600000", "700000", "1.5"] },
      Bool: { "aws:SecureTransport": ["true"], "aws:MultiFactorAuthPresent": ["false", "true"] },
      StringEquals: {},
    });
  });

  test.each<[string, unknown, PolicyPrincipal]>([
    ["the string *", "*", "*"],
    ["AWS *", { AWS: "*" }, { aws: ["*"] }],
    ["AWS * in an array", { AWS: ["*"] }, { aws: ["*"] }],
    ["an account ID", { AWS: "111122223333" }, { aws: ["111122223333"] }],
    ["the root of an account", { AWS: "arn:aws:iam::111122223333:root" }, { aws: ["arn:aws:iam::111122223333:root"] }],
    ["a user", { AWS: ["arn:aws:iam::111122223333:user/a/b"] }, { aws: ["arn:aws:iam::111122223333:user/a/b"] }],
    [
      "a session of a role",
      { AWS: "arn:aws:sts::111122223333:assumed-role/r/s" },
      { aws: ["arn:aws:sts::111122223333:assumed-role/r/s"] },
    ],
    ["another partition", { AWS: "arn:aws-cn:iam::111122223333:root" }, { aws: ["arn:aws-cn:iam::111122223333:root"] }],
    ["a canonical user", { CanonicalUser: alice.id }, { canonicalUser: [alice.id] }],
    ["a service", { Service: ["s3.amazonaws.com"] }, { service: ["s3.amazonaws.com"] }],
    ["a federated provider", { Federated: "accounts.google.com" }, { federated: ["accounts.google.com"] }],
  ])("accepts the principal %s", (_, principal, expected) => {
    expect(policy(statement({ Principal: principal })).statements[0].principal).toEqual(expected);
    const inverse = policy(statement({ Principal: undefined, NotPrincipal: principal })).statements[0];
    expect(inverse).toEqual({
      effect: "Allow",
      notPrincipal: expected,
      actions: ["s3:GetObject"],
      resources: [OBJECTS],
    });
  });

  test.each([
    "arn:aws:s3:::b",
    "arn:aws:s3:::b/*",
    "arn:aws:s3:::b/photos/cat.jpg",
    "arn:aws:s3:::b/a b/${aws:username}/?*",
    "arn:aws:s3:::b/",
    "arn:aws-cn:s3:::b/*",
    "arn:aws-us-gov:s3:::b",
  ])("accepts the resource %s", resource => {
    expect(policy(statement({ Action: "s3:*", Resource: resource })).statements[0].resources).toEqual([resource]);
    expect(policy(statement({ Resource: undefined, NotResource: [resource] })).statements[0].notResources).toEqual([
      resource,
    ]);
  });

  test.each([
    "*",
    "s3:*",
    "S3:GetObject",
    "s3:getobject",
    "s3:Get*",
    "s3:?etObject",
    "s3:Get*Tagging",
    "s3:NotARealAction1",
  ])("accepts the action %s", action => {
    const resources = [ARN, OBJECTS];
    expect(policy(statement({ Action: action, Resource: resources })).statements[0].actions).toEqual([action]);
    expect(policy(statement({ Action: undefined, NotAction: [action] })).statements[0].notActions).toEqual([action]);
  });

  test.each([
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
  ])("accepts the operator %s with a qualifier and with IfExists", operator => {
    const names = [operator, operator + "IfExists", "ForAllValues:" + operator, "ForAnyValue:" + operator + "IfExists"];
    const condition = Object.fromEntries(names.map(name => [name, { "aws:key": "1" }]));
    const expected = Object.fromEntries(names.map(name => [name, { "aws:key": ["1"] }]));
    expect(policy(statement({ Condition: condition })).statements[0].conditions).toEqual(expected);
  });

  test("accepts the operator Null", () => {
    const condition = { Null: { "aws:TokenIssueTime": "true" } };
    expect(policy(statement({ Condition: condition })).statements[0].conditions).toEqual({
      Null: { "aws:TokenIssueTime": ["true"] },
    });
  });

  test("accepts a document of exactly 20480 bytes", () => {
    const text = JSON.stringify({ Statement: [statement()] });
    const padded = text + Buffer.alloc(20480 - text.length, " ").toString();
    expect(Buffer.byteLength(padded)).toBe(20480);
    expect(parseBucketPolicy(padded, "b").text).toBe(padded);
  });

  test.each([
    ["an empty text", ""],
    ["only white space", " \n"],
    ["an array", `[{"Effect":"Allow"}]`],
    ["a string", `"policy"`],
    ["a byte before the object", `x{"Statement":[]}`],
    ["a byte order mark", `\uFEFF{"Statement":[]}`],
    ["an object that does not end", `{"Statement":[`],
    ["text after the object", `{"Statement":[]} x`],
    ["a name without quotes", `{Statement:[]}`],
    ["a comma after the last element", `{"Version":"2012-10-17",}`],
  ])("refuses %s as not JSON", (_, text) => {
    expect(failure(text)).toEqual(malformed(NOT_JSON));
  });

  test("refuses a document of more than 20480 bytes", () => {
    const text = JSON.stringify({ Statement: [statement()] });
    const message = "Policy exceeds the maximum allowed document size.";
    expect(failure(text + Buffer.alloc(20481 - text.length, " ").toString())).toEqual(malformed(message));
    // The limit counts the bytes of the UTF-8 form. Each of these characters has 2 bytes.
    const sid = Buffer.alloc(20400, "é").toString();
    expect(sid.length).toBe(10200);
    expect(failure({ Statement: [statement({ Sid: sid })] })).toEqual(malformed(message));
    expect(failure("not JSON" + Buffer.alloc(20480, "x").toString())).toEqual(malformed(message));
  });

  const valid = statement();
  test.each<[string, Document, string]>([
    [
      "a version that S3 does not know",
      { Version: "2012-10-18", Statement: [valid] },
      "The policy must contain a valid version string",
    ],
    ["an empty version", { Version: "", Statement: [valid] }, "The policy must contain a valid version string"],
    [
      "a version that is a number",
      { Version: 2012, Statement: [valid] },
      "The policy must contain a valid version string",
    ],
    ["a version that is null", { Version: null, Statement: [valid] }, "The policy must contain a valid version string"],
    ["no statement", { Version: "2012-10-17" }, "Missing required field Statement"],
    ["an empty object", {}, "Missing required field Statement"],
    ["an empty list of statements", { Statement: [] }, "Could not parse the policy: Statement is empty!"],
    ["a statement that is a string", { Statement: "Allow" }, INVALID_SYNTAX],
    ["a statement that is null", { Statement: [null] }, INVALID_SYNTAX],
    ["a statement that is an array", { Statement: [[valid]] }, INVALID_SYNTAX],
    ["an ID that is a number", { Id: 1, Statement: [valid] }, INVALID_SYNTAX],
    ["an unknown element of the policy", { Statement: [valid], Foo: 1 }, "Unknown field Foo"],
    ["the element version in lowercase", { version: "2012-10-17", Statement: [valid] }, "Unknown field version"],
    ["the element statement in lowercase", { statement: [valid] }, "Unknown field statement"],
  ])("refuses %s", (_, document, message) => {
    expect(failure(document)).toEqual(malformed(message));
  });

  test.each<[string, Document, string]>([
    ["an unknown element", { Foo: "bar" }, "Unknown field Foo"],
    ["the element effect in lowercase", { Effect: undefined, effect: "Allow" }, "Unknown field effect"],
    ["the element principal in lowercase", { Principal: undefined, principal: "*" }, "Unknown field principal"],
    ["the element action in lowercase", { Action: undefined, action: "s3:GetObject" }, "Unknown field action"],
    ["the element resource in lowercase", { Resource: undefined, resource: OBJECTS }, "Unknown field resource"],
    ["the element condition in lowercase", { condition: {} }, "Unknown field condition"],
    ["the element sid in lowercase", { sid: "a" }, "Unknown field sid"],
    [
      "the element NotPrincipal with other capitals",
      { Principal: undefined, Notprincipal: "*" },
      "Unknown field Notprincipal",
    ],
    ["no effect", { Effect: undefined }, "Missing required field Effect"],
    ["the effect allow", { Effect: "allow" }, "Invalid effect: allow"],
    ["the effect DENY", { Effect: "DENY" }, "Invalid effect: DENY"],
    ["an empty effect", { Effect: "" }, "Invalid effect: "],
    ["an effect that is a boolean", { Effect: true }, "Invalid effect: true"],
    ["a Sid that is a number", { Sid: 1 }, INVALID_SYNTAX],
    ["no principal", { Principal: undefined }, "Missing required field Principal"],
    ["Principal and NotPrincipal", { NotPrincipal: "*" }, "Statement/policy already has instance of Principal"],
    ["Action and NotAction", { NotAction: "s3:PutObject" }, "Statement/policy already has instance of Action"],
    ["Resource and NotResource", { NotResource: ARN }, "Statement/policy already has instance of Resource"],
    ["no action", { Action: undefined }, "Missing required field Action"],
    ["an empty list of actions", { Action: [] }, "Missing required field Action cannot be empty!"],
    [
      "an empty list in NotAction",
      { Action: undefined, NotAction: [] },
      "Missing required field Action cannot be empty!",
    ],
    ["an action that is a number", { Action: 1 }, INVALID_SYNTAX],
    ["a list of actions with a number", { Action: ["s3:GetObject", 1] }, INVALID_SYNTAX],
    ["no resource", { Resource: undefined }, "Missing required field Resource"],
    ["an empty list of resources", { Resource: [] }, "Missing required field Resource cannot be empty!"],
    [
      "an empty list in NotResource",
      { Resource: undefined, NotResource: [] },
      "Missing required field Resource cannot be empty!",
    ],
    ["a resource that is an object", { Resource: { arn: OBJECTS } }, INVALID_SYNTAX],
    ["a condition that is a string", { Condition: "StringEquals" }, INVALID_SYNTAX],
    ["a condition that is an array", { Condition: [] }, INVALID_SYNTAX],
    ["an operator without keys", { Condition: { StringEquals: "aws:username" } }, INVALID_SYNTAX],
    ["a condition value that is null", { Condition: { StringEquals: { "aws:username": null } } }, INVALID_SYNTAX],
    ["a condition value that is an object", { Condition: { StringEquals: { "aws:username": {} } } }, INVALID_SYNTAX],
    [
      "a list of condition values with a list",
      { Condition: { StringEquals: { "aws:username": [["a"]] } } },
      INVALID_SYNTAX,
    ],
  ])("refuses a statement with %s", (_, elements, message) => {
    expect(failure({ Version: "2012-10-17", Statement: [statement(elements)] })).toEqual(malformed(message));
    // The second statement of the policy and a statement without an array get the same check.
    expect(failure({ Statement: [valid, statement(elements)] })).toEqual(malformed(message));
    expect(failure({ Statement: statement(elements) })).toEqual(malformed(message));
  });

  test.each<[string, unknown]>([
    ["a string that is not *", "111122223333"],
    ["an ARN as a string", "arn:aws:iam::111122223333:root"],
    ["an empty string", ""],
    ["a list", ["*"]],
    ["a number", 111122223333],
    ["a boolean", true],
    ["null", null],
    ["an empty object", {}],
    ["an unknown type", { IAM: "111122223333" }],
    ["the type AWS in lowercase", { aws: "*" }],
    ["the type CanonicalUser in lowercase", { canonicaluser: alice.id }],
    ["a known type and an unknown type", { AWS: "*", Other: "x" }],
    ["an account ID of 11 digits", { AWS: "11112222333" }],
    ["an account ID of 13 digits", { AWS: "1111222233334" }],
    ["an account ID that is a number", { AWS: 111122223333 }],
    ["a name that is not an ARN", { AWS: "alice" }],
    ["an empty name", { AWS: "" }],
    ["an ARN of another service", { AWS: "arn:aws:s3:::b" }],
    ["an ARN of an unknown partition", { AWS: "arn:aws-eu:iam::111122223333:root" }],
    ["an ARN of IAM with a region", { AWS: "arn:aws:iam:us-east-1:111122223333:root" }],
    ["an ARN with capitals in the prefix", { AWS: "ARN:AWS:IAM::111122223333:root" }],
    ["a list with one name that is not valid", { AWS: ["111122223333", "bob"] }],
    ["a list with a number", { AWS: ["111122223333", 1] }],
    ["an empty list", { AWS: [] }],
    ["a canonical user that is an object", { CanonicalUser: { id: alice.id } }],
    ["a service that is null", { Service: null }],
  ])("refuses the principal %s", (_, principal) => {
    expect(failure({ Statement: [statement({ Principal: principal })] })).toEqual(malformed(INVALID_PRINCIPAL));
    expect(failure({ Statement: [statement({ Principal: undefined, NotPrincipal: principal })] })).toEqual(
      malformed(INVALID_PRINCIPAL),
    );
  });

  test.each([
    "",
    "s3:",
    "s3",
    "GetObject",
    "s3GetObject",
    "s3:Get Object",
    "s3:Get-Object",
    "s3:Get_Object",
    "s3:GetObject ",
    " s3:GetObject",
    "s3:Get:Object",
    "s3:GetObject\n",
    "s3:GetObjéct",
    "ec2:RunInstances",
    "iam:*",
    "**",
    "*:*",
    "s?:GetObject",
  ])("refuses the action %p", action => {
    expect(failure({ Statement: [statement({ Action: action })] })).toEqual(malformed(INVALID_ACTION));
    expect(failure({ Statement: [statement({ Action: ["s3:GetObject", action] })] })).toEqual(
      malformed(INVALID_ACTION),
    );
    expect(failure({ Statement: [statement({ Action: undefined, NotAction: action })] })).toEqual(
      malformed(INVALID_ACTION),
    );
  });

  test.each([
    "*",
    "",
    "b",
    "b/*",
    "arn:aws:s3:::*",
    "arn:aws:s3:::b*",
    "arn:aws:s3:::b?",
    "arn:aws:s3:::bb",
    "arn:aws:s3:::bb/*",
    "arn:aws:s3:::other/*",
    "arn:aws:s3:::B/*",
    "arn:aws:s3:::",
    "arn:aws:s3:::/b",
    "arn:aws:s3::b/*",
    "arn:aws:s3:us-east-1::b/*",
    "arn:aws:s3::111122223333:b/*",
    "arn:aws:s3:us-east-1:111122223333:accesspoint/b",
    "arn:aws:sqs:::b",
    "arn:aws:iam::111122223333:root",
    "arn:aws-eu:s3:::b/*",
    "arn:*:s3:::b/*",
    "ARN:AWS:S3:::b/*",
    " arn:aws:s3:::b/*",
  ])("refuses the resource %p", resource => {
    expect(failure({ Statement: [statement({ Resource: resource })] })).toEqual(malformed(INVALID_RESOURCE));
    expect(failure({ Statement: [statement({ Resource: [OBJECTS, resource] })] })).toEqual(malformed(INVALID_RESOURCE));
    expect(failure({ Statement: [statement({ Resource: undefined, NotResource: resource })] })).toEqual(
      malformed(INVALID_RESOURCE),
    );
  });

  test("checks the resource against the name of the bucket that gets the policy", () => {
    const document = { Statement: [statement({ Resource: "arn:aws:s3:::photos.example/*" })] };
    expect(failure(document, "photos.example")).toBeUndefined();
    expect(failure(document, "photos")).toEqual(malformed(INVALID_RESOURCE));
    expect(failure(document, "photosXexample")).toEqual(malformed(INVALID_RESOURCE));
    expect(failure(document, "b")).toEqual(malformed(INVALID_RESOURCE));
  });

  test.each([
    "StringEqualz",
    "Equals",
    "",
    "String Equals",
    "StringEquals ",
    "IfExists",
    "ForAllValues:",
    "ForAnyValue:IfExists",
    "ForAllValue:StringEquals",
    "ForAnyValues:StringEquals",
    "ForEachValue:StringEquals",
    "StringEquals:ForAnyValue",
    "ForAnyValue:ForAllValues:StringEquals",
    "StringEqualsIfExistsIfExists",
    "StringEqualsIfExist",
    "NullIfExists",
    "IpAddressNot",
    "NotStringEquals",
    "DateBefore",
    "BinaryNotEquals",
    "constructor",
    "__proto__",
  ])("refuses the condition operator %p", operator => {
    const text = `{"Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::b/*","Condition":{${JSON.stringify(operator)}:{"aws:username":"a"}}}]}`;
    expect(failure(text)).toEqual(malformed(`Invalid Condition type : ${operator}`));
  });

  const rest = `"Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::b/*"`;
  test.each([
    ["Version", `{"Version":"2012-10-17","Version":"2012-10-17","Statement":[{"Effect":"Allow",${rest}}]}`],
    ["Statement", `{"Statement":[{"Effect":"Allow",${rest}}],"Statement":[{"Effect":"Allow",${rest}}]}`],
    ["Effect", `{"Statement":[{"Effect":"Deny",${rest},"Effect":"Allow"}]}`],
    ["Effect", `{"Statement":[{"Effect":"Allow",${rest}},{"Effect":"Allow","\\u0045ffect":"Allow",${rest}}]}`],
    ["Action", `{"Statement":{"Effect":"Allow",${rest},"Action":"s3:PutObject"}}`],
    [
      "AWS",
      `{"Statement":[{"Effect":"Allow","Principal":{"AWS":"*","AWS":"111122223333"},"Action":"s3:GetObject","Resource":"arn:aws:s3:::b/*"}]}`,
    ],
    [
      "StringEquals",
      `{"Statement":[{"Effect":"Allow",${rest},"Condition":{"StringEquals":{"a":"1"},"StringEquals":{"b":"2"}}}]}`,
    ],
    [
      "aws:username",
      `{"Statement":[{"Effect":"Allow",${rest},"Condition":{"StringEquals":{"aws:username":"a","aws:username":"b"}}}]}`,
    ],
  ])("refuses a document that has the name %s two times in one object", (name, text) => {
    expect(failure(text)).toEqual(malformed(`Statement/policy already has instance of ${name}`));
  });

  test("accepts the same name in different objects and in strings", () => {
    const text = `{"Id":"{\\"Id\\":1,\\"Id\\":2}","Statement":[
      {"Sid":"Sid","Effect":"Allow",${rest},"Condition":{"StringEquals":{"k":["Sid","Sid","k"]},"StringLike":{"k":"\\\\"}}},
      {"Sid":"Action","Effect":"Allow",${rest},"Condition":{"StringEquals":{"k":"Effect"}}}
    ]}`;
    expect(parseBucketPolicy(text, "b")).toEqual({
      text,
      id: `{"Id":1,"Id":2}`,
      statements: [
        {
          sid: "Sid",
          effect: "Allow",
          principal: "*",
          actions: ["s3:GetObject"],
          resources: [OBJECTS],
          conditions: { StringEquals: { k: ["Sid", "Sid", "k"] }, StringLike: { k: ["\\"] } },
        },
        {
          sid: "Action",
          effect: "Allow",
          principal: "*",
          actions: ["s3:GetObject"],
          resources: [OBJECTS],
          conditions: { StringEquals: { k: ["Effect"] } },
        },
      ],
    });
  });

  test("keeps a condition key with the name __proto__ as a key", () => {
    const text = `{"Statement":[{"Effect":"Allow",${rest},"Condition":{"StringEquals":{"__proto__":"a"}}}]}`;
    const keys = parseBucketPolicy(text, "b").statements[0].conditions?.StringEquals ?? {};
    expect(Object.entries(keys)).toEqual([["__proto__", ["a"]]]);
  });

  test.each<[string | string[], string | string[]]>([
    ["s3:GetObject", ARN],
    ["s3:getobject", ARN],
    ["s3:PutObject", ARN],
    ["s3:DeleteObject", ARN],
    ["s3:AbortMultipartUpload", ARN],
    ["s3:ListMultipartUploadParts", ARN],
    ["s3:*Object", ARN],
    ["s3:GetObject?cl", ARN],
    ["s3:ListBucket", OBJECTS],
    ["s3:LISTBUCKET", OBJECTS],
    ["s3:ListBucketVersions", OBJECTS],
    ["s3:ListBucketMultipartUploads", OBJECTS],
    ["s3:GetBucketLocation", OBJECTS],
    ["s3:PutBucketPolicy", ARN + "/policy"],
    ["s3:DeleteBucket", OBJECTS],
    ["s3:*BucketPolicy", OBJECTS],
    ["s3:ListBucket*", OBJECTS],
    [["s3:GetObject", "s3:ListBucket"], OBJECTS],
    [["s3:GetObject", "s3:ListBucket"], ARN],
    [
      ["s3:*", "s3:ListBucket"],
      [OBJECTS, ARN + "/a"],
    ],
  ])("refuses the action %p on the resource %p", (action, resource) => {
    const message = "Action does not apply to any resource(s) in statement";
    expect(failure({ Statement: [statement({ Action: action, Resource: resource })] })).toEqual(malformed(message));
    expect(failure({ Statement: [statement({ Effect: "Deny", Action: action, Resource: resource })] })).toEqual(
      malformed(message),
    );
  });

  test.each<[string | string[], string | string[]]>([
    ["s3:GetObject", OBJECTS],
    ["s3:GetObject", ARN + "/"],
    ["s3:GetObject", [ARN, OBJECTS]],
    ["s3:ListBucket", ARN],
    ["s3:ListBucket", [OBJECTS, ARN]],
    [
      ["s3:GetObject", "s3:ListBucket"],
      [ARN, OBJECTS],
    ],
    ["*", ARN],
    ["*", OBJECTS],
    ["s3:*", ARN],
    ["s3:*", OBJECTS],
    ["s3:Get*", ARN],
    ["s3:Get*", OBJECTS],
    ["s3:List*", ARN],
    ["s3:List*", OBJECTS],
    ["s3:Put*", ARN],
    ["s3:Delete*", OBJECTS],
    // s3:ObjectOwnerOverrideToBucketOwner is an action on an object.
    ["s3:*Bucket*", OBJECTS],
    ["s3:ListAllMyBuckets", ARN],
    ["s3:ListAllMyBuckets", OBJECTS],
    ["s3:NotARealAction", ARN],
    ["s3:NotARealAction", OBJECTS],
  ])("accepts the action %p on the resource %p", (action, resource) => {
    expect(failure({ Statement: [statement({ Action: action, Resource: resource })] })).toBeUndefined();
  });

  test.each<[string, Document]>([
    ["NotAction", { Action: undefined, NotAction: "s3:ListBucket", Resource: OBJECTS }],
    ["NotAction", { Action: undefined, NotAction: "s3:GetObject", Resource: ARN }],
    ["NotResource", { Action: "s3:ListBucket", Resource: undefined, NotResource: OBJECTS }],
    ["NotResource", { Action: "s3:GetObject", Resource: undefined, NotResource: ARN }],
  ])("does not check the kind of the resource for %s", (_, elements) => {
    expect(failure({ Statement: [statement(elements)] })).toBeUndefined();
  });
});

describe("evaluateBucketPolicy", () => {
  describe("a policy for public reads", () => {
    const publicRead = policy(statement());

    test.each<[string, Partial<PolicyRequest>, "Allow" | undefined]>([
      ["allows an anonymous GetObject", {}, "Allow"],
      ["allows a signed GetObject", { principal: alice }, "Allow"],
      ["allows a GetObject on a key in the root", { resource: ARN + "/a" }, "Allow"],
      ["allows a GetObject on the empty key", { resource: ARN + "/" }, "Allow"],
      ["says nothing about PutObject", { action: "s3:PutObject" }, undefined],
      ["says nothing about a signed PutObject", { action: "s3:PutObject", principal: alice }, undefined],
      ["says nothing about GetObjectAcl", { action: "s3:GetObjectAcl" }, undefined],
      ["says nothing about the bucket", { resource: ARN }, undefined],
      ["says nothing about ListBucket on the bucket", { action: "s3:ListBucket", resource: ARN }, undefined],
      ["says nothing about another bucket", { resource: "arn:aws:s3:::bb/a/b.txt" }, undefined],
    ])("%s", (_, parts, expected) => {
      expect(evaluateBucketPolicy(publicRead, request(parts))).toBe(expected);
    });
  });

  describe("an explicit Deny", () => {
    const allow = statement({ Action: ["s3:GetObject", "s3:DeleteObject"] });
    const deny = statement({ Effect: "Deny", Action: "s3:DeleteObject" });
    const unrelated = statement({ Effect: "Deny", Principal: { AWS: bob.accountId }, Action: "s3:*" });

    test.each<[string, Document[]]>([
      ["Allow, Deny", [allow, deny]],
      ["Deny, Allow", [deny, allow]],
      ["Allow, Deny, Allow", [allow, deny, allow]],
      ["Deny, Allow, Deny", [unrelated, allow, deny]],
      ["Allow, Allow, Deny", [allow, unrelated, allow, deny]],
    ])("wins in the order %s", (_, statements) => {
      const decisions = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"].map(action =>
        evaluateBucketPolicy(policy(...statements), request({ action, principal: alice })),
      );
      expect(decisions).toEqual(["Deny", "Allow", undefined]);
    });

    test("without an Allow is a Deny", () => {
      expect(evaluateBucketPolicy(policy(deny), request({ action: "s3:DeleteObject" }))).toBe("Deny");
      expect(evaluateBucketPolicy(policy(deny), request({ action: "s3:GetObject" }))).toBeUndefined();
    });
  });

  describe("Principal", () => {
    const account = alice.accountId;
    test.each<[string, unknown, [alice: boolean, bob: boolean, carol: boolean, anonymous: boolean]]>([
      ["*", "*", [true, true, true, true]],
      ["AWS *", { AWS: "*" }, [true, true, true, true]],
      ["AWS * in a list", { AWS: [bob.accountId, "*"] }, [true, true, true, true]],
      ["an account ID", { AWS: account }, [true, false, false, false]],
      ["the root of the account", { AWS: `arn:aws:iam::${account}:root` }, [true, false, false, false]],
      ["a user of the account", { AWS: `arn:aws:iam::${account}:user/alice` }, [true, false, false, false]],
      ["a user with a path", { AWS: `arn:aws:iam::${account}:user/team/alice` }, [true, false, false, false]],
      ["a role of the account", { AWS: `arn:aws:iam::${account}:role/reader` }, [true, false, false, false]],
      ["a session of a role", { AWS: `arn:aws:sts::${account}:assumed-role/reader/s` }, [true, false, false, false]],
      ["the root in another partition", { AWS: `arn:aws-cn:iam::${account}:root` }, [true, false, false, false]],
      ["a list of accounts", { AWS: [account, `arn:aws:iam::${bob.accountId}:root`] }, [true, true, false, false]],
      ["a list without the account", { AWS: ["999999999999", bob.accountId] }, [false, true, false, false]],
      ["a group, which is not a principal", { AWS: `arn:aws:iam::${account}:group/g` }, [false, false, false, false]],
      ["a role of STS", { AWS: `arn:aws:sts::${account}:role/reader` }, [false, false, false, false]],
      ["an ARN without a name", { AWS: `arn:aws:iam::${account}:` }, [false, false, false, false]],
      ["the canonical user", { CanonicalUser: alice.id }, [true, false, false, false]],
      ["a list of canonical users", { CanonicalUser: [bob.id, carol.id] }, [false, true, true, false]],
      ["the canonical user *", { CanonicalUser: "*" }, [false, false, false, false]],
      ["the account ID as a canonical user", { CanonicalUser: account }, [false, false, false, false]],
      ["a service", { Service: "s3.amazonaws.com" }, [false, false, false, false]],
      ["a federated provider", { Federated: "accounts.google.com" }, [false, false, false, false]],
      ["an account and a canonical user", { AWS: account, CanonicalUser: bob.id }, [true, true, false, false]],
      ["a service and an account", { Service: "s3.amazonaws.com", AWS: bob.accountId }, [false, true, false, false]],
    ])("%s", (_, principal, expected) => {
      const requesters = [alice, bob, carol, undefined];
      const positive = policy(statement({ Principal: principal }));
      expect(requesters.map(who => evaluateBucketPolicy(positive, request({ principal: who })) === "Allow")).toEqual(
        expected,
      );
      // NotPrincipal applies to each request that Principal does not apply to.
      const negative = policy(statement({ Principal: undefined, NotPrincipal: principal }));
      expect(requesters.map(who => evaluateBucketPolicy(negative, request({ principal: who })) === undefined)).toEqual(
        expected,
      );
    });

    test("NotPrincipal in a Deny statement refuses all but the listed account", () => {
      const only = policy(
        statement(),
        statement({ Effect: "Deny", Principal: undefined, NotPrincipal: { AWS: account } }),
      );
      const decisions = [alice, bob, carol, undefined].map(who =>
        evaluateBucketPolicy(only, request({ principal: who })),
      );
      expect(decisions).toEqual(["Allow", "Deny", "Deny", "Deny"]);
    });
  });

  describe("Action", () => {
    test.each<[string | string[], string, boolean]>([
      ["s3:GetObject", "s3:GetObject", true],
      ["s3:GetObject", "s3:getobject", true],
      ["s3:getobject", "s3:GetObject", true],
      ["S3:GETOBJECT", "s3:GetObject", true],
      ["s3:GetObject", "s3:GetObjectAcl", false],
      ["s3:GetObjectAcl", "s3:GetObject", false],
      ["s3:GetObject", "s3:PutObject", false],
      ["*", "s3:GetObject", true],
      ["*", "s3:ListBucket", true],
      ["s3:*", "s3:DeleteObject", true],
      ["S3:*", "s3:DeleteObject", true],
      ["s3:Get*", "s3:GetObject", true],
      ["s3:get*", "s3:GetObjectTagging", true],
      ["s3:Get*", "s3:PutObject", false],
      ["s3:*Object", "s3:PutObject", true],
      ["s3:*Object", "s3:PutObjectAcl", false],
      ["s3:*object*", "s3:PutObjectAcl", true],
      ["s3:Get*Tagging", "s3:GetObjectTagging", true],
      ["s3:Get*Tagging", "s3:GetObjectVersionTagging", true],
      ["s3:Get*Tagging", "s3:GetObjectAcl", false],
      ["s3:GetObject*", "s3:GetObject", true],
      ["s3:?etObject", "s3:GetObject", true],
      ["s3:?etObject", "s3:SetObject", true],
      ["s3:?ETOBJECT", "s3:GetObject", true],
      ["s3:?etObject", "s3:etObject", false],
      ["s3:?GetObject", "s3:GetObject", false],
      ["s3:GetObject?", "s3:GetObject", false],
      ["s3:GetObject???", "s3:GetObjectAcl", true],
      ["s3:???Object", "s3:GetObject", true],
      ["s3:???Object", "s3:DeleteObject", false],
      ["s3:*?", "s3:GetObject", true],
      ["s3:G*t*O*t", "s3:GetObject", true],
      ["s3:G*t*O*x", "s3:GetObject", false],
      [["s3:PutObject", "s3:GetObject"], "s3:GetObject", true],
      [["s3:PutObject", "s3:Delete*"], "s3:GetObject", false],
    ])("the pattern %p with the action %p: %p", (pattern, action, expected) => {
      const resources = [ARN, OBJECTS];
      const positive = policy(statement({ Action: pattern, Resource: resources }));
      expect(evaluateBucketPolicy(positive, request({ action }))).toBe(expected ? "Allow" : undefined);
      const negative = policy(statement({ Action: undefined, NotAction: pattern, Resource: resources }));
      expect(evaluateBucketPolicy(negative, request({ action }))).toBe(expected ? undefined : "Allow");
    });

    test("NotAction in a Deny statement refuses all other actions", () => {
      const readOnly = policy(
        statement({ Action: "s3:*" }),
        statement({ Effect: "Deny", Action: undefined, NotAction: ["s3:GetObject", "s3:GetObjectVersion"] }),
      );
      const actions = ["s3:GetObject", "s3:getobjectversion", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectAcl"];
      expect(actions.map(action => evaluateBucketPolicy(readOnly, request({ action })))).toEqual([
        "Allow",
        "Allow",
        "Deny",
        "Deny",
        "Deny",
      ]);
    });
  });

  describe("Resource", () => {
    test.each<[string | string[], string, boolean]>([
      [ARN, ARN, true],
      [ARN, ARN + "/", false],
      [ARN, ARN + "/a", false],
      [ARN + "/a", ARN + "/a", true],
      [ARN + "/a", ARN + "/A", false],
      [ARN + "/A", ARN + "/a", false],
      [ARN + "/a", ARN + "/a/", false],
      [ARN + "/a", ARN + "/ab", false],
      [ARN + "/a", ARN, false],
      [OBJECTS, ARN, false],
      [OBJECTS, ARN + "/", true],
      [OBJECTS, ARN + "/a", true],
      [OBJECTS, ARN + "/a/b/c.txt", true],
      [OBJECTS, "arn:aws:s3:::bb/a", false],
      [OBJECTS, ARN + "*", false],
      [ARN + "/photos/*", ARN + "/photos/2024/cat.jpg", true],
      [ARN + "/photos/*", ARN + "/photos/", true],
      [ARN + "/photos/*", ARN + "/photos", false],
      [ARN + "/photos/*", ARN + "/Photos/cat.jpg", false],
      [ARN + "/photos/*", ARN + "/videos/cat.mp4", false],
      [ARN + "/*.jpg", ARN + "/photos/2024/cat.jpg", true],
      [ARN + "/*.jpg", ARN + "/cat.JPG", false],
      [ARN + "/*.jpg", ARN + "/cat.jpg.txt", false],
      [ARN + "/*/cat.jpg", ARN + "/a/b/cat.jpg", true],
      [ARN + "/*/cat.jpg", ARN + "/cat.jpg", false],
      [ARN + "/a*b*c", ARN + "/a/b/c", true],
      [ARN + "/a*b*c", ARN + "/abcbc", true],
      [ARN + "/a*b*c", ARN + "/acb", false],
      [ARN + "/**", ARN + "/a", true],
      [ARN + "/log-?", ARN + "/log-1", true],
      [ARN + "/log-?", ARN + "/log-", false],
      [ARN + "/log-?", ARN + "/log-12", false],
      [ARN + "/log-?", ARN + "/log-/", true],
      [ARN + "/log-?", ARN + "/log-é", true],
      [ARN + "/log-?", ARN + "/log-😀", true],
      [ARN + "/log-??", ARN + "/log-😀", false],
      [ARN + "/?*", ARN + "/", false],
      [ARN + "/?*", ARN + "/a", true],
      [ARN + "/a.txt", ARN + "/abtxt", false],
      [ARN + "/(a|b)+[c]", ARN + "/(a|b)+[c]", true],
      [ARN + "/(a|b)+[c]", ARN + "/a", false],
      [ARN + "/a\nb", ARN + "/a\nb", true],
      [ARN + "/*", ARN + "/a\nb", true],
      [ARN + "/${*}", ARN + "/*", true],
      [ARN + "/${*}", ARN + "/a", false],
      [ARN + "/${*}", ARN + "/${*}", false],
      [ARN + "/${?}", ARN + "/?", true],
      [ARN + "/${?}", ARN + "/a", false],
      [ARN + "/${$}", ARN + "/$", true],
      [ARN + "/${$}", ARN + "/${$}", false],
      // The characters after ${$} are a brace, a wildcard and a brace.
      [ARN + "/${$}{*}", ARN + "/${abc}", true],
      [ARN + "/${$}{*}", ARN + "/$abc", false],
      [ARN + "/a${*}b*", ARN + "/a*bc", true],
      [ARN + "/a${*}b*", ARN + "/aXbc", false],
      [ARN + "/${*", ARN + "/${abc", true],
      [ARN + "/$", ARN + "/$", true],
      [ARN + "/${aws:username}/*", ARN + "/${aws:username}/a", true],
      ["arn:aws-cn:s3:::b/*", ARN + "/a", true],
      ["arn:aws-us-gov:s3:::b", ARN, true],
      [OBJECTS, "arn:aws-cn:s3:::b/a", true],
      [[ARN, ARN + "/a"], ARN + "/a", true],
      [[ARN, ARN + "/a"], ARN + "/b", false],
    ])("the pattern %p with the resource %p: %p", (pattern, resource, expected) => {
      const positive = policy(statement({ Action: "s3:*", Resource: pattern }));
      expect(evaluateBucketPolicy(positive, request({ resource }))).toBe(expected ? "Allow" : undefined);
      const negative = policy(statement({ Resource: undefined, NotResource: pattern }));
      expect(evaluateBucketPolicy(negative, request({ resource }))).toBe(expected ? undefined : "Allow");
    });

    test("NotResource in a Deny statement protects all other keys", () => {
      const onlyPublic = policy(
        statement(),
        statement({ Effect: "Deny", Resource: undefined, NotResource: [ARN + "/public/*", ARN + "/index.html"] }),
      );
      const keys = ["/public/a.txt", "/index.html", "/private/a.txt", "/public", "/Public/a.txt"];
      expect(keys.map(key => evaluateBucketPolicy(onlyPublic, request({ resource: ARN + key })))).toEqual([
        "Allow",
        "Allow",
        "Deny",
        "Deny",
        "Deny",
      ]);
    });

    test("a pattern with many wildcards does not take long", () => {
      const pattern = ARN + "/" + Buffer.alloc(40, "*a").toString() + "b";
      const resource = ARN + "/" + Buffer.alloc(2000, "a").toString();
      const slow = policy(statement({ Resource: pattern }));
      expect(evaluateBucketPolicy(slow, request({ resource }))).toBeUndefined();
      expect(evaluateBucketPolicy(slow, request({ resource: resource + "b" }))).toBe("Allow");
    });
  });

  describe("Condition", () => {
    type Row = [operator: string, expected: unknown, value: string | string[] | undefined, holds: boolean];

    function check(...[operator, expected, value, holds]: Row): void {
      const condition = { [operator]: { "aws:key": expected } };
      expect(decide(condition, { "aws:key": value })).toBe(holds ? "Allow" : undefined);
      // A missing key is the same as a key that is not in the context.
      if (value === undefined) expect(decide(condition, {})).toBe(holds ? "Allow" : undefined);
    }

    describe("strings", () => {
      test.each<Row>([
        ["StringEquals", "a", "a", true],
        ["StringEquals", "a", "A", false],
        ["StringEquals", "a", "ab", false],
        ["StringEquals", "a", "", false],
        ["StringEquals", "", "", true],
        ["StringEquals", ["a", "b"], "b", true],
        ["StringEquals", ["a", "b"], "c", false],
        ["StringEquals", [], "a", false],
        ["StringEquals", "a*", "ab", false],
        ["StringEquals", "a*", "a*", true],
        ["StringEquals", "a?", "a?", true],
        ["StringEquals", "a${*}${?}${$}", "a*?$", true],
        ["StringEquals", "a${*}", "a${*}", false],
        ["StringEquals", 5, "5", true],
        ["StringEquals", true, "true", true],
        ["StringEquals", "a", undefined, false],
        ["StringNotEquals", "a", "b", true],
        ["StringNotEquals", "a", "a", false],
        ["StringNotEquals", "a", "A", true],
        ["StringNotEquals", ["a", "b"], "b", false],
        ["StringNotEquals", ["a", "b"], "c", true],
        ["StringNotEquals", [], "a", true],
        ["StringNotEquals", "a", undefined, true],
        ["StringEqualsIgnoreCase", "abc", "ABC", true],
        ["StringEqualsIgnoreCase", "ABC", "abc", true],
        ["StringEqualsIgnoreCase", "abc", "abd", false],
        ["StringEqualsIgnoreCase", "a*", "ab", false],
        ["StringEqualsIgnoreCase", ["x", "AbC"], "aBc", true],
        ["StringEqualsIgnoreCase", "abc", undefined, false],
        ["StringNotEqualsIgnoreCase", "abc", "ABC", false],
        ["StringNotEqualsIgnoreCase", "abc", "abd", true],
        ["StringNotEqualsIgnoreCase", ["x", "AbC"], "aBc", false],
        ["StringNotEqualsIgnoreCase", "abc", undefined, true],
        ["StringLike", "a", "a", true],
        ["StringLike", "a", "A", false],
        ["StringLike", "a*", "a", true],
        ["StringLike", "a*", "abc", true],
        ["StringLike", "a*", "Abc", false],
        ["StringLike", "a*", "ba", false],
        ["StringLike", "*", "", true],
        ["StringLike", "*", "a/b:c", true],
        ["StringLike", "home/*/file", "home/a/b/file", true],
        ["StringLike", "home/*/file", "home/file", false],
        ["StringLike", "a?c", "abc", true],
        ["StringLike", "a?c", "ac", false],
        ["StringLike", "a?c", "abbc", false],
        ["StringLike", "a${*}c", "a*c", true],
        ["StringLike", "a${*}c", "abc", false],
        ["StringLike", "a${?}c", "a?c", true],
        ["StringLike", "a${?}c", "abc", false],
        ["StringLike", ["x*", "y*"], "yes", true],
        ["StringLike", ["x*", "y*"], "no", false],
        ["StringLike", "a*", undefined, false],
        ["StringNotLike", "a*", "abc", false],
        ["StringNotLike", "a*", "bc", true],
        ["StringNotLike", ["x*", "y*"], "yes", false],
        ["StringNotLike", ["x*", "y*"], "no", true],
        ["StringNotLike", "a*", undefined, true],
      ])("%s %p with %p: %p", check);
    });

    describe("numbers", () => {
      test.each<Row>([
        ["NumericEquals", 10, "10", true],
        ["NumericEquals", "10", "10", true],
        ["NumericEquals", "10", "10.0", true],
        ["NumericEquals", "10", "+10", true],
        ["NumericEquals", "10", "1e1", true],
        ["NumericEquals", "010", "10", true],
        ["NumericEquals", 1.5, "1.50", true],
        ["NumericEquals", -3, "-3", true],
        ["NumericEquals", 10, "11", false],
        ["NumericEquals", 10, "ten", false],
        ["NumericEquals", 10, "", false],
        ["NumericEquals", 10, "0x0a", false],
        ["NumericEquals", 10, "10 ", false],
        ["NumericEquals", "ten", "ten", false],
        ["NumericEquals", [10, 20], "20", true],
        ["NumericEquals", [10, 20], "15", false],
        ["NumericEquals", 10, undefined, false],
        ["NumericNotEquals", 10, "11", true],
        ["NumericNotEquals", 10, "10.0", false],
        ["NumericNotEquals", [10, 20], "20", false],
        ["NumericNotEquals", [10, 20], "15", true],
        ["NumericNotEquals", 10, undefined, true],
        ["NumericLessThan", 10, "9", true],
        ["NumericLessThan", 10, "9.99", true],
        ["NumericLessThan", 10, "-100", true],
        ["NumericLessThan", 10, "10", false],
        ["NumericLessThan", 10, "11", false],
        // The order is the order of the numbers and not the order of the text.
        ["NumericLessThan", 100, "20", true],
        ["NumericLessThan", 20, "100", false],
        ["NumericLessThan", 10, "nine", false],
        ["NumericLessThan", 10, undefined, false],
        ["NumericLessThanEquals", 10, "10", true],
        ["NumericLessThanEquals", 10, "9", true],
        ["NumericLessThanEquals", 10, "10.01", false],
        ["NumericLessThanEquals", 10, undefined, false],
        ["NumericGreaterThan", 10, "11", true],
        ["NumericGreaterThan", 9, "10", true],
        ["NumericGreaterThan", 10, "10", false],
        ["NumericGreaterThan", 10, "9", false],
        ["NumericGreaterThan", 10, undefined, false],
        ["NumericGreaterThanEquals", 10, "10", true],
        ["NumericGreaterThanEquals", 10, "1e2", true],
        ["NumericGreaterThanEquals", 10, "9.99", false],
        ["NumericGreaterThanEquals", 10, undefined, false],
        ["NumericLessThan", [5, 10], "7", true],
        ["NumericLessThan", [5, 10], "10", false],
      ])("%s %p with %p: %p", check);
    });

    describe("dates", () => {
      const newYear = "2024-01-01T00:00:00Z";
      test.each<Row>([
        ["DateEquals", newYear, "2024-01-01T00:00:00Z", true],
        ["DateEquals", newYear, "2024-01-01T00:00:00.000Z", true],
        ["DateEquals", newYear, "2024-01-01T00:00Z", true],
        ["DateEquals", newYear, "2024-01-01t00:00:00z", true],
        ["DateEquals", newYear, "2024-01-01T01:00:00+01:00", true],
        ["DateEquals", newYear, "2023-12-31T19:00:00-0500", true],
        ["DateEquals", newYear, "2023-12-31T14:30:00-09:30", true],
        ["DateEquals", newYear, "2024-01-01T00:00:00", true],
        ["DateEquals", newYear, "2024-01-01", true],
        ["DateEquals", newYear, "2024-01", true],
        ["DateEquals", newYear, "1704067200", true],
        ["DateEquals", newYear, "1704067200.0", true],
        ["DateEquals", 1704067200, newYear, true],
        ["DateEquals", "1704067200", "1704067200", true],
        ["DateEquals", "2024-01-01", "1704067200", true],
        ["DateEquals", newYear, "2024-01-01T00:00:01Z", false],
        ["DateEquals", newYear, "2024-01-01T00:00:00.001Z", false],
        ["DateEquals", newYear, "1704067201", false],
        ["DateEquals", newYear, "2024-01-01T00:00:00+01:00", false],
        ["DateEquals", newYear, "not a date", false],
        ["DateEquals", newYear, "", false],
        ["DateEquals", newYear, "01/01/2024", false],
        ["DateEquals", newYear, "Mon, 01 Jan 2024 00:00:00 GMT", false],
        ["DateEquals", "2024-02-30T00:00:00Z", "2024-02-30T00:00:00Z", false],
        ["DateEquals", "2024-13-01", "2024-13-01", false],
        ["DateEquals", "2024-01-01T24:00:00Z", "2024-01-01T24:00:00Z", false],
        ["DateEquals", "2024-02-29", "2024-02-29T00:00:00Z", true],
        ["DateEquals", ["2023-01-01", newYear], "2024-01-01", true],
        ["DateEquals", newYear, undefined, false],
        ["DateNotEquals", newYear, "2024-01-01T00:00:01Z", true],
        ["DateNotEquals", newYear, "2024-01-01T01:00:00+01:00", false],
        ["DateNotEquals", ["2023-01-01", newYear], "1704067200", false],
        ["DateNotEquals", ["2023-01-01", newYear], "2025-01-01", true],
        ["DateNotEquals", newYear, undefined, true],
        ["DateLessThan", newYear, "2023-12-31T23:59:59Z", true],
        ["DateLessThan", newYear, "2023-12-31T23:59:59.999Z", true],
        ["DateLessThan", newYear, "1704067199", true],
        ["DateLessThan", newYear, "2024-01-01T00:00:00Z", false],
        ["DateLessThan", newYear, "2024-01-01T00:00:00.001Z", false],
        // The order is the order of the instants and not the order of the text.
        ["DateLessThan", newYear, "2024-01-01T00:30:00+01:00", true],
        ["DateLessThan", newYear, "2023-12-31T23:30:00-01:00", false],
        ["DateLessThan", newYear, undefined, false],
        ["DateLessThanEquals", newYear, "2024-01-01T00:00:00Z", true],
        ["DateLessThanEquals", newYear, "2023-06-01", true],
        ["DateLessThanEquals", newYear, "2024-01-01T00:00:00.001Z", false],
        ["DateLessThanEquals", newYear, undefined, false],
        ["DateGreaterThan", newYear, "2024-01-01T00:00:00.001Z", true],
        ["DateGreaterThan", newYear, "1704067201", true],
        ["DateGreaterThan", newYear, "2024-01-01T00:00:00Z", false],
        ["DateGreaterThan", newYear, "2023-12-31T23:59:59Z", false],
        ["DateGreaterThan", newYear, undefined, false],
        ["DateGreaterThanEquals", newYear, "2024-01-01T00:00:00Z", true],
        ["DateGreaterThanEquals", newYear, "2030-01-01", true],
        ["DateGreaterThanEquals", newYear, "2023-12-31T23:59:59.999Z", false],
        ["DateGreaterThanEquals", newYear, undefined, false],
      ])("%s %p with %p: %p", check);
    });

    describe("booleans and binary values", () => {
      test.each<Row>([
        ["Bool", "true", "true", true],
        ["Bool", true, "true", true],
        ["Bool", "True", "true", true],
        ["Bool", "true", "TRUE", true],
        ["Bool", "true", "false", false],
        ["Bool", "true", "1", false],
        ["Bool", "true", "", false],
        ["Bool", false, "false", true],
        ["Bool", "false", "False", true],
        ["Bool", "false", "true", false],
        ["Bool", ["true", "false"], "false", true],
        ["Bool", "true", undefined, false],
        ["Bool", "false", undefined, false],
        ["BinaryEquals", "aGVsbG8=", "aGVsbG8=", true],
        ["BinaryEquals", "aGVsbG8=", "aGVsbG8", true],
        ["BinaryEquals", "aGVsbG8=", "d29ybGQ=", false],
        ["BinaryEquals", "aGVsbG8=", "aGVsbG8h", false],
        ["BinaryEquals", ["d29ybGQ=", "aGVsbG8="], "aGVsbG8=", true],
        ["BinaryEquals", "aGVsbG8=", undefined, false],
      ])("%s %p with %p: %p", check);
    });

    describe("IP addresses", () => {
      const rows: [block: string | string[], address: string, inside: boolean][] = [
        ["203.0.113.0/24", "203.0.113.0", true],
        ["203.0.113.0/24", "203.0.113.7", true],
        ["203.0.113.0/24", "203.0.113.255", true],
        ["203.0.113.0/24", "203.0.114.0", false],
        ["203.0.113.0/24", "203.0.112.255", false],
        ["203.0.113.0/24", "204.0.113.7", false],
        ["203.0.113.7", "203.0.113.7", true],
        ["203.0.113.7", "203.0.113.8", false],
        ["203.0.113.7", "203.0.113.6", false],
        ["203.0.113.7/32", "203.0.113.7", true],
        ["203.0.113.7/32", "203.0.113.6", false],
        ["203.0.113.7/32", "203.0.112.7", false],
        ["203.0.113.6/31", "203.0.113.7", true],
        ["203.0.113.6/31", "203.0.113.8", false],
        ["0.0.0.0/0", "0.0.0.0", true],
        ["0.0.0.0/0", "8.8.8.8", true],
        ["0.0.0.0/0", "255.255.255.255", true],
        ["0.0.0.0/0", "2001:db8::1", false],
        ["0.0.0.0/0", "::", false],
        ["128.0.0.0/1", "128.0.0.0", true],
        ["128.0.0.0/1", "127.255.255.255", false],
        ["10.0.0.0/8", "10.255.255.255", true],
        ["10.0.0.0/8", "11.0.0.0", false],
        ["10.0.0.0/8", "9.255.255.255", false],
        ["172.16.0.0/12", "172.31.255.255", true],
        ["172.16.0.0/12", "172.32.0.0", false],
        ["192.168.1.128/25", "192.168.1.128", true],
        ["192.168.1.128/25", "192.168.1.127", false],
        // The bits of the block after the prefix have no effect.
        ["192.168.1.130/25", "192.168.1.200", true],
        ["192.168.1.130/25", "192.168.1.100", false],
        [["10.0.0.0/8", "203.0.113.0/24"], "203.0.113.9", true],
        [["10.0.0.0/8", "203.0.113.0/24"], "10.1.2.3", true],
        [["10.0.0.0/8", "203.0.113.0/24"], "192.0.2.1", false],
        ["2001:db8::/32", "2001:db8::", true],
        ["2001:db8::/32", "2001:db8::1", true],
        ["2001:db8::/32", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", true],
        ["2001:db8::/32", "2001:DB8:0:0:0:0:0:1", true],
        ["2001:db8::/32", "2001:0db8:0000:0000:0000:0000:0000:0001", true],
        ["2001:db8::/32", "2001:db9::1", false],
        ["2001:db8::/32", "2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", false],
        ["2001:db8::/32", "203.0.113.7", false],
        ["2001:db8::/33", "2001:db8:7fff::1", true],
        ["2001:db8::/33", "2001:db8:8000::1", false],
        ["2001:db8::1", "2001:db8:0:0:0:0:0:1", true],
        ["2001:db8::1", "2001:db8::2", false],
        ["2001:db8::1/128", "2001:db8::1", true],
        ["2001:db8::1/128", "2001:db8::", false],
        ["2001:db8::1/128", "2001:db8::1:1", false],
        ["2001:db8:0:0:1::/127", "2001:db8::1:0:0:1", true],
        ["2001:db8:0:0:1::/127", "2001:db8::1:0:0:2", false],
        ["::/0", "::", true],
        ["::/0", "::1", true],
        ["::/0", "2001:db8::1", true],
        ["::/0", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true],
        ["::/0", "203.0.113.7", false],
        ["::1", "::1", true],
        ["::1", "0:0:0:0:0:0:0:1", true],
        ["::1", "127.0.0.1", false],
        ["127.0.0.1", "::1", false],
        ["fe80::/10", "fe80::1%eth0", true],
        ["fe80::/10", "fec0::1", false],
        ["64:ff9b::/96", "64:ff9b::203.0.113.7", true],
        ["64:ff9b::cb00:7107", "64:ff9b::203.0.113.7", true],
        // A socket for IPv4 and IPv6 reports an IPv4 client as an IPv6 address.
        ["203.0.113.0/24", "::ffff:203.0.113.7", true],
        ["203.0.113.0/24", "::FFFF:cb00:7107", true],
        ["203.0.113.0/24", "::ffff:203.0.114.7", false],
        ["203.0.113.0/24", "::203.0.113.7", false],
        ["0.0.0.0/0", "::ffff:8.8.8.8", true],
        ["::ffff:0:0/96", "::ffff:203.0.113.7", true],
        ["::/0", "::ffff:203.0.113.7", true],
        ["::ffff:203.0.113.0/120", "203.0.113.7", false],
      ];

      test.each(rows)("the block %p with the address %p: %p", (block, address, inside) => {
        check("IpAddress", block, address, inside);
        check("NotIpAddress", block, address, !inside);
      });

      test.each<[string, string]>([
        ["203.0.113.0/33", "203.0.113.0"],
        ["203.0.113.0/-1", "203.0.113.0"],
        ["203.0.113.0/", "203.0.113.0"],
        ["203.0.113.0/24/24", "203.0.113.0"],
        ["203.0.113.0/2 4", "203.0.113.0"],
        ["203.0.113/24", "203.0.113.0"],
        ["203.0.113.256/24", "203.0.113.0"],
        ["203.0.113.0.0/24", "203.0.113.0"],
        ["203.0.113.00/24", "203.0.113.0"],
        ["203.0.113.0/24", "203.0.113.01"],
        ["203.0.113.0/24", "0313.0.113.1"],
        ["2001:db8::/129", "2001:db8::1"],
        ["2001:db8:::/32", "2001:db8::1"],
        ["2001:db8::g/32", "2001:db8::1"],
        ["2001::db8::/32", "2001:db8::1"],
        ["1:2:3:4:5:6:7/32", "1:2:3:4:5:6:7:8"],
        ["1:2:3:4:5:6:7:8:9/32", "1:2:3:4:5:6:7:8"],
        ["1:2:3:4:5:6:7::8/32", "1:2:3:4:5:6:7:8"],
        ["12345::/16", "1234::"],
        ["example.com", "203.0.113.0"],
        ["", "203.0.113.0"],
        ["203.0.113.0/24", "203.0.113"],
        ["203.0.113.0/24", "203.0.113.256"],
        ["203.0.113.0/24", "203.0.113.1/32"],
        ["203.0.113.0/24", "203.0.113.1.1"],
        ["203.0.113.0/24", " 203.0.113.1x"],
        ["203.0.113.0/24", "localhost"],
        ["203.0.113.0/24", ""],
        ["0.0.0.0/0", "1.2.3"],
        ["::/0", "2001:db8:::1"],
        ["::/0", "2001:db8::g"],
        ["::/0", ":1:2:3:4:5:6:7"],
        ["::/0", "::ffff:1.2.3"],
      ])("the block %p does not match the address %p", (block, address) => {
        check("IpAddress", block, address, false);
        check("NotIpAddress", block, address, true);
      });

      test("a missing address", () => {
        check("IpAddress", "0.0.0.0/0", undefined, false);
        check("NotIpAddress", "0.0.0.0/0", undefined, true);
      });
    });

    describe("ARNs", () => {
      const topic = "arn:aws:sns:us-east-1:111122223333:topic";
      test.each<[pattern: string | string[], arn: string, matches: boolean]>([
        [topic, topic, true],
        [topic, "arn:aws:sns:us-east-1:111122223333:other", false],
        [topic, "arn:aws:sns:us-east-1:111122223333:Topic", false],
        [topic, "arn:aws:sns:us-east-1:111122223333:topic:1", false],
        [topic, "ARN:aws:sns:us-east-1:111122223333:topic", false],
        ["arn:aws:sns:*:111122223333:*", topic, true],
        ["arn:aws:sns:*:111122223333:*", "arn:aws:sns:eu-west-1:111122223333:a:b/c", true],
        ["arn:aws:sns:*:111122223333:*", "arn:aws:sns:us-east-1:444455556666:topic", false],
        ["arn:aws:sns:us-*-?:*:t*", topic, true],
        ["arn:aws:sns:us-*-??:*:t*", topic, false],
        ["arn:aws:*:*:*:*", topic, true],
        ["arn:*:*:*:*:*", "arn:aws:s3:::b/a:b", true],
        ["arn:aws:s3:::b/*", "arn:aws:s3:::b/a:b", true],
        ["arn:aws:s3:::b", "arn:aws:s3:::b", true],
        ["arn:aws:s3:::b", "arn:aws:s3:::b/a", false],
        // A wildcard stays in its part of the ARN.
        ["arn:aws:*:topic", topic, false],
        ["arn:aws:sns:*", topic, false],
        ["arn:aws:sns:*:topic", topic, false],
        ["arn:*", topic, false],
        ["*", topic, false],
        ["*", "topic", true],
        ["arn:aws:sns:us-east-1:*:topic", "arn:aws:sns:us-east-1:1111:2222:topic", false],
        ["arn:aws:sns:us-east-1:111122223333:${*}", "arn:aws:sns:us-east-1:111122223333:*", true],
        ["arn:aws:sns:us-east-1:111122223333:${*}", topic, false],
        [["arn:aws:sqs:*:*:*", "arn:aws:sns:*:*:*"], topic, true],
        [["arn:aws:sqs:*:*:*", "arn:aws:s3:*:*:*"], topic, false],
      ])("the pattern %p with %p: %p", (pattern, arn, matches) => {
        check("ArnEquals", pattern, arn, matches);
        check("ArnLike", pattern, arn, matches);
        check("ArnNotEquals", pattern, arn, !matches);
        check("ArnNotLike", pattern, arn, !matches);
      });

      test("a missing ARN", () => {
        check("ArnEquals", topic, undefined, false);
        check("ArnLike", "*", undefined, false);
        check("ArnNotEquals", topic, undefined, true);
        check("ArnNotLike", "*", undefined, true);
      });
    });

    describe("Null", () => {
      test.each<Row>([
        ["Null", "true", undefined, true],
        ["Null", "true", "a", false],
        ["Null", "true", "", false],
        ["Null", "true", ["a", "b"], false],
        ["Null", "false", "a", true],
        ["Null", "false", "", true],
        ["Null", "false", ["a", "b"], true],
        ["Null", "false", undefined, false],
        ["Null", true, undefined, true],
        ["Null", true, "a", false],
        ["Null", false, "a", true],
        ["Null", false, undefined, false],
        ["Null", "TRUE", undefined, true],
        ["Null", "False", "a", true],
        ["Null", ["true", "false"], "a", true],
        ["Null", ["true", "false"], undefined, true],
        // A key without values is a missing key.
        ["Null", "true", [], true],
        ["Null", "false", [], false],
      ])("%s %p with %p: %p", check);
    });

    describe("IfExists", () => {
      const topic = "arn:aws:sns:us-east-1:111122223333:topic";
      test.each<[operator: string, expected: unknown, match: string, other: string]>([
        ["StringEquals", "a", "a", "b"],
        ["StringNotEquals", "a", "b", "a"],
        ["StringEqualsIgnoreCase", "a", "A", "b"],
        ["StringNotEqualsIgnoreCase", "a", "b", "A"],
        ["StringLike", "a*", "ab", "b"],
        ["StringNotLike", "a*", "b", "ab"],
        ["NumericEquals", 10, "10", "11"],
        ["NumericNotEquals", 10, "11", "10"],
        ["NumericLessThan", 10, "9", "10"],
        ["NumericLessThanEquals", 10, "10", "11"],
        ["NumericGreaterThan", 10, "11", "10"],
        ["NumericGreaterThanEquals", 10, "10", "9"],
        ["DateEquals", "2024-01-01", "2024-01-01T00:00:00Z", "2024-01-02"],
        ["DateNotEquals", "2024-01-01", "2024-01-02", "2024-01-01T00:00:00Z"],
        ["DateLessThan", "2024-01-01", "2023-12-31", "2024-01-01"],
        ["DateLessThanEquals", "2024-01-01", "2024-01-01", "2024-01-02"],
        ["DateGreaterThan", "2024-01-01", "2024-01-02", "2024-01-01"],
        ["DateGreaterThanEquals", "2024-01-01", "2024-01-01", "2023-12-31"],
        ["Bool", "true", "true", "false"],
        ["BinaryEquals", "aGVsbG8=", "aGVsbG8=", "d29ybGQ="],
        ["IpAddress", "10.0.0.0/8", "10.0.0.1", "11.0.0.1"],
        ["NotIpAddress", "10.0.0.0/8", "11.0.0.1", "10.0.0.1"],
        ["ArnEquals", topic, topic, topic + "2"],
        ["ArnLike", "arn:aws:sns:*:*:*", topic, "arn:aws:sqs:us-east-1:111122223333:queue"],
        ["ArnNotEquals", topic, topic + "2", topic],
        ["ArnNotLike", "arn:aws:sns:*:*:*", "arn:aws:sqs:us-east-1:111122223333:queue", topic],
      ])("%s", (operator, expected, match, other) => {
        check(operator, expected, match, true);
        check(operator, expected, other, false);
        check(operator + "IfExists", expected, match, true);
        check(operator + "IfExists", expected, other, false);
        check(operator + "IfExists", expected, undefined, true);
        check(operator + "IfExists", expected, [], true);
        check("ForAnyValue:" + operator + "IfExists", expected, undefined, true);
        check("ForAllValues:" + operator + "IfExists", expected, undefined, true);
      });
    });

    describe("a key with more than one value", () => {
      test.each<Row>([
        ["StringEquals", "a", ["b", "a"], true],
        ["StringEquals", "a", ["b", "c"], false],
        ["StringEquals", ["a", "x"], ["b", "x"], true],
        ["StringEquals", "a", [], false],
        ["StringLike", "a*", ["b", "ab"], true],
        ["StringLike", "a*", ["b", "c"], false],
        ["NumericLessThan", 10, ["20", "5"], true],
        ["NumericLessThan", 10, ["20", "15"], false],
        ["IpAddress", "10.0.0.0/8", ["203.0.113.7", "10.0.0.1"], true],
        // A negated operator holds when each value is different from each listed value.
        ["StringNotEquals", "a", ["b", "c"], true],
        ["StringNotEquals", "a", ["b", "a"], false],
        ["StringNotEquals", ["a", "b"], ["c", "b"], false],
        ["StringNotEquals", "a", [], true],
        ["StringNotLike", "a*", ["b", "c"], true],
        ["StringNotLike", "a*", ["b", "ab"], false],
        ["NumericNotEquals", 10, ["9", "11"], true],
        ["NumericNotEquals", 10, ["9", "10.0"], false],
        ["NotIpAddress", "10.0.0.0/8", ["203.0.113.7", "192.0.2.1"], true],
        ["NotIpAddress", "10.0.0.0/8", ["203.0.113.7", "10.0.0.1"], false],

        ["ForAllValues:StringEquals", ["a", "b"], ["a"], true],
        ["ForAllValues:StringEquals", ["a", "b"], ["b", "a", "a"], true],
        ["ForAllValues:StringEquals", ["a", "b"], ["a", "c"], false],
        ["ForAllValues:StringEquals", ["a", "b"], "a", true],
        ["ForAllValues:StringEquals", ["a", "b"], "c", false],
        ["ForAllValues:StringEquals", ["a", "b"], [], true],
        ["ForAllValues:StringEquals", ["a", "b"], undefined, true],
        ["ForAllValues:StringEquals", [], ["a"], false],
        ["ForAllValues:StringEquals", [], undefined, true],
        ["ForAllValues:StringLike", "team-*", ["team-a", "team-b"], true],
        ["ForAllValues:StringLike", "team-*", ["team-a", "other"], false],
        ["ForAllValues:StringNotEquals", ["a", "b"], ["c", "d"], true],
        ["ForAllValues:StringNotEquals", ["a", "b"], ["c", "a"], false],
        ["ForAllValues:StringNotEquals", ["a", "b"], undefined, true],
        ["ForAllValues:NumericLessThan", 10, ["1", "9"], true],
        ["ForAllValues:NumericLessThan", 10, ["1", "10"], false],
        ["ForAllValues:IpAddress", ["10.0.0.0/8", "192.0.2.0/24"], ["10.1.1.1", "192.0.2.9"], true],
        ["ForAllValues:IpAddress", ["10.0.0.0/8", "192.0.2.0/24"], ["10.1.1.1", "192.0.3.9"], false],

        ["ForAnyValue:StringEquals", ["a", "b"], ["c", "a"], true],
        ["ForAnyValue:StringEquals", ["a", "b"], ["c", "d"], false],
        ["ForAnyValue:StringEquals", ["a", "b"], "b", true],
        ["ForAnyValue:StringEquals", ["a", "b"], "c", false],
        ["ForAnyValue:StringEquals", ["a", "b"], [], false],
        ["ForAnyValue:StringEquals", ["a", "b"], undefined, false],
        ["ForAnyValue:StringLike", "team-*", ["other", "team-b"], true],
        ["ForAnyValue:StringLike", "team-*", ["other", "Team-b"], false],
        ["ForAnyValue:StringNotEquals", ["a", "b"], ["a", "c"], true],
        ["ForAnyValue:StringNotEquals", ["a", "b"], ["a", "b"], false],
        ["ForAnyValue:StringNotEquals", ["a", "b"], undefined, false],
        ["ForAnyValue:NumericGreaterThan", 10, ["1", "11"], true],
        ["ForAnyValue:NumericGreaterThan", 10, ["1", "10"], false],
        ["ForAnyValue:StringEqualsIfExists", "a", ["b", "a"], true],
        ["ForAnyValue:StringEqualsIfExists", "a", ["b", "c"], false],
        ["ForAllValues:StringEqualsIfExists", "a", ["a", "b"], false],
      ])("%s %p with %p: %p", check);
    });

    describe("a block with more than one condition", () => {
      const twoOperators = {
        StringEquals: { "s3:x-amz-acl": "public-read" },
        IpAddress: { "aws:SourceIp": "10.0.0.0/8" },
      };
      const twoKeys = { StringEquals: { "s3:x-amz-acl": "public-read", "s3:prefix": ["a/", "b/"] } };

      test.each<[string, Document, PolicyRequest["context"], boolean]>([
        ["operators that hold", twoOperators, { "s3:x-amz-acl": "public-read", "aws:SourceIp": "10.1.2.3" }, true],
        [
          "a first operator that does not hold",
          twoOperators,
          { "s3:x-amz-acl": "private", "aws:SourceIp": "10.1.2.3" },
          false,
        ],
        [
          "a second operator that does not hold",
          twoOperators,
          { "s3:x-amz-acl": "public-read", "aws:SourceIp": "11.1.2.3" },
          false,
        ],
        ["an operator with a missing key", twoOperators, { "s3:x-amz-acl": "public-read" }, false],
        ["no keys", twoOperators, {}, false],
        ["keys that hold", twoKeys, { "s3:x-amz-acl": "public-read", "s3:prefix": "b/" }, true],
        ["a first key that does not hold", twoKeys, { "s3:x-amz-acl": "private", "s3:prefix": "b/" }, false],
        ["a second key that does not hold", twoKeys, { "s3:x-amz-acl": "public-read", "s3:prefix": "c/" }, false],
        ["a key that is missing", twoKeys, { "s3:prefix": "a/" }, false],
        [
          "keys that the policy does not name",
          twoKeys,
          { "s3:x-amz-acl": "public-read", "s3:prefix": "a/", "aws:x": "y" },
          true,
        ],
        ["an empty block", {}, {}, true],
        ["an operator without keys", { StringEquals: {} }, {}, true],
      ])("%s", (_, condition, context, expected) => {
        expect(decide(condition, context)).toBe(expected ? "Allow" : undefined);
      });
    });

    describe("names", () => {
      test.each<[string, string]>([
        ["aws:SecureTransport", "aws:SecureTransport"],
        ["aws:SecureTransport", "aws:securetransport"],
        ["aws:securetransport", "aws:SecureTransport"],
        ["AWS:SECURETRANSPORT", "aws:secureTransport"],
        ["s3:x-amz-acl", "S3:X-Amz-Acl"],
      ])("the key %p of the policy is the key %p of the request", (policyKey, requestKey) => {
        const condition = { Bool: { [policyKey]: "true" } };
        expect(decide(condition, { [requestKey]: "true" })).toBe("Allow");
        expect(decide(condition, { [requestKey]: "false" })).toBeUndefined();
        expect(decide(condition, { [requestKey]: undefined })).toBeUndefined();
        expect(decide({ Null: { [policyKey]: "true" } }, { [requestKey]: "true" })).toBeUndefined();
      });

      test("a key is not a prefix and not a pattern", () => {
        const condition = { StringEquals: { "aws:user*": "a", "aws:user": "a" } };
        expect(decide(condition, { "aws:username": "a" })).toBeUndefined();
        expect(decide(condition, { "aws:user": "a" })).toBeUndefined();
        expect(decide(condition, { "aws:user": "a", "aws:user*": "a" })).toBe("Allow");
      });

      test("the values of a key that the context has in two forms are one list", () => {
        const context = { "aws:TagKeys": ["a"], "aws:tagkeys": "b", "AWS:TAGKEYS": undefined };
        expect(decide({ "ForAllValues:StringEquals": { "aws:TagKeys": ["a", "b"] } }, context)).toBe("Allow");
        expect(decide({ "ForAllValues:StringEquals": { "aws:TagKeys": ["a"] } }, context)).toBeUndefined();
        expect(decide({ "ForAllValues:StringEquals": { "aws:TagKeys": ["b"] } }, context)).toBeUndefined();
      });

      test.each([
        "stringequals",
        "STRINGEQUALS",
        "forAnyValue:stringEquals",
        "FORALLVALUES:StringEquals",
        "StringEqualsifexists",
      ])("the operator %p is StringEquals", operator => {
        check(operator, "a", "a", true);
        check(operator, "a", "b", false);
      });
    });

    describe("in a Deny statement", () => {
      const secure = policy(
        statement({ Action: "s3:*", Resource: [ARN, OBJECTS] }),
        statement({
          Effect: "Deny",
          Action: "s3:*",
          Resource: [ARN, OBJECTS],
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        }),
      );

      test.each<[string, PolicyRequest["context"], "Allow" | "Deny"]>([
        ["a request over HTTP", { "aws:SecureTransport": "false" }, "Deny"],
        ["a request over HTTP with other capitals", { "aws:securetransport": "False" }, "Deny"],
        ["a request over HTTPS", { "aws:SecureTransport": "true" }, "Allow"],
        ["a request without the key", {}, "Allow"],
      ])("%s", (_, context, expected) => {
        expect(evaluateBucketPolicy(secure, request({ context }))).toBe(expected);
        expect(evaluateBucketPolicy(secure, request({ context, action: "s3:ListBucket", resource: ARN }))).toBe(
          expected,
        );
      });

      test("a negated operator refuses a request without the key", () => {
        const encrypted = policy(
          statement({ Action: "s3:PutObject" }),
          statement({
            Effect: "Deny",
            Action: "s3:PutObject",
            Condition: { StringNotEquals: { "s3:x-amz-server-side-encryption": ["AES256", "aws:kms"] } },
          }),
        );
        const decisions = ["AES256", "aws:kms", "none", undefined].map(value =>
          evaluateBucketPolicy(
            encrypted,
            request({ action: "s3:PutObject", context: { "s3:x-amz-server-side-encryption": value } }),
          ),
        );
        expect(decisions).toEqual(["Allow", "Allow", "Deny", "Deny"]);
      });

      test("Null refuses a request without the key", () => {
        const required = policy(
          statement({ Action: "s3:PutObject" }),
          statement({
            Effect: "Deny",
            Action: "s3:PutObject",
            Condition: { Null: { "s3:x-amz-server-side-encryption": "true" } },
          }),
        );
        const decisions = ["AES256", undefined].map(value =>
          evaluateBucketPolicy(
            required,
            request({ action: "s3:PutObject", context: { "s3:x-amz-server-side-encryption": value } }),
          ),
        );
        expect(decisions).toEqual(["Allow", "Deny"]);
      });
    });
  });

  test("a statement applies only when each of its elements matches", () => {
    const strict = policy(
      statement({
        Principal: { AWS: alice.accountId },
        Action: "s3:PutObject",
        Resource: ARN + "/uploads/*",
        Condition: { IpAddress: { "aws:SourceIp": "10.0.0.0/8" } },
      }),
    );
    const match: PolicyRequest = {
      principal: alice,
      action: "s3:PutObject",
      resource: ARN + "/uploads/a.txt",
      context: { "aws:SourceIp": "10.1.2.3" },
    };
    const requests: PolicyRequest[] = [
      match,
      { ...match, principal: bob },
      { ...match, principal: undefined },
      { ...match, action: "s3:GetObject" },
      { ...match, resource: ARN + "/other/a.txt" },
      { ...match, context: { "aws:SourceIp": "203.0.113.7" } },
      { ...match, context: {} },
    ];
    expect(requests.map(item => evaluateBucketPolicy(strict, item))).toEqual([
      "Allow",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("evaluates a policy that the parser did not make", () => {
    const manual: BucketPolicy = {
      text: "",
      statements: [
        { effect: "Allow", principal: "*", actions: ["s3:GetObject"], resources: [OBJECTS] },
        { effect: "Deny", principal: { aws: [bob.accountId!] }, actions: ["s3:*"], resources: [OBJECTS] },
      ],
    };
    const decisions = [alice, bob, undefined].map(who => evaluateBucketPolicy(manual, request({ principal: who })));
    expect(decisions).toEqual(["Allow", "Deny", "Allow"]);
    expect(evaluateBucketPolicy({ text: "", statements: [] }, request())).toBeUndefined();
  });

  test("does not change the policy and the request", () => {
    const parsed = policy(statement({ Condition: { "ForAnyValue:StringLike": { "aws:TagKeys": ["a*", "b"] } } }));
    const before = structuredClone(parsed);
    const input = request({ principal: alice, context: { "aws:TagKeys": ["ab", "c"] } });
    const inputBefore = structuredClone(input);
    expect(evaluateBucketPolicy(parsed, input)).toBe("Allow");
    expect(parsed).toEqual(before);
    expect(input).toEqual(inputBefore);
  });
});

describe("isPublicPolicy", () => {
  const vpc = { StringEquals: { "aws:SourceVpc": "vpc-91237329" } };
  const accessPoint = "arn:aws:s3:us-west-2:123456789012:accesspoint/";

  test.each<[string, Document[], boolean]>([
    ["a statement for everyone", [statement()], true],
    ["a statement for everyone on the bucket", [statement({ Action: "s3:ListBucket", Resource: ARN })], true],
    ["a statement for everyone that allows writes", [statement({ Action: "s3:PutObject" })], true],
    ["a statement for AWS *", [statement({ Principal: { AWS: "*" } })], true],
    ["a statement for a list with *", [statement({ Principal: { AWS: [alice.accountId, "*"] } })], true],
    ["a statement for * and a service", [statement({ Principal: { Service: "s3.amazonaws.com", AWS: ["*"] } })], true],
    ["a statement for an account", [statement({ Principal: { AWS: alice.accountId } })], false],
    [
      "a statement for the root of an account",
      [statement({ Principal: { AWS: "arn:aws:iam::111122223333:root" } })],
      false,
    ],
    ["a statement for a canonical user", [statement({ Principal: { CanonicalUser: alice.id } })], false],
    ["a statement for the canonical user *", [statement({ Principal: { CanonicalUser: "*" } })], false],
    ["a statement for a service", [statement({ Principal: { Service: "cloudfront.amazonaws.com" } })], false],
    ["a Deny statement for everyone", [statement({ Effect: "Deny" })], false],
    [
      "a Deny for everyone and an Allow for an account",
      [statement({ Effect: "Deny" }), statement({ Principal: { AWS: alice.accountId } })],
      false,
    ],
    ["an Allow for everyone and a Deny for everyone", [statement(), statement({ Effect: "Deny" })], true],
    [
      "a public statement after a statement that is not public",
      [statement({ Principal: { AWS: alice.accountId } }), statement()],
      true,
    ],
    ["a public statement before a statement that is not public", [statement(), statement({ Condition: vpc })], true],
    [
      "two statements that are not public",
      [statement({ Condition: vpc }), statement({ Principal: { AWS: bob.accountId } })],
      false,
    ],
    [
      "a statement for all but one account",
      [statement({ Principal: undefined, NotPrincipal: { AWS: alice.accountId } })],
      true,
    ],
    [
      "a statement for all but a canonical user",
      [statement({ Principal: undefined, NotPrincipal: { CanonicalUser: alice.id } })],
      true,
    ],
    ["a statement for all but everyone", [statement({ Principal: undefined, NotPrincipal: "*" })], false],
    ["a statement for all but AWS *", [statement({ Principal: undefined, NotPrincipal: { AWS: "*" } })], false],
    [
      "a Deny statement for all but one account",
      [statement({ Effect: "Deny", Principal: undefined, NotPrincipal: { AWS: alice.accountId } })],
      false,
    ],
    [
      "a statement for all but one account in a VPC",
      [statement({ Principal: undefined, NotPrincipal: { AWS: alice.accountId }, Condition: vpc })],
      false,
    ],
  ])("%s", (_, statements, expected) => {
    expect(isPublicPolicy(policy(...statements))).toBe(expected);
  });

  test.each<[string, string]>([
    ["aws:SourceIp", "203.0.113.0/24"],
    ["aws:SourceArn", "arn:aws:sns:us-east-1:111122223333:topic"],
    ["aws:SourceVpc", "vpc-91237329"],
    ["aws:SourceVpce", "vpce-1a2b3c4d"],
    ["aws:SourceOwner", "111122223333"],
    ["aws:SourceAccount", "111122223333"],
    ["aws:userid", "AROAEXAMPLEID:session"],
    ["aws:PrincipalOrgID", "o-a1b2c3d4e5"],
    ["aws:PrincipalArn", "arn:aws:iam::111122223333:role/reader"],
    ["aws:PrincipalAccount", "111122223333"],
    ["s3:x-amz-server-side-encryption-aws-kms-key-id", "arn:aws:kms:us-east-1:111122223333:key/1234"],
    ["s3:DataAccessPointArn", accessPoint + "reader"],
    ["s3:DataAccessPointAccount", "111122223333"],
  ])("a fixed value of %s makes a statement for everyone not public", (key, value) => {
    const conditions: [Document, boolean][] = [
      [{ StringEquals: { [key]: value } }, false],
      [{ StringEquals: { [key]: [value, value + "0"] } }, false],
      [{ StringEquals: { [key.toUpperCase()]: value } }, false],
      [{ StringEquals: { [key.toLowerCase()]: value } }, false],
      [{ stringequals: { [key]: value } }, false],
      [{ StringEqualsIgnoreCase: { [key]: value } }, false],
      [{ StringLike: { [key]: value } }, false],
      [{ "ForAnyValue:StringEquals": { [key]: value } }, false],
      [{ StringEquals: { [key]: value }, Bool: { "aws:SecureTransport": "true" } }, false],
      [{ Bool: { "aws:SecureTransport": "true" }, StringEquals: { "s3:prefix": "a", [key]: value } }, false],
      // These conditions hold for a request that does not have the value.
      [{ StringNotEquals: { [key]: value } }, true],
      [{ StringNotLike: { [key]: value } }, true],
      [{ StringEqualsIfExists: { [key]: value } }, true],
      [{ "ForAllValues:StringEquals": { [key]: value } }, true],
      [{ "ForAnyValue:StringEqualsIfExists": { [key]: value } }, true],
      [{ Null: { [key]: "false" } }, true],
      [{ Null: { [key]: "true" } }, true],
      // These values are not fixed.
      [{ StringLike: { [key]: "*" } }, true],
      [{ StringLike: { [key]: [value, "a*"] } }, true],
      [{ StringLike: { [key]: "a?" } }, true],
      [{ StringEquals: { [key]: "${aws:username}" } }, true],
    ];
    for (const [condition, expected] of conditions) {
      const parsed = policy(statement({ Condition: condition }));
      expect({ condition, isPublic: isPublicPolicy(parsed) }).toEqual({ condition, isPublic: expected });
      const everyone = policy(statement({ Principal: { AWS: "*" }, Condition: condition }));
      expect({ condition, isPublic: isPublicPolicy(everyone) }).toEqual({ condition, isPublic: expected });
    }
  });

  test.each<[string, Document, boolean]>([
    ["the example of AWS with a wildcard", { StringLike: { "aws:SourceVpc": "vpc-*" } }, true],
    ["the example of AWS with a fixed value", vpc, false],
    ["a key that is not in the list", { StringEquals: { "aws:username": "alice" } }, true],
    ["the key aws:Referer", { StringLike: { "aws:Referer": "https://example.com/*" } }, true],
    ["the key aws:SecureTransport", { Bool: { "aws:SecureTransport": "true" } }, true],
    ["the key s3:prefix", { StringEquals: { "s3:prefix": "public/" } }, true],
    ["the key aws:CurrentTime", { DateLessThan: { "aws:CurrentTime": "2030-01-01T00:00:00Z" } }, true],
    ["the key aws:VpcSourceIp", { IpAddress: { "aws:VpcSourceIp": "10.0.0.0/8" } }, true],
    ["an empty block", {}, true],
    ["an operator without keys", { StringEquals: {} }, true],
    ["a fixed ARN with ArnEquals", { ArnEquals: { "aws:SourceArn": "arn:aws:sns:us-east-1:111122223333:t" } }, false],
    ["a fixed ARN with ArnLike", { ArnLike: { "aws:SourceArn": "arn:aws:sns:us-east-1:111122223333:t" } }, false],
    ["an ARN with a wildcard", { ArnLike: { "aws:SourceArn": "arn:aws:sns:*:111122223333:t" } }, true],
    [
      "an ARN that is not the listed one",
      { ArnNotEquals: { "aws:SourceArn": "arn:aws:sns:us-east-1:111122223333:t" } },
      true,
    ],
    ["a user ID for each session of a role", { StringLike: { "aws:userid": "AROAEXAMPLEID:*" } }, true],
    ["each access point of an account", { StringLike: { "s3:DataAccessPointArn": accessPoint + "*" } }, false],
    [
      "access points of an account by pattern",
      { ArnLike: { "s3:DataAccessPointArn": accessPoint + "team-?-*" } },
      false,
    ],
    [
      "access points of each account",
      { StringLike: { "s3:DataAccessPointArn": "arn:aws:s3:us-west-2:*:accesspoint/*" } },
      true,
    ],
    [
      "access points of each region",
      { StringLike: { "s3:DataAccessPointArn": "arn:aws:s3:*:123456789012:accesspoint/*" } },
      true,
    ],
    [
      "access points without an account",
      { StringLike: { "s3:DataAccessPointArn": "arn:aws:s3:us-west-2::accesspoint/*" } },
      true,
    ],
    ["each access point account", { StringLike: { "s3:DataAccessPointAccount": "*" } }, true],
    ["an account that is a number", { StringEquals: { "aws:SourceAccount": 111122223333 } }, false],
  ])("a statement for everyone with %s", (_, condition, expected) => {
    expect(isPublicPolicy(policy(statement({ Condition: condition })))).toBe(expected);
  });

  test.each<[string | string[], boolean]>([
    ["203.0.113.7", false],
    ["203.0.113.7/32", false],
    ["203.0.113.0/24", false],
    ["10.0.0.0/8", false],
    ["10.0.0.0/9", false],
    ["10.0.0.0/7", true],
    ["128.0.0.0/1", true],
    ["0.0.0.0/0", true],
    ["2001:db8::1", false],
    ["2001:db8::1/128", false],
    ["2001:db8::/64", false],
    ["2001:db8::/33", false],
    ["2001:db8::/32", false],
    ["2001:db8::/31", true],
    ["2000::/3", true],
    ["::/0", true],
    [["203.0.113.0/24", "2001:db8::/32"], false],
    [["203.0.113.0/24", "0.0.0.0/0"], true],
    [["::/0", "203.0.113.0/24"], true],
    [["10.0.0.0/7", "2001:db8::/31"], true],
  ])("a statement for everyone from the addresses %p: %p", (addresses, expected) => {
    const isPublic = (condition: Document) => isPublicPolicy(policy(statement({ Condition: condition })));
    expect(isPublic({ IpAddress: { "aws:SourceIp": addresses } })).toBe(expected);
    expect(isPublic({ IpAddress: { "aws:sourceip": addresses } })).toBe(expected);
    expect(isPublic({ "ForAnyValue:IpAddress": { "aws:SourceIp": addresses } })).toBe(expected);
    expect(isPublic({ NotIpAddress: { "aws:SourceIp": addresses } })).toBe(true);
    expect(isPublic({ IpAddressIfExists: { "aws:SourceIp": addresses } })).toBe(true);
    expect(isPublic({ "ForAllValues:IpAddress": { "aws:SourceIp": addresses } })).toBe(true);
  });

  test("reads a policy that the parser did not make", () => {
    const manual: BucketPolicy = {
      text: "",
      statements: [{ effect: "Allow", principal: { aws: ["*"] }, actions: ["s3:GetObject"], resources: [OBJECTS] }],
    };
    expect(isPublicPolicy(manual)).toBe(true);
    manual.statements[0].conditions = { StringEquals: { "aws:SourceVpce": ["vpce-1a2b3c4d"] } };
    expect(isPublicPolicy(manual)).toBe(false);
    expect(isPublicPolicy({ text: "", statements: [] })).toBe(false);
  });
});
