// Authentication with AWS Signature Version 4 and the integrity checks of the payload.

import { describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { DEFAULT_CREDENTIALS, SigningClient } from "../index.ts";
import type { RequestOptions, S3ServerOptions, SignedRequest, SigningClientOptions } from "../index.ts";
import { digest, type ChecksumAlgorithm } from "../src/checksums.ts";
import { Query } from "../src/context.ts";
import * as v4 from "../src/signature.ts";
import { parseXml, start, toObject, type TestServer } from "./helpers.ts";

/** The time, the scope and the key of the examples in the AWS documentation. */
const T0 = Date.parse("2013-05-24T00:00:00Z");
const STAMP = "20130524T000000Z";
const SCOPE = "20130524/us-east-1/s3/aws4_request";
const { accessKeyId: KEY, secretAccessKey: SECRET } = DEFAULT_CREDENTIALS;
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/** The bucket of `start()` as a virtual host. With it a request is the same for each port of the server. */
const HOST = "test-bucket.localhost";

const frozen = (offset = 0) => start({ clock: () => new Date(T0 + offset) });
const sha256 = (data: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const sign = (canonical: string) =>
  v4.signString(v4.deriveSigningKey(SECRET, "20130524", "us-east-1"), v4.stringToSign(STAMP, SCOPE, canonical));

type Expected = Record<string, unknown>;
type Edit = (request: SignedRequest) => void;
type Case = [name: string, edit: Edit, expected: Expected];
type PayloadCase = [name: string, options: RequestOptions, edit: Edit, expected: Expected];

const OK: Expected = { status: 200 };
const error = (status: number, Code: string, Message: string, details?: Expected): Expected => {
  return { status, Code, Message, ...details };
};
const denied = (message: string, details?: Expected) => error(403, "AccessDenied", message, details);
const invalidRequest = (message: string) => error(400, "InvalidRequest", message);
const notSigned = (HeadersNotSigned: string) =>
  denied("There were headers present in the request which were not signed", { HeadersNotSigned });
const unknownKey = (AWSAccessKeyId = "AKIAUNKNOWN") => {
  const message = "The AWS Access Key Id you provided does not exist in our records.";
  return error(403, "InvalidAccessKeyId", message, { AWSAccessKeyId });
};
/** SignatureDoesNotMatch. The string to sign starts with the name of the algorithm. */
const mismatch = (algorithm: string, ...more: string[]) => {
  const message =
    "The request signature we calculated does not match the signature you provided. Check your key and signing method.";
  const fields = ["SignatureProvided", "StringToSignBytes", ...more].map(name => [name, expect.any(String)]);
  const StringToSign = expect.stringMatching(new RegExp(`^${algorithm}\n`));
  const strings = { StringToSign, ...Object.fromEntries(fields) };
  return error(403, "SignatureDoesNotMatch", message, { AWSAccessKeyId: KEY, ...strings });
};
const MISMATCH = mismatch("AWS4-HMAC-SHA256", "CanonicalRequest", "CanonicalRequestBytes");

const none: Edit = () => {};
const each = (...edits: Edit[]): Edit => {
  return request => edits.forEach(edit => edit(request));
};
const header = (name: string, value: string | undefined): Edit => {
  return request => void (value === undefined ? delete request.headers[name] : (request.headers[name] = value));
};
const query = (name: string, value: string | undefined): Edit => {
  return request => {
    const url = new URL(request.url);
    if (value === undefined) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    request.url = url.href;
  };
};
const authorization = (pattern: string | RegExp, replacement: string): Edit => {
  return request => header("authorization", request.headers.authorization.replace(pattern, replacement))(request);
};
const body = (change: (body: Buffer) => Uint8Array): Edit => {
  return request => void (request.body = change(Buffer.from(request.body!)));
};
/** Signs the request again, after a change of its headers. */
const resign: Edit = request => {
  const { authorization, ...headers } = request.headers;
  const { pathname, search } = new URL(request.url);
  const names = Object.keys(headers).sort();
  const canonical = v4.canonicalRequest({
    method: request.method,
    canonicalUri: pathname,
    canonicalQueryString: v4.canonicalQueryString(new Query(search.slice(1)).parameters),
    headers: names.map(name => [name, headers[name]]),
    payloadHash: headers["x-amz-content-sha256"],
  });
  const credential = `Credential=${KEY}/${SCOPE}, SignedHeaders=${names.join(";")}, Signature=${sign(canonical)}`;
  request.headers.authorization = "AWS4-HMAC-SHA256 " + credential;
};

/** The status of the response and, for an error, the fields of the error document. */
async function outcome(response: Response): Promise<Expected> {
  const text = await response.text();
  if (response.ok || text === "") return { status: response.status };
  const { RequestId, HostId, ...fields } = toObject(parseXml(text));
  expect([RequestId, "application/xml"]).toEqual(status(response, "x-amz-request-id", "content-type").slice(1));
  return { status: response.status, ...fields };
}

/** The status of the response and the values of the headers. */
function status(response: Response, ...headers: string[]): unknown[] {
  return [response.status, ...headers.map(name => response.headers.get(name))];
}

function send(request: SignedRequest, edit: Edit = none): Promise<Response> {
  edit(request);
  const { url, method, headers, body } = request;
  return fetch(url, { method, headers, body, redirect: "manual" });
}

/** Sends the bytes on a new connection. The server sees the request target and the framing as they are. */
function raw(t: TestServer, head: string[], ...body: (string | Uint8Array)[]): Promise<Response> {
  const { promise, resolve, reject } = Promise.withResolvers<Response>();
  const request = [...head, "Connection: close", "", ""].join("\r\n");
  const socket = connect(t.server.port, "127.0.0.1", () => {
    socket.write(Buffer.concat([request, ...body].map(part => Buffer.from(part))));
  });
  const chunks: Buffer[] = [];
  socket.on("data", chunk => chunks.push(Buffer.from(chunk)));
  socket.on("error", reject);
  socket.on("close", () => {
    const reply = Buffer.concat(chunks);
    const end = reply.indexOf("\r\n\r\n");
    const [status, ...lines] = reply.subarray(0, end).toString("latin1").split("\r\n");
    const headers = lines.map((line): [string, string] => [line.split(":", 1)[0], line.slice(line.indexOf(":") + 1)]);
    resolve(new Response(reply.subarray(end + 4), { status: Number(status.split(" ")[1]), headers }));
  });
  return promise;
}

/** The request line and the headers of a signed request, for `raw`. */
function head(request: SignedRequest, ...more: string[]): string[] {
  const { pathname, search } = new URL(request.url);
  const headers = Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`);
  return [`${request.method} ${pathname}${search} HTTP/1.1`, ...headers, ...more];
}

describe("the examples of the AWS documentation", () => {
  const CONTENT = "Welcome to Amazon S3.";
  const A = Buffer.alloc(66560, "a").toString();
  const BASIC = "host;x-amz-content-sha256;x-amz-date";
  const CHUNKED = { "Host": "s3.amazonaws.com", "x-amz-storage-class": "REDUCED_REDUNDANCY" };
  const LENGTHS = { "Content-Encoding": "aws-chunked", "x-amz-decoded-content-length": "66560" };
  /** The body of the examples: chunks of 65536, 1024 and 0 bytes, then the trailing headers. */
  const chunks = (signatures: string[], ...trailers: string[]) => {
    const [first, second, last] = signatures.map(signature => ";chunk-signature=" + signature);
    const parts = [`10000${first}\r\n${A.slice(0, 65536)}`, `400${second}\r\n${A.slice(0, 1024)}`, "0" + last];
    return [...parts, ...trailers, "", ""].join("\r\n");
  };
  const answers = (status: number, body: unknown) => async (response: Response) => {
    expect<unknown>([response.status, await response.text()]).toEqual([status, body]);
  };
  const lists =
    (...keys: string[]) =>
    async (response: Response) => {
      const { Contents, IsTruncated } = toObject(parseXml(await response.text()));
      expect([IsTruncated, ...Contents.map((object: { Key: string }) => object.Key)]).toEqual(["true", ...keys]);
    };
  const stores = (key: string, content: string, checksum?: string) => async (response: Response, t: TestServer) => {
    const object = t.server.buckets.get("examplebucket")!.current(key);
    const { storageClass, contentEncoding } = object ?? {};
    const stored = [
      storageClass,
      contentEncoding,
      object?.checksum?.value,
      object && Buffer.from(object.data.bytes()).toString(),
    ];
    expect([response.status, ...stored]).toEqual([200, "REDUCED_REDUNDANCY", undefined, checksum, content]);
  };

  // prettier-ignore
  const examples: {
    name: string;
    request: [method: string, target: string, headers?: Record<string, string>, body?: string];
    signed?: [signedHeaders: string, signature: string];
    check: (response: Response, t: TestServer) => Promise<void>;
  }[] = [
    { name: "GET Object", request: ["GET", "/test.txt", { Range: "bytes=0-9" }], check: answers(206, "Welcome to"),
      signed: ["host;range;x-amz-content-sha256;x-amz-date", "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"] },
    { name: "PUT Object", check: stores("test$file.text", CONTENT),
      request: ["PUT", "/test%24file.text", { "Date": "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY", "x-amz-content-sha256": "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072" }, CONTENT],
      signed: ["date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class", "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"] },
    // The bucket has no lifecycle. A request that the server does not authenticate gets 403.
    { name: "GET Bucket Lifecycle", request: ["GET", "/?lifecycle"], check: answers(404, expect.stringContaining("<Code>NoSuchLifecycleConfiguration</Code>")),
      signed: [BASIC, "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"] },
    { name: "GET Bucket (List Objects)", request: ["GET", "/?max-keys=2&prefix=J"], check: lists("Jack", "Jill"),
      signed: [BASIC, "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"] },
    { name: "presigned GET Object", check: answers(200, CONTENT),
      request: ["GET", `/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${KEY}%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404`] },
    { name: "PUT Object in chunks", check: stores("chunkObject.txt", A),
      request: ["PUT", "/examplebucket/chunkObject.txt", { ...CHUNKED, ...LENGTHS, "x-amz-content-sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD", "Content-Length": "66824" },
        chunks(["ad80c730a21e5b8d04586a2213dd63b9a0e99e0e2307b0ade35a65485a288648", "0055627c9e194cb4542bae2aa5492e3c1575bbb81b612b7d234b86a503ef5497", "b6c6ea8a5354eaf15b3cb7646744f4275b71ea724fed81ceb9323e279d449df9"])],
      signed: ["content-encoding;content-length;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-storage-class", "4f232c4386841ef735655705268965c44a0e4690baa4adea153f7db9fa80a0a9"] },
    { name: "PUT Object in chunks with a trailing header", check: stores("chunkObject.txt", A, "sOO8/Q=="),
      request: ["PUT", "/examplebucket/chunkObject.txt", { ...CHUNKED, ...LENGTHS, "x-amz-content-sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER", "x-amz-trailer": "x-amz-checksum-crc32c" },
        chunks(["b474d8862b1487a5145d686f57f013e54db672cee1c953b3010fb58501ef5aa2", "1c1344b170168f8e65b41376b44b20fe354e373826ccbbe2c1d40a8cae51e5c7", "2ca2aba2005185cf7159c6277faf83795951dd77a3a99e6e65d5c9f85863f992"],
          "x-amz-checksum-crc32c:sOO8/Q==", "x-amz-trailer-signature:d81f82fc3505edab99d459891051a732e8730629a2e4a59689829ca17fe2e435")],
      signed: ["content-encoding;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-storage-class;x-amz-trailer", "106e2a8a18243abcf37539882f36619c00e2dfc72633413f02d3b74544bfeb8e"] },
  ];
  test.each(examples)("$name", async ({ request, signed, check }) => {
    await using t = frozen();
    t.server.createBucket("examplebucket");
    for (const key of ["test.txt", "Jack", "Jill", "John"]) {
      expect((await t.client.fetch("PUT", `/examplebucket/${key}`, { body: CONTENT })).status).toBe(200);
    }
    const [method, target, headers, body] = request;
    const value = `AWS4-HMAC-SHA256 Credential=${KEY}/${SCOPE},SignedHeaders=${signed?.[0]},Signature=${signed?.[1]}`;
    const signature = { "x-amz-date": STAMP, "x-amz-content-sha256": EMPTY, "Authorization": value };
    const all = { Host: "examplebucket.s3.amazonaws.com", ...(signed && signature), ...headers };
    await check(await fetch(t.server.url + target, { method, headers: all, body }), t);
  });
});

describe("the Authorization header", () => {
  const malformed = (detail: string, details?: Expected) =>
    error(400, "AuthorizationHeaderMalformed", "The authorization header is malformed; " + detail, details);
  const argument = (message: string, ArgumentName: string, ArgumentValue: string) =>
    error(400, "InvalidArgument", message, { ArgumentName, ArgumentValue });
  const components = malformed(
    "the authorization header requires three components: Credential, SignedHeaders, and Signature.",
  );
  const noDate = denied("AWS authentication requires a valid Date or x-amz-date header");
  const skewed = (RequestTime: string) => {
    const message = "The difference between the request time and the current time is too large.";
    const clock = { ServerTime: "2013-05-24T00:00:00Z", MaxAllowedSkewMilliseconds: "900000" };
    return error(403, "RequestTimeTooSkewed", message, { RequestTime, ...clock });
  };
  const VERSION_2 = "The authorization mechanism you have provided is not supported. Please use AWS4-HMAC-SHA256.";
  const ONE_MECHANISM =
    "Only one auth mechanism allowed; only the X-Amz-Algorithm query parameter, Signature query string parameter or the Authorization header should be specified";
  const PAYLOAD_HASH =
    "x-amz-content-sha256 must be UNSIGNED-PAYLOAD, STREAMING-UNSIGNED-PAYLOAD-TRAILER, STREAMING-AWS4-HMAC-SHA256-PAYLOAD, STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER, STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD, STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD-TRAILER or a valid sha256 value.";
  const uppercase: Edit = request =>
    authorization(/\w+$/, request.headers.authorization.slice(-64).toUpperCase())(request);

  // prettier-ignore
  const cases: Case[] = [
    ["no change", none, OK],
    ["the signature in uppercase", uppercase, OK],
    ["the Date header and no x-amz-date", each(header("x-amz-date", undefined), header("date", new Date(T0).toUTCString()), resign), OK],
    ["no Credential", authorization(/Credential=\S+ /, ""), components],
    ["no SignedHeaders", authorization(/SignedHeaders=\S+ /, ""), components],
    ["no Signature", authorization(/, Signature=.*/, ""), components],
    ["a credential of four parts", authorization("/us-east-1/", "/"), malformed('the Credential is mal-formed; expecting "<YOUR-AKID>/YYYYMMDD/REGION/SERVICE/aws4_request".')],
    ["a scope date of seven digits", authorization("/20130524/", "/2013052/"), malformed('incorrect date format "2013052". This date in the credential must be in the format "yyyyMMdd".')],
    ["another service", authorization("/s3/", "/ec2/"), malformed('incorrect service "ec2". This endpoint belongs to "s3".')],
    ["another terminator", authorization("aws4_request", "aws4_reques"), malformed('incorrect terminal "aws4_reques". This endpoint uses "aws4_request".')],
    ["a scope date that is not the date of the request", authorization("/20130524/", "/20130523/"), malformed('Invalid credential date "20130523". This date is not the same as X-Amz-Date: "20130524".')],
    ["Signature Version 2", header("authorization", `AWS ${KEY}:frJIUN8DYpKDtOLCwo//yllqDzg=`), invalidRequest(VERSION_2)],
    ["Signature Version 2 in the query string and no header", each(header("authorization", undefined), query("AWSAccessKeyId", KEY), query("Signature", "frJIUN8DYpKDtOLCwo//yllqDzg=")), invalidRequest(VERSION_2)],
    ["the Bearer scheme", header("authorization", "Bearer token"), argument("Unsupported Authorization Type", "Authorization", "Bearer token")],
    // The request has no credentials then, and the bucket is private.
    ["no value", header("authorization", ""), denied("Access Denied")],
    ["presigned parameters in the same request", each(query("X-Amz-Algorithm", "AWS4-HMAC-SHA256"), header("authorization", "AWS4-HMAC-SHA256 a")), argument(ONE_MECHANISM, "Authorization", "AWS4-HMAC-SHA256 a")],
    ["no x-amz-content-sha256", header("x-amz-content-sha256", undefined), invalidRequest("Missing required header for this request: x-amz-content-sha256")],
    ["an x-amz-content-sha256 that is not a hash", header("x-amz-content-sha256", EMPTY.slice(1)), argument(PAYLOAD_HASH, "x-amz-content-sha256", EMPTY.slice(1))],
    ["no date", header("x-amz-date", undefined), noDate],
    ["an x-amz-date in another format", header("x-amz-date", "2013-05-24T00:00:00Z"), noDate],
    ["an x-amz-* header that is not signed", header("x-amz-meta-color", "red"), notSigned("x-amz-meta-color")],
    ["host not signed", authorization("SignedHeaders=host;", "SignedHeaders="), notSigned("host")],
    ["an unknown access key", authorization(KEY, "AKIAUNKNOWN"), unknownKey()],
  ];
  test.each(cases)("with %s", async (_name, edit, expected) => {
    await using t = frozen();
    expect(await outcome(await send(t.client.sign("GET", "/", { host: HOST }), edit))).toEqual(expected);
  });

  // prettier-ignore
  const times: [seconds: number, name: string, edit: Edit, expected: Expected][] = [
    [-900, "is valid", none, OK],
    [900, "is valid", none, OK],
    [-901, "is too old", none, skewed("20130523T234459Z")],
    [901, "is too new", none, skewed("20130524T001501Z")],
    // The server looks at the access key and the signature before it looks at the time.
    [901, "has a bad signature", authorization(/\w+$/, "00"), MISMATCH],
    [901, "has an unknown access key", authorization(KEY, "AKIAUNKNOWN"), unknownKey()],
  ];
  test.each(times)("a request at %d seconds from the time of the server %s", async (seconds, _name, edit, expected) => {
    await using t = frozen();
    const request = t.client.sign("GET", "/", { host: HOST, date: new Date(T0 + seconds * 1000) });
    expect(await outcome(await send(request, edit))).toEqual(expected);
  });

  test("with the signature of another secret gets the strings that the server signed", async () => {
    await using t = frozen();
    const other = new SigningClient({ ...t.client, secretAccessKey: "other", clock: () => new Date(T0) });
    const request = other.sign("GET", "/", { host: HOST, query: { prefix: "a b" } });
    const headers = `host:${HOST}\nx-amz-content-sha256:${EMPTY}\nx-amz-date:${STAMP}\n\nhost;x-amz-content-sha256;x-amz-date`;
    const CanonicalRequest = `GET\n/\nprefix=a%20b\n${headers}\n${EMPTY}`;
    const StringToSign = `AWS4-HMAC-SHA256\n${STAMP}\n${SCOPE}\n${sha256(CanonicalRequest)}`;
    const bytes = (text: string) => Buffer.from(text).toString("hex").match(/../g)!.join(" ");
    const strings = { StringToSign, StringToSignBytes: bytes(StringToSign), CanonicalRequest };
    const SignatureProvided = request.headers.authorization.slice(-64);
    const expected = { ...MISMATCH, ...strings, CanonicalRequestBytes: bytes(CanonicalRequest), SignatureProvided };
    expect(await outcome(await send(request))).toEqual(expected);
  });

  const TEMPORARY = { accessKeyId: "ASIATEMPORARY", secretAccessKey: "secret", sessionToken: "the/token+of=the&key" };
  const TOKENS = { credentials: [DEFAULT_CREDENTIALS, TEMPORARY] };
  const EU = { region: "eu-west-1" };
  const badToken = error(400, "InvalidToken", "The provided token is malformed or otherwise invalid.", {
    "Token-0": "x",
  });
  const REGION = "the region 'us-east-1' is wrong; expecting 'eu-west-1'";
  const presignedRegion = "Error parsing the X-Amz-Credential parameter; " + REGION;
  // prettier-ignore
  const clients: [name: string, server: S3ServerOptions, client: Partial<SigningClientOptions>, presigned: boolean, expected: Expected][] = [
    ["the session token of the key", TOKENS, TEMPORARY, false, OK],
    ["the session token of the key in a presigned URL", TOKENS, TEMPORARY, true, OK],
    ["no session token", TOKENS, { ...TEMPORARY, sessionToken: undefined }, false, unknownKey("ASIATEMPORARY")],
    ["another session token", TOKENS, { ...TEMPORARY, sessionToken: "x" }, false, badToken],
    ["another session token in a presigned URL", TOKENS, { ...TEMPORARY, sessionToken: "x" }, true, badToken],
    ["a session token for a key that has none", TOKENS, { sessionToken: "x" }, false, badToken],
    ["the region of the server", EU, EU, false, OK],
    ["another region than the server", EU, { region: "us-east-1" }, false, malformed(REGION, { Region: "eu-west-1" })],
    ["another region than the server in a presigned URL", EU, { region: "us-east-1" }, true, error(400, "AuthorizationQueryParametersError", presignedRegion, { Region: "eu-west-1" })],
    ["a region and a server that has no region", {}, EU, false, OK],
    ["the region auto in a presigned URL and a server that has no region", {}, { region: "auto" }, true, OK],
  ];
  test.each(clients)("with %s", async (_name, server, credentials, presigned, expected) => {
    await using t = start(server);
    const client = new SigningClient({ ...DEFAULT_CREDENTIALS, ...credentials, endpoint: t.server.url });
    const options = { host: HOST, presign: presigned ? { expiresIn: 60 } : undefined };
    expect(await outcome(await client.fetch("GET", "/", options))).toEqual(expected);
  });
});

