// Helpers for the tests of the s3-server package.

import { expect, setDefaultTimeout } from "bun:test";
import { isDebug } from "harness";
import {
  serve,
  SigningClient,
  type RequestOptions,
  type S3Server,
  type S3ServerOptions,
  type SigningClientOptions,
} from "../index.ts";
import { child, children, childText, parseXml, type XmlElement } from "../src/xml.ts";

export { child, children, childText, parseXml, type XmlElement };

// The server and the signing client are JavaScript. A debug build of Bun runs
// them about 100 times slower than a release build.
if (isDebug) setDefaultTimeout(60_000);

/**
 * A debug build of Bun adds `content-type: application/octet-stream` to a
 * response of `Bun.serve` that has no body. A release build does not. This
 * function removes that header, so that a test sees the response of a release build.
 */
export function withoutDefaultType(response: Response): Response {
  const length = response.headers.get("content-length");
  const hasBody = length !== null && length !== "0";
  if (hasBody || response.headers.get("content-type") !== "application/octet-stream") return response;
  const headers = new Headers(response.headers);
  headers.delete("content-type");
  const { status, statusText } = response;
  return new Response(status === 204 || status === 304 ? null : response.body, { status, statusText, headers });
}

/** A `SigningClient` for the tests of this package. */
export class TestClient extends SigningClient {
  constructor(options: SigningClientOptions) {
    super(options);
  }

  override async fetch(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    return withoutDefaultType(await super.fetch(method, path, options));
  }
}

export interface TestServer extends AsyncDisposable {
  server: S3Server;
  /** A client that signs with the first credential of the server. */
  client: SigningClient;
  /** A `Bun.S3Client` for the bucket `bucket`. */
  s3: Bun.S3Client;
  /** The name of a bucket that exists. */
  bucket: string;
}

/** Starts a server that has one bucket. */
export function start(options: S3ServerOptions = {}): TestServer {
  const bucket = "test-bucket";
  const server = serve({ buckets: [bucket], ...options });
  const { accessKeyId, secretAccessKey, sessionToken } = server.credentials;
  return {
    server,
    bucket,
    client: new TestClient({
      endpoint: server.url,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region: options.region,
      clock: options.clock,
    }),
    s3: new Bun.S3Client(server.clientOptions(bucket)),
    [Symbol.asyncDispose]: () => server.stop(),
  };
}

/** The body of a response as an XML element. */
export async function xml(response: Response): Promise<XmlElement> {
  return parseXml(await response.text());
}

/** The children of an XML element as an object. An element that occurs more than once is an array. */
export function toObject(element: XmlElement): any {
  if (element.children.length === 0) return element.text;
  const out: Record<string, any> = {};
  for (const item of element.children) {
    const value = toObject(item);
    if (item.name in out) {
      if (!Array.isArray(out[item.name])) out[item.name] = [out[item.name]];
      out[item.name].push(value);
    } else {
      out[item.name] = value;
    }
  }
  return out;
}

/** Checks that the response is the S3 error with that status and code. Returns the `<Error>` document as an object. */
export async function expectError(response: Response, status: number, code: string): Promise<Record<string, string>> {
  const text = await response.text();
  const root = text === "" ? undefined : parseXml(text);
  const error = root ? toObject(root) : {};
  expect({ status: response.status, code: error.Code, root: root?.name }).toEqual({ status, code, root: "Error" });
  expect(response.headers.get("content-type")).toBe("application/xml");
  expect(error.RequestId).toBe(response.headers.get("x-amz-request-id")!);
  return error;
}

/** Checks that the request succeeded. It prints the error document of a request that failed. */
export async function expectStatus(response: Response, status: number): Promise<Response> {
  if (response.status !== status) {
    expect({ status: response.status, body: await response.clone().text() }).toEqual({
      status,
      body: expect.anything(),
    });
  }
  return response;
}

/** A name for a key or a bucket that no other test uses. */
export function unique(prefix = "key"): string {
  return `${prefix}-${Bun.randomUUIDv7()}`;
}
