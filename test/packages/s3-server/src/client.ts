// A small client that signs requests with AWS Signature Version 4. A test
// uses it to send a request of the S3 API that `Bun.S3Client` has no method for.

import { formatAmzDate, uriEncode } from "./encoding.ts";
import {
  ALGORITHM,
  canonicalQueryString,
  canonicalRequest,
  chunkStringToSign,
  deriveSigningKey,
  sha256Hex,
  signString,
  STREAMING_PAYLOAD,
  STREAMING_PAYLOAD_TRAILER,
  STREAMING_UNSIGNED_PAYLOAD_TRAILER,
  stringToSign,
  trailerStringToSign,
  UNSIGNED_PAYLOAD,
  type QueryParameter,
} from "./signature.ts";

export interface SigningClientOptions {
  /** The URL of the server, for example `http://127.0.0.1:3000`. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** The default is `us-east-1`. */
  region?: string;
  /** The source of the time of the signatures. */
  clock?: () => Date;
}

export type PayloadSigning =
  /** `x-amz-content-sha256` is the SHA-256 of the body. */
  | "sha256"
  /** `x-amz-content-sha256` is `UNSIGNED-PAYLOAD`. */
  | "unsigned"
  /** The body has the aws-chunked encoding. Each chunk has a signature. */
  | "streaming"
  /** As `streaming`, and the trailing headers have a signature. */
  | "streaming-trailer"
  /** The body has the aws-chunked encoding without signatures, with trailing headers. */
  | "streaming-unsigned-trailer";

export interface RequestOptions {
  /** The query parameters, not encoded. */
  query?: Record<string, string> | [name: string, value: string][];
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** The default is `sha256`. */
  payload?: PayloadSigning;
  /** The size of the chunks of an aws-chunked body. The default is 64 KiB. */
  chunkSize?: number;
  /** The trailing headers of an aws-chunked body. */
  trailers?: Record<string, string>;
  /** The value of the `Host` header. The client connects to the endpoint in each case. */
  host?: string;
  /** Sends the request without authentication. */
  anonymous?: boolean;
  /** Signs with the query parameters of a presigned URL and not with the `Authorization` header. */
  presign?: { expiresIn: number };
  /** The time of the signature. The default is the clock of the client. */
  date?: Date;
  /** The names of headers that the request sends and the signature does not cover. */
  unsignedHeaders?: string[];
  signal?: AbortSignal;
}

/** A request that is ready for `fetch`. */
export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | undefined;
}

const encoder = new TextEncoder();

function toBytes(body: string | Uint8Array | undefined): Uint8Array {
  if (body === undefined) return new Uint8Array(0);
  return typeof body === "string" ? encoder.encode(body) : body;
}

function queryParameters(query: RequestOptions["query"]): QueryParameter[] {
  if (!query) return [];
  const pairs = Array.isArray(query) ? query : Object.entries(query);
  return pairs.map(([name, value]) => ({ name, value }));
}

export class SigningClient {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string | undefined;
  readonly region: string;
  readonly #clock: () => Date;

  constructor(options: SigningClientOptions) {
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.sessionToken = options.sessionToken;
    this.region = options.region ?? "us-east-1";
    this.#clock = options.clock ?? (() => new Date());
  }