describe("a presigned URL", () => {
  const parameters = (message: string) => error(400, "AuthorizationQueryParametersError", message);
  const required = parameters(
    "Query-string authentication version 4 requires the X-Amz-Algorithm, X-Amz-Credential, X-Amz-Signature, X-Amz-Date, X-Amz-SignedHeaders, and X-Amz-Expires parameters.",
  );
  const names = ["Algorithm", "Credential", "Signature", "Date", "SignedHeaders", "Expires"];
  const expired = (seconds: number, Expires: string, ServerTime = Expires) =>
    denied("Request has expired", { "X-Amz-Expires": String(seconds), Expires, ServerTime });
  const early = { "X-Amz-Date": "20130524T001501Z", ServerTime: "2013-05-24T00:00:00Z" };
  const lowercase: Edit = request => void (request.url = request.url.replace(/X-Amz-\w+/g, name => name.toLowerCase()));

  test("of Bun.S3Client works for PUT, GET, HEAD and DELETE", async () => {
    await using t = start();
    const key = "dir/a b+c&d=e:f~(g)*'!ü.txt";
    const request = (method: "PUT" | "GET" | "HEAD" | "DELETE", body?: string) =>
      fetch(t.s3.presign(key, { method, expiresIn: 60 }), { method, body });
    const [put, get, head] = [await request("PUT", "presigned"), await request("GET"), await request("HEAD")];
    expect([put.status, get.status, await get.text()]).toEqual([200, 200, "presigned"]);
    expect(status(head, "content-length")).toEqual([200, "9"]);
    expect([...t.server.buckets.get(t.bucket)!.objects.keys()]).toEqual([key]);
    expect([(await request("DELETE")).status, (await request("GET")).status]).toEqual([204, 404]);
  });

  // prettier-ignore
  const cases: Case[] = [
    ["no change", none, OK],
    ...names.map((name): Case => ["no X-Amz-" + name, query("X-Amz-" + name, undefined), required]),
    ["another algorithm", query("X-Amz-Algorithm", "AWS4-HMAC-SHA1"), parameters('X-Amz-Algorithm only supports "AWS4-HMAC-SHA256 and AWS4-ECDSA-P256-SHA256"')],
    ["an X-Amz-Date in another format", query("X-Amz-Date", "2013-05-24T00:00:00Z"), parameters(`X-Amz-Date must be in the ISO8601 Long Format "yyyyMMdd'T'HHmmss'Z'"`)],
    ["X-Amz-Expires=604801", query("X-Amz-Expires", "604801"), parameters("X-Amz-Expires must be less than a week (in seconds); that is, the given X-Amz-Expires must be less than 604800 seconds")],
    ["X-Amz-Expires=-1", query("X-Amz-Expires", "-1"), parameters("X-Amz-Expires must be non-negative")],
    ["X-Amz-Expires=1h", query("X-Amz-Expires", "1h"), parameters("X-Amz-Expires should be a number")],
    ["a credential of another service", query("X-Amz-Credential", `${KEY}/20130524/us-east-1/ec2/aws4_request`), parameters('Error parsing the X-Amz-Credential parameter; incorrect service "ec2". This endpoint belongs to "s3".')],
    ["an unknown access key", query("X-Amz-Credential", `AKIAUNKNOWN/${SCOPE}`), unknownKey()],
    ["another value of a parameter", query("x-id", "GetObject"), MISMATCH],
    ["one more parameter", query("versionId", "null"), MISMATCH],
    ["another path", request => void (request.url = request.url.replace("/key?", "/other?")), MISMATCH],
    ["the names of the parameters in lowercase", lowercase, MISMATCH],
    ["another value of a signed header", header("x-amz-meta-color", "blue"), MISMATCH],
    ["a signed header that the request does not have", header("x-amz-meta-color", undefined), MISMATCH],
    ["an x-amz-* header that is not signed", header("x-amz-meta-size", "1"), notSigned("x-amz-meta-size")],
  ];
  test.each(cases)("with %s", async (_name, edit, expected) => {
    await using t = frozen();
    const options = { query: { "x-id": "PutObject" }, headers: { "x-amz-meta-color": "red" }, body: "presigned" };
    const request = t.client.sign("PUT", "/key", { host: HOST, presign: { expiresIn: 60 }, ...options });
    expect(new URL(request.url).searchParams.get("X-Amz-SignedHeaders")).toBe("host;x-amz-meta-color");
    expect(await outcome(await send(request, edit))).toEqual(expected);
    const metadata = t.server.buckets.get(t.bucket)!.current("key")?.userMetadata;
    expect(metadata).toEqual(expected === OK ? { color: "red" } : undefined);
  });

  // prettier-ignore
  const times: [name: string, signedAt: number, expiresIn: number, now: number, edit: Edit, expected: Expected][] = [
    ["at the end of the last second", 0, 60, 60_000, none, OK],
    ["one millisecond after the end", 0, 60, 60_001, none, expired(60, "2013-05-24T00:01:00Z")],
    ["at the end of 7 days, the longest time", 0, 604800, 604_800_000, none, OK],
    ["one millisecond after 7 days", 0, 604800, 604_800_001, none, expired(604800, "2013-05-31T00:00:00Z")],
    ["never with X-Amz-Expires=0", 0, 0, 0, none, expired(0, "2013-05-24T00:00:00Z")],
    ["15 minutes before X-Amz-Date", 900, 60, 0, none, OK],
    ["more than 15 minutes before X-Amz-Date", 901, 60, 0, none, denied("Request is not yet valid", early)],
    // The server looks at the access key and the signature before it looks at the time.
    ["after the end with a bad signature", 0, 60, 61_000, query("X-Amz-Signature", "00"), MISMATCH],
    ["after the end with an unknown access key", 0, 60, 61_000, query("X-Amz-Credential", `AKIAUNKNOWN/${SCOPE}`), unknownKey()],
  ];
  test.each(times)("is valid from X-Amz-Date on: %s", async (_name, signedAt, expiresIn, now, edit, expected) => {
    await using t = frozen(now);
    const date = new Date(T0 + signedAt * 1000);
    const request = t.client.sign("GET", "/", { host: HOST, date, presign: { expiresIn } });
    expect(await outcome(await send(request, edit))).toEqual(expected);
  });

  test("can have the names of its parameters in another letter case", async () => {
    await using t = frozen();
    const scope = { "x-amz-algorithm": "AWS4-HMAC-SHA256", "X-AMZ-CREDENTIAL": `${KEY}/${SCOPE}`, "x-amz-date": STAMP };
    const parameters = Object.entries({ ...scope, "x-amz-expires": "60", "X-Amz-Signedheaders": "host" });
    const search = v4.canonicalQueryString(parameters.map(([name, value]) => ({ name, value })));
    const signature = sign(`GET\n/\n${search}\nhost:${HOST}\n\nhost\nUNSIGNED-PAYLOAD`);
    const target = `${t.server.url}/?${search}&x-amz-SIGNATURE=${signature}`;
    expect(await outcome(await fetch(target, { headers: { Host: HOST } }))).toEqual(OK);
  });

  test("signs the response-* parameters", async () => {
    await using t = start();
    await t.s3.write("key", "content", { type: "text/plain" });
    const type = { "response-content-type": "text/x-test" };
    const overrides = { ...type, "response-content-disposition": 'attachment; filename="a b"' };
    const request = () => t.client.sign("GET", "/key", { host: HOST, presign: { expiresIn: 60 }, query: overrides });
    const expected = [200, "text/x-test", 'attachment; filename="a b"'];
    expect(status(await send(request()), "content-type", "content-disposition")).toEqual(expected);
    expect(await outcome(await send(request(), query("response-content-type", "text/html")))).toEqual(MISMATCH);
  });
});

