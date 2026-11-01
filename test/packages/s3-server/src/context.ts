// What a handler knows about the request it serves, and the helpers that
// build the responses.

import { httpDate, percentDecodeToString } from "./encoding.ts";
import { S3Error, type S3ErrorDetails } from "./errors.ts";
import type { S3Server } from "./server.ts";
import type { Authentication, Owner, QueryParameter } from "./signature.ts";
import type { Bucket } from "./store.ts";
import { xmlDocument, type XmlAttributes, type XmlNode } from "./xml.ts";

/** The query string of a request. */
export class Query {
  readonly parameters: QueryParameter[];

  constructor(raw: string) {
    this.parameters = [];
    if (raw === "") return;
    for (const part of raw.split("&")) {
      if (part === "") continue;
      const equals = part.indexOf("=");
      const name = percentDecodeToString(equals === -1 ? part : part.slice(0, equals), true);
      const value = equals === -1 ? "" : percentDecodeToString(part.slice(equals + 1), true);
      if (name === undefined || value === undefined) throw new S3Error("InvalidURI");
      this.parameters.push({ name, value });
    }
  }

  has(name: string): boolean {
    return this.parameters.some(parameter => parameter.name === name);
  }

  get(name: string): string | undefined {
    return this.parameters.find(parameter => parameter.name === name)?.value;
  }
}

export interface RequestContext {
  server: S3Server;
  request: Request;
  method: string;
  headers: Headers;
  /** The path of the URL as the client sent it, percent-encoded. */
  path: string;
  query: Query;
  /** The request came through TLS. */
  secure: boolean;
  /** The bucket is in the `Host` header and not in the path. */
  virtualHosted: boolean;
  bucketName: string | undefined;
  key: string | undefined;
  requestId: string;
  hostId: string;
  now: Date;
  clientAddress: string | undefined;
  authentication: Authentication;
  /** The account that signed the request. `undefined` is an anonymous request. */
  sender: Owner | undefined;
  /** The name of the S3 operation, for example `PutObject`. The router sets it. */
  operation: string;
  /** The bucket of the request, after the server found that it exists. */
  bucket: Bucket | undefined;
}

export type ResponseHeaders = Record<string, string | undefined>;

function toHeaders(headers: ResponseHeaders | undefined): Headers {
  const out = new Headers();
  if (headers) {
    for (const name in headers) {
      const value = headers[name];
      if (value !== undefined) out.set(name, value);
    }
  }
  return out;
}

export function emptyResponse(status: number, headers?: ResponseHeaders): Response {
  const out = toHeaders(headers);
  if (status !== 204 && status !== 304 && !out.has("content-length")) out.set("content-length", "0");
  return new Response(null, { status, headers: out });
}

export function xmlResponse(
  root: string,
  content: Exclude<XmlNode, undefined | null | XmlNode[] | XmlAttributes>,
  headers?: ResponseHeaders,
  status = 200,
): Response {
  return rawXmlResponse(xmlDocument(root, content), headers, status);
}

export function rawXmlResponse(body: string, headers?: ResponseHeaders, status = 200): Response {
  const out = toHeaders(headers);
  out.set("content-type", "application/xml");
  return new Response(body, { status, headers: out });
}

export function errorResponse(
  context: Pick<RequestContext, "method" | "requestId" | "hostId">,
  error: S3Error,
): Response {
  const headers = toHeaders(error.headers);
  // A response to HEAD has no body. S3 sends the status and the headers only.
  if (context.method === "HEAD" || error.status === 304) {
    return new Response(null, { status: error.status, headers });
  }
  const details: S3ErrorDetails = {};
  for (const name in error.details) {
    if (error.details[name] !== undefined) details[name] = error.details[name];
  }
  headers.set("content-type", "application/xml");
  const body = xmlDocument(
    "Error",
    { Code: error.code, Message: error.message, ...details, RequestId: context.requestId, HostId: context.hostId },
    null,
  );
  return new Response(body, { status: error.status, headers });
}

/** The value of an integer query parameter or header. Throws `InvalidArgument` for another format. */
export function parseInteger(
  value: string | undefined | null,
  name: string,
  options: { min?: number; max?: number; message?: string } = {},
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = /^-?\d+$/.test(value) ? Number(value) : NaN;
  const { min = 0, max = 2147483647 } = options;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new S3Error("InvalidArgument", {
      message: options.message ?? `Argument ${name} must be an integer between ${min} and ${max}`,
      details: { ArgumentName: name, ArgumentValue: value },
    });
  }
  return number;
}

export function lastModifiedHeader(date: Date): string {
  return httpDate(date);
}