  /**
   * Builds and signs a request. `path` is the path of the resource, not
   * encoded: `/` for the service, `/bucket` for a bucket and `/bucket/key` for
   * an object. With `host` set to a virtual-hosted name it is `/key`.
   */
  sign(method: string, path: string, options: RequestOptions = {}): SignedRequest {
    const encodedPath = uriEncode(path.startsWith("/") ? path : "/" + path, false);
    const query = queryParameters(options.query);
    const host = options.host ?? new URL(this.endpoint).host;
    const content = toBytes(options.body);
    const date = options.date ?? this.#clock();
    const timestamp = formatAmzDate(date);
    const day = timestamp.slice(0, 8);
    const scope = `${day}/${this.region}/s3/aws4_request`;
    const headers: Record<string, string> = {};
    for (const name in options.headers) headers[name.toLowerCase()] = options.headers[name];
    headers["host"] = host;

    const url = (parameters: QueryParameter[]) => {
      const search = canonicalQueryString(parameters);
      return this.endpoint + encodedPath + (search === "" ? "" : "?" + search);
    };
    const hasBody = options.body !== undefined || method === "PUT" || method === "POST";

    if (options.anonymous) {
      return { url: url(query), method, headers, body: hasBody ? content : undefined };
    }

    const signingKey = deriveSigningKey(this.secretAccessKey, day, this.region);
    const signed = (names: string[]) => {
      const unsigned = new Set((options.unsignedHeaders ?? []).map(name => name.toLowerCase()));
      return names.filter(name => !unsigned.has(name)).sort();
    };

    if (options.presign) {
      const names = signed(Object.keys(headers));
      const parameters: QueryParameter[] = [
        ...query,
        { name: "X-Amz-Algorithm", value: ALGORITHM },
        { name: "X-Amz-Credential", value: `${this.accessKeyId}/${scope}` },
        { name: "X-Amz-Date", value: timestamp },
        { name: "X-Amz-Expires", value: String(options.presign.expiresIn) },
        { name: "X-Amz-SignedHeaders", value: names.join(";") },
      ];
      if (this.sessionToken !== undefined) {
        parameters.push({ name: "X-Amz-Security-Token", value: this.sessionToken });
      }
      const canonical = canonicalRequest({
        method,
        canonicalUri: encodedPath,
        canonicalQueryString: canonicalQueryString(parameters),
        headers: names.map(name => [name, headers[name]]),
        payloadHash: UNSIGNED_PAYLOAD,
      });
      const signature = signString(signingKey, stringToSign(timestamp, scope, canonical));
      parameters.push({ name: "X-Amz-Signature", value: signature });
      return { url: url(parameters), method, headers, body: hasBody ? content : undefined };
    }

    const mode = options.payload ?? "sha256";
    let payloadHash: string;
    switch (mode) {
      case "sha256":
        payloadHash = sha256Hex(content);
        break;
      case "unsigned":
        payloadHash = UNSIGNED_PAYLOAD;
        break;
      case "streaming":
        payloadHash = STREAMING_PAYLOAD;
        break;
      case "streaming-trailer":
        payloadHash = STREAMING_PAYLOAD_TRAILER;
        break;
      case "streaming-unsigned-trailer":
        payloadHash = STREAMING_UNSIGNED_PAYLOAD_TRAILER;
        break;
    }
    const streaming = mode !== "sha256" && mode !== "unsigned";
    headers["x-amz-content-sha256"] = payloadHash;
    headers["x-amz-date"] = timestamp;
    if (this.sessionToken !== undefined) headers["x-amz-security-token"] = this.sessionToken;
    const trailers = Object.entries(options.trailers ?? {}).map(([name, value]): [string, string] => [
      name.toLowerCase(),
      value,
    ]);
    if (streaming) {
      headers["content-encoding"] = headers["content-encoding"]
        ? "aws-chunked," + headers["content-encoding"]
        : "aws-chunked";
      headers["x-amz-decoded-content-length"] = String(content.length);
      if (trailers.length > 0) headers["x-amz-trailer"] = trailers.map(([name]) => name).join(",");
    }

    const names = signed(Object.keys(headers));
    const canonical = canonicalRequest({
      method,
      canonicalUri: encodedPath,
      canonicalQueryString: canonicalQueryString(query),
      headers: names.map(name => [name, headers[name]]),
      payloadHash,
    });
    const signature = signString(signingKey, stringToSign(timestamp, scope, canonical));
    headers["authorization"] =
      `${ALGORITHM} Credential=${this.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;

    let body: Uint8Array | undefined = hasBody ? content : undefined;
    if (streaming) {
      body = encodeAwsChunked(content, {
        chunkSize: options.chunkSize ?? 64 * 1024,
        trailers,
        signing:
          mode === "streaming-unsigned-trailer"
            ? undefined
            : { signingKey, timestamp, scope, seedSignature: signature, signTrailers: mode === "streaming-trailer" },
      });
    }
    return { url: url(query), method, headers, body };
  }

  /** Signs a request and sends it. */
  async fetch(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const request = this.sign(method, path, options);
    return fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: options.signal,
      redirect: "manual",
      // The test reads the bytes that the server sent.
      decompress: false,
    } as RequestInit);
  }

  /** A presigned URL for the request. */
  presign(
    method: string,
    path: string,
    options: Omit<RequestOptions, "presign"> & { expiresIn?: number } = {},
  ): string {
    return this.sign(method, path, { ...options, presign: { expiresIn: options.expiresIn ?? 3600 } }).url;
  }
}

export interface ChunkSigning {
  signingKey: Uint8Array;
  timestamp: string;
  scope: string;
  /** The signature of the request headers. */
  seedSignature: string;
  signTrailers: boolean;
}

/** Encodes a body with the aws-chunked encoding. Without `signing` the chunks have no signatures. */
export function encodeAwsChunked(
  content: Uint8Array,
  options: { chunkSize: number; trailers?: [name: string, value: string][]; signing?: ChunkSigning },
): Uint8Array {
  const { chunkSize, trailers = [], signing } = options;
  const pieces: Uint8Array[] = [];
  let previous = signing?.seedSignature ?? "";

  const chunkHeader = (chunk: Uint8Array): string => {
    let header = chunk.length.toString(16);
    if (signing) {
      previous = signString(signing.signingKey, chunkStringToSign(signing.timestamp, signing.scope, previous, chunk));
      header += ";chunk-signature=" + previous;
    }
    return header + "\r\n";
  };

  for (let offset = 0; offset < content.length; offset += chunkSize) {
    const chunk = content.subarray(offset, Math.min(content.length, offset + chunkSize));
    pieces.push(encoder.encode(chunkHeader(chunk)), chunk, encoder.encode("\r\n"));
  }
  pieces.push(encoder.encode(chunkHeader(new Uint8Array(0))));

  let tail = "";
  for (const [name, value] of trailers) tail += `${name}:${value}\r\n`;
  if (signing?.signTrailers) {
    const signature = signString(
      signing.signingKey,
      trailerStringToSign(signing.timestamp, signing.scope, previous, trailers),
    );
    tail += `x-amz-trailer-signature:${signature}\r\n`;
  }
  pieces.push(encoder.encode(tail + "\r\n"));

  return Buffer.concat(pieces);
}