describe("the canonical request", () => {
  // prettier-ignore
  const targets: [target: string, uri: string, search: string][] = [
    ["/test-bucket?b=2&a=1", "/test-bucket", "a=1&b=2"],
    ["/test-bucket?a=2&a=1&a=&A=3", "/test-bucket", "A=3&a=&a=1&a=2"],
    ["/test-bucket?acl&b=", "/test-bucket", "acl=&b="],
    ["/test-bucket?a=b+c&d=e%2Bf&g=%20", "/test-bucket", "a=b%20c&d=e%2Bf&g=%20"],
    // The order is the order of the names. It is not the order of the pairs as text: "-" and "." are below "=".
    ["/test-bucket?k=1&k-x=2&k.y=3&k0=4", "/test-bucket", "k=1&k-x=2&k.y=3&k0=4"],
    ["/test-bucket?k=%c3%bc~!*'()&l=a=b&m=a:b/c", "/test-bucket", "k=%C3%BC~%21%2A%27%28%29&l=a%3Db&m=a%3Ab%2Fc"],
    ["/test-bucket/a%20b/a+b", "/test-bucket/a%20b/a%2Bb", ""],
    ["/test-bucket/%c3%bc/%E4%B8%AD", "/test-bucket/%C3%BC/%E4%B8%AD", ""],
    ["/test-bucket/!*'()~=&:@$,;", "/test-bucket/%21%2A%27%28%29~%3D%26%3A%40%24%2C%3B", ""],
    ["/test-bucket/%21%2A%27%28%29%7E%3D%26%3A", "/test-bucket/%21%2A%27%28%29~%3D%26%3A", ""],
    ["/test-bucket/100%25/100%", "/test-bucket/100%25/100%25", ""],
    ["/test-bucket//a//b/", "/test-bucket//a//b/", ""],
  ];
  test.each(targets)("of %s has the URI %s and the query string %j", async (target, uri, search) => {
    await using t = frozen();
    const signed = "host;x-amz-content-sha256;x-amz-date;x-amz-meta-s";
    const credential = `AWS4-HMAC-SHA256 Credential=${KEY}/${SCOPE}, SignedHeaders=${signed}, Signature=00`;
    const headers = ["host:s3.amazonaws.com", "x-amz-content-sha256:UNSIGNED-PAYLOAD", `x-amz-date:${STAMP}`];
    // The canonical value of a header has no spaces at its ends and one space where the value has more.
    const lines = [...headers, "x-amz-meta-s:  a   b \t c  ", "Authorization: " + credential];
    const canonical = ["GET", uri, search, ...headers, "x-amz-meta-s:a b c", "", signed, "UNSIGNED-PAYLOAD"];
    const response = await raw(t, [`GET ${target} HTTP/1.1`, ...lines]);
    expect(await outcome(response)).toEqual({ ...MISMATCH, CanonicalRequest: canonical.join("\n") });
  });

  const keys = ["a b", "a+b", "ü/中", "100%", "!*'()", "a~b", "a=b&c", "a:b@c$d,e;f", "a//b", "a?b#c"];
  test.each(keys)("of Bun.S3Client is the same for the key %j", async key => {
    await using t = start();
    await t.s3.write(key, "content");
    expect(await t.s3.file(key).text()).toBe("content");
    expect((await t.s3.list({ prefix: key })).contents?.map(object => object.key)).toEqual([key]);
    expect(t.server.requests.map(request => request.status)).toEqual([200, 200, 200]);
  });
});

describe("the payload", () => {
  const DATA = "123456789";
  const MD5 = "JfnnlDI7RTiF9RgfG2JNCw==";
  const CRC32 = { "x-amz-checksum-crc32": "y/Q5Jg==" };
  const CRC32C = { "x-amz-checksum-crc32c": "4waSgw==" };
  const md5 = (value: string): RequestOptions => ({ headers: { "content-md5": value } });
  const algorithm = (name: string, headers = {}): RequestOptions => {
    return { headers: { ...headers, "x-amz-sdk-checksum-algorithm": name } };
  };
  const put = (t: TestServer, options: RequestOptions, edit?: Edit) =>
    send(t.client.sign("PUT", "/key", { host: HOST, body: DATA, ...options }), edit).then(outcome);
  const other = body(() => Buffer.from("987654321"));
  const badDigest = (algorithm: string) =>
    error(400, "BadDigest", `The ${algorithm} you specified did not match the calculated checksum.`);
  const invalidDigest = (value: string) =>
    error(400, "InvalidDigest", "The Content-MD5 you specified was invalid.", { "Content-MD5": value });
  const single = invalidRequest("Expecting a single x-amz-checksum- header. Multiple checksum Types are not allowed.");
  const hashes = { ClientComputedContentSHA256: sha256(DATA), S3ComputedContentSHA256: sha256("987654321") };
  const digests = { ExpectedDigest: "1B2M2Y8AsgTpgAmY7PhCfg==", CalculatedDigest: MD5 };

  // prettier-ignore
  const cases: PayloadCase[] = [
    ["the SHA-256 of the content", {}, none, OK],
    ["the SHA-256 of other content", {}, other, error(400, "XAmzContentSHA256Mismatch", "The provided 'x-amz-content-sha256' header does not match what was computed.", hashes)],
    ["UNSIGNED-PAYLOAD", { payload: "unsigned" }, other, OK],
    ["the Content-MD5 of the content", md5(MD5), none, OK],
    ["the Content-MD5 of other content", md5("1B2M2Y8AsgTpgAmY7PhCfg=="), none, error(400, "BadDigest", "The Content-MD5 you specified did not match what we received.", digests)],
    ["a Content-MD5 that is not base64", md5("not base64!"), none, invalidDigest("not base64!")],
    ["a Content-MD5 of 11 bytes", md5("YWJyYWNhZGFicmE="), none, invalidDigest("YWJyYWNhZGFicmE=")],
    ["a Content-MD5 in hexadecimal", md5("25f9e794323b453885f5181f1b624d0b"), none, invalidDigest("25f9e794323b453885f5181f1b624d0b")],
    ["an empty Content-MD5", md5(""), none, invalidDigest("")],
    ["two checksums", { headers: { ...CRC32, ...CRC32C } }, none, single],
    ["a checksum in a header and one in a trailer", { headers: CRC32, payload: "streaming-trailer", trailers: CRC32C }, none, single],
    ["an algorithm and no checksum", algorithm("CRC32"), none, invalidRequest("x-amz-sdk-checksum-algorithm specified, but no corresponding x-amz-checksum-* or x-amz-trailer headers were found.")],
    ["an algorithm and the checksum of another one", algorithm("SHA256", CRC32), none, badDigest("SHA256")],
    ["an algorithm that the server does not have", algorithm("MD4", CRC32), none, invalidRequest("Checksum algorithm provided is unsupported. Please try again with any of the valid types: [CRC32, CRC32C, CRC64NVME, SHA1, SHA256]")],
    ["x-amz-trailer and no trailer", { headers: { "x-amz-trailer": "x-amz-checksum-crc32" }, payload: "streaming" }, resign, error(400, "MalformedTrailerError", "The request contained trailing data that was not well-formed or did not conform to our published schema.")],
    ["a trailer that is not a checksum", { payload: "streaming-unsigned-trailer", trailers: { "x-amz-checksum-crc32": "y/Q5Jg" } }, none, invalidRequest("Value for x-amz-checksum-crc32 trailing header is invalid.")],
  ];
  test.each(cases)("with %s", async (_name, options, edit, expected) => {
    await using t = frozen();
    expect(await put(t, options, edit)).toEqual(expected);
    expect(t.server.buckets.get(t.bucket)!.current("key")?.size).toBe(expected === OK ? 9 : undefined);
  });

  test("with the headers that the official SDK sends for a string or a buffer", async () => {
    await using t = start();
    const request = t.client.sign("PUT", "/key", { host: HOST, body: DATA, ...algorithm("CRC32", CRC32) });
    const sent = { ...CRC32, "x-amz-content-sha256": sha256(DATA), "x-amz-sdk-checksum-algorithm": "CRC32" };
    expect(request.headers).toMatchObject(sent);
    const response = await send(request);
    expect(status(response, "x-amz-checksum-crc32", "x-amz-checksum-type")).toEqual([200, "y/Q5Jg==", "FULL_OBJECT"]);
  });

  // prettier-ignore
  const checksums: [ChecksumAlgorithm, check: string][] = [
    ["CRC32", "cbf43926"],
    ["CRC32C", "e3069283"],
    ["CRC64NVME", "ae8b14860a799888"],
    ["SHA1", "f7c3bc1d808e04732adf679965ccc34ca7ae3441"],
    ["SHA256", "15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225"],
  ];
  test.each(checksums)("with a checksum of the algorithm %s", async (algorithm, check) => {
    // The check value of the algorithm, for the data in one piece and in more than one.
    const bytes = Buffer.from(DATA);
    const pieces = [bytes.subarray(0, 4), bytes.subarray(4, 4), bytes.subarray(4)];
    expect([digest(algorithm, bytes), digest(algorithm, pieces)].map(value => value.toString("hex"))).toEqual([
      check,
      check,
    ]);

    await using t = start();
    const name = "x-amz-checksum-" + algorithm.toLowerCase();
    const value = Buffer.from(check, "hex").toString("base64");
    const wrong = Buffer.alloc(check.length / 2, 1).toString("base64");
    const invalid = invalidRequest(`Value for ${name} header is invalid.`);
    expect(await put(t, { headers: { [name]: wrong } })).toEqual(badDigest(algorithm));
    expect(await put(t, { headers: { [name]: check } })).toEqual(invalid);
    expect(await put(t, { headers: { [name]: value.replace(/=+$/, "") } })).toEqual(invalid);
    for (const payload of ["streaming-trailer", "streaming-unsigned-trailer"] as const) {
      expect(await put(t, { payload, trailers: { [name]: wrong } })).toEqual(badDigest(algorithm));
      expect(await put(t, { payload, trailers: { [name]: value } })).toEqual(OK);
    }
    const response = await t.client.fetch("PUT", "/key", { host: HOST, body: DATA, headers: { [name]: value } });
    const head = await t.client.fetch("HEAD", "/key", { host: HOST, headers: { "x-amz-checksum-mode": "ENABLED" } });
    expect(status(response, name, "x-amz-checksum-type")).toEqual([200, value, "FULL_OBJECT"]);
    expect(status(head, name, "x-amz-checksum-type")).toEqual([200, value, "FULL_OBJECT"]);
  });
});

describe("an aws-chunked body", () => {
  const DATA = Buffer.alloc(2 * 8192 + 100, "c");
  const CRC32C = { "x-amz-checksum-crc32c": digest("CRC32C", DATA).toString("base64") };
  const signed: RequestOptions = { payload: "streaming" };
  const unsigned: RequestOptions = { payload: "streaming-unsigned-trailer" };
  const trailer: RequestOptions = { payload: "streaming-trailer", trailers: CRC32C };
  const incomplete = error(400, "IncompleteBody", "The request body terminated unexpectedly");
  const tooSmall = (details: Expected) =>
    error(403, "InvalidChunkSizeError", "Only the last chunk is allowed to have a size less than 8192 bytes", details);
  /** Changes the first character after the text, at the place where the text occurs for the time `index`. */
  const corrupt = (text: string, index = 0) => {
    return body(body => {
      let at = -1;
      for (let i = 0; i <= index; i++) at = body.indexOf(text, at + 1);
      body[at + text.length] = body[at + text.length] === 0x30 ? 0x31 : 0x30;
      return body;
    });
  };
  const decoded = (length?: number) => each(header("x-amz-decoded-content-length", length?.toString()), resign);

  // prettier-ignore
  const cases: PayloadCase[] = [
    ["signed chunks", signed, none, OK],
    ["a bad signature of the first chunk", signed, corrupt("chunk-signature=", 0), mismatch("AWS4-HMAC-SHA256-PAYLOAD")],
    ["a bad signature of a later chunk", signed, corrupt("chunk-signature=", 2), mismatch("AWS4-HMAC-SHA256-PAYLOAD")],
    ["a bad signature of the final chunk", signed, corrupt("chunk-signature=", 3), mismatch("AWS4-HMAC-SHA256-PAYLOAD")],
    ["a signed trailer", trailer, none, OK],
    ["a bad signature of the trailer", trailer, corrupt("x-amz-trailer-signature:"), mismatch("AWS4-HMAC-SHA256-TRAILER")],
    ["a trailer and no signatures", { ...unsigned, trailers: CRC32C }, none, OK],
    ["a last chunk below 8192 bytes", signed, none, OK],
    ["a chunk below 8192 bytes that is not the last one", { ...signed, chunkSize: 8191 }, none, tooSmall({ Chunk: "1", BadChunkSize: "8191" })],
    ["no signatures and a chunk below 8192 bytes that is not the last one", { ...unsigned, chunkSize: 100 }, none, tooSmall({ Chunk: "1", BadChunkSize: "100" })],
    ["an empty object", { ...signed, body: "" }, none, OK],
    ["a body that ends before the final chunk", signed, body(body => body.subarray(0, body.lastIndexOf("0;chunk-signature="))), incomplete],
    ["a decoded length above the length of the content", unsigned, decoded(DATA.length + 1), incomplete],
    ["a decoded length below the length of the content", unsigned, decoded(DATA.length - 1), incomplete],
    ["no decoded length", unsigned, decoded(), error(411, "MissingContentLength", "You must provide the Content-Length HTTP header.")],
  ];
  test.each(cases)("with %s", async (_name, options, edit, expected) => {
    await using t = frozen();
    const request = t.client.sign("PUT", "/key", { host: HOST, body: DATA, chunkSize: 8192, ...options });
    expect(await outcome(await send(request, edit))).toEqual(expected);
    const object = t.server.buckets.get(t.bucket)!.current("key");
    expect(object && sha256(object.data.bytes())).toBe(expected === OK ? sha256(options.body ?? DATA) : undefined);
  });

  // prettier-ignore
  const encodings: [sent: string, payload: RequestOptions["payload"], stored: string | null][] = [
    ["aws-chunked", "streaming", null],
    ["aws-chunked,gzip", "streaming-unsigned-trailer", "gzip"],
    ["gzip, aws-chunked", "sha256", "gzip"],
    ["aws-chunked, aws-chunked", "unsigned", null],
    ["deflate, gzip", "sha256", "deflate, gzip"],
  ];
  test.each(encodings)("with the Content-Encoding %j and the payload %s", async (sent, payload, stored) => {
    await using t = start();
    // The client puts aws-chunked in front of the encodings of a streaming body.
    const encoding = payload!.startsWith("streaming") ? sent.slice("aws-chunked,".length) : sent;
    const headers: Record<string, string> = encoding === "" ? {} : { "content-encoding": encoding };
    const request = t.client.sign("PUT", "/key", { host: HOST, body: "content", payload, headers });
    expect(request.headers["content-encoding"]).toBe(sent);
    expect(await outcome(await send(request))).toEqual(OK);
    expect(status(await t.client.fetch("HEAD", "/key", { host: HOST }), "content-encoding")).toEqual([200, stored]);
  });
});

describe("the framing of the body", () => {
  const frames = (body: Uint8Array) => [body.length.toString(16) + "\r\n", body, "\r\n0\r\n\r\n"];

  test("the official SDK sends a stream as an aws-chunked body in the chunked transfer coding", async () => {
    await using t = start();
    const body = Buffer.alloc(20000, "s");
    const trailers = { "x-amz-checksum-crc32": digest("CRC32", body).toString("base64") };
    const headers = { "x-amz-sdk-checksum-algorithm": "CRC32", "content-type": "application/octet-stream" };
    const options = { host: HOST, body, headers, chunkSize: 20000, trailers } as const;
    const request = t.client.sign("PUT", "/key", { ...options, payload: "streaming-unsigned-trailer" });
    expect(request.headers).toMatchObject({
      "content-encoding": "aws-chunked",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "x-amz-decoded-content-length": "20000",
      "x-amz-trailer": "x-amz-checksum-crc32",
    });
    const response = await raw(t, head(request, "Transfer-Encoding: chunked"), ...frames(request.body!));
    expect(status(response, "x-amz-checksum-crc32")).toEqual([200, trailers["x-amz-checksum-crc32"]]);
    expect(await t.s3.file("key").text()).toBe(body.toString());
  });

  test("the chunked transfer coding around a body that is not aws-chunked is NotImplemented", async () => {
    await using t = start();
    const request = t.client.sign("PUT", "/key", { host: HOST, body: "content" });
    const response = await raw(t, head(request, "Transfer-Encoding: chunked"), ...frames(request.body!));
    const message = "A header you provided implies functionality that is not implemented";
    expect(await outcome(response)).toEqual(error(501, "NotImplemented", message, { Header: "Transfer-Encoding" }));
  });

  test("a PUT without Content-Length and without Transfer-Encoding is MissingContentLength", async () => {
    await using t = start();
    const response = await raw(t, head(t.client.sign("PUT", "/key", { host: HOST, payload: "unsigned" })));
    const message = "You must provide the Content-Length HTTP header.";
    expect(await outcome(response)).toEqual(error(411, "MissingContentLength", message));
  });
});
