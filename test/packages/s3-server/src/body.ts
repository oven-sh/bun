// Reads the body of a request and does the integrity checks of S3: the
// payload hash of the signature, Content-MD5, the x-amz-checksum-* values and
// the chunk signatures of the aws-chunked encoding.

import {
  checksumFromHeaders,
  checksumHeaderName,
  checksumMismatch,
  CHECKSUM_ALGORITHMS,
  computeChecksum,
  isValidChecksumValue,
  parseChecksumAlgorithm,
  type ChecksumAlgorithm,
} from "./checksums.ts";
import type { RequestContext } from "./context.ts";
import { invalidRequest, notImplemented, S3Error } from "./errors.ts";
import {
  chunkStringToSign,
  hexBytes,
  sha256Hex,
  signaturesEqual,
  signString,
  STREAMING_PAYLOAD,
  STREAMING_PAYLOAD_TRAILER,
  STREAMING_UNSIGNED_PAYLOAD_TRAILER,
  trailerStringToSign,
  UNSIGNED_PAYLOAD,
  type SignedRequest,
} from "./signature.ts";

/** The largest object that one PUT request or one part can carry: 5 GiB. */
export const MAX_OBJECT_SIZE = 5 * 1024 * 1024 * 1024;
/** The largest body of a request that carries an XML or JSON document. */
export const MAX_DOCUMENT_SIZE = 2 * 1024 * 1024;
/** A chunk of the aws-chunked encoding that is not the last one has this size at least. */
export const MIN_CHUNK_SIZE = 8192;

/**
 * The operations that refuse a checksum value of another algorithm than
 * `x-amz-sdk-checksum-algorithm` names. The other operations use the algorithm of the value.
 */
const STRICT_CHECKSUM_ALGORITHM = ["PutObject", "PutBucketPolicy", "DeleteObjects"];

export interface Payload {
  data: Uint8Array;
  /** The MD5 digest of the data. */
  md5: Buffer;
  /** The checksum that the client sent. The server verified it. */
  checksum: { algorithm: ChecksumAlgorithm; value: string } | undefined;
}

function isStreaming(payloadHash: string): boolean {
  return (
    payloadHash === STREAMING_PAYLOAD ||
    payloadHash === STREAMING_PAYLOAD_TRAILER ||
    payloadHash === STREAMING_UNSIGNED_PAYLOAD_TRAILER
  );
}

function incompleteBody(): S3Error {
  return new S3Error("IncompleteBody", { message: "The request body terminated unexpectedly" });
}

function signatureMismatch(signed: SignedRequest, toSign: string, provided: string | undefined): S3Error {
  return new S3Error("SignatureDoesNotMatch", {
    details: {
      AWSAccessKeyId: signed.credential.accessKeyId,
      StringToSign: toSign,
      SignatureProvided: provided ?? "",
      StringToSignBytes: hexBytes(toSign),
    },
  });
}

interface Decoded {
  data: Uint8Array;
  trailers: Map<string, string>;
}

function indexOfCrlf(body: Uint8Array, from: number): number {
  // A chunk header or a trailer line is short. A long search means that the framing is wrong.
  const limit = Math.min(body.length - 1, from + 4096);
  for (let i = from; i < limit; i++) {
    if (body[i] === 0x0d && body[i + 1] === 0x0a) return i;
  }
  return -1;
}

function latin1(body: Uint8Array, start: number, end: number): string {
  return Buffer.from(body.buffer, body.byteOffset + start, end - start).toString("latin1");
}

/**
 * Decodes an aws-chunked body. Each chunk is `<size in hex>[;chunk-signature=<signature>]\r\n<data>\r\n`.
 * A chunk of size zero ends the data. Trailing headers can follow it.
 */
export function decodeAwsChunked(
  body: Uint8Array,
  decodedLength: number,
  mode: string,
  signed: SignedRequest | undefined,
): Decoded {
  const verify = mode !== STREAMING_UNSIGNED_PAYLOAD_TRAILER;
  if (verify && !signed) throw new S3Error("AccessDenied");
  // The framing adds bytes. A decoded length above the length of the body is not possible.
  if (decodedLength > body.length) throw incompleteBody();

  const data = new Uint8Array(decodedLength);
  let written = 0;
  let position = 0;
  let previousSignature = signed?.signature ?? "";
  let previousSize: number | undefined;
  let chunkNumber = 0;

  for (;;) {
    const lineEnd = indexOfCrlf(body, position);
    if (lineEnd === -1) throw incompleteBody();
    const header = latin1(body, position, lineEnd);
    position = lineEnd + 2;

    const [sizeText, ...extensions] = header.split(";");
    if (!/^[0-9a-fA-F]{1,16}$/.test(sizeText.trim())) throw incompleteBody();
    const size = parseInt(sizeText.trim(), 16);
    if (position + size > body.length) throw incompleteBody();
    const chunk = body.subarray(position, position + size);

    // The server knows that a chunk is not the last one when the next chunk has data.
    if (size > 0 && previousSize !== undefined && previousSize < MIN_CHUNK_SIZE) {
      throw new S3Error("InvalidChunkSizeError", { details: { Chunk: chunkNumber, BadChunkSize: previousSize } });
    }
    chunkNumber++;

    if (verify) {
      let signature: string | undefined;
      for (const extension of extensions) {
        const [name, value] = extension.split("=");
        if (name.trim() === "chunk-signature") signature = value?.trim();
      }
      const toSign = chunkStringToSign(signed!.timestamp, signed!.scope, previousSignature, chunk);
      const expected = signString(signed!.signingKey, toSign);
      if (signature === undefined || !signaturesEqual(expected, signature.toLowerCase())) {
        throw signatureMismatch(signed!, toSign, signature);
      }
      previousSignature = expected;
    }

    if (size === 0) break;
    if (written + size > decodedLength) throw incompleteBody();
    data.set(chunk, written);
    written += size;
    position += size;
    if (body[position] !== 0x0d || body[position + 1] !== 0x0a) throw incompleteBody();
    position += 2;
    previousSize = size;
  }

  if (written !== decodedLength) throw incompleteBody();

  // The trailing headers, then one empty line. A body without trailers ends with the empty line.
  const trailers = new Map<string, string>();
  const signedTrailers: [string, string][] = [];
  let trailerSignature: string | undefined;
  while (position < body.length) {
    let lineEnd = indexOfCrlf(body, position);
    let next = lineEnd + 2;
    if (lineEnd === -1) {
      // Some clients end a trailer line with a line feed only.
      lineEnd = body.indexOf(0x0a, position);
      if (lineEnd === -1) lineEnd = body.length;
      next = Math.min(body.length, lineEnd + 1);
    }
    const line = latin1(body, position, lineEnd).trim();
    position = next;
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) throw new S3Error("MalformedTrailerError");
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "x-amz-trailer-signature") {
      trailerSignature = value;
    } else {
      trailers.set(name, value);
      signedTrailers.push([name, value]);
    }
  }

  if (mode === STREAMING_PAYLOAD_TRAILER) {
    const toSign = trailerStringToSign(signed!.timestamp, signed!.scope, previousSignature, signedTrailers);
    const expected = signString(signed!.signingKey, toSign);
    if (trailerSignature === undefined || !signaturesEqual(expected, trailerSignature.toLowerCase())) {
      throw signatureMismatch(signed!, toSign, trailerSignature);
    }
  }

  return { data, trailers };
}

/** The length that the `Content-Length` header declares. `undefined` when the request has no such header. */
export function declaredLength(headers: Headers): number | undefined {
  const value = headers.get("content-length");
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new S3Error("MissingContentLength");
  return Number(value);
}

/**
 * Reads the body of the request and verifies it. `maxSize` is the limit for
 * the content, after the server removed the aws-chunked framing.
 */
export async function readPayload(context: RequestContext, maxSize: number): Promise<Payload> {
  const { headers, authentication } = context;
  const payloadHash =
    authentication.type === "anonymous"
      ? (headers.get("x-amz-content-sha256") ?? UNSIGNED_PAYLOAD)
      : authentication.payloadHash;
  const streaming = isStreaming(payloadHash);

  const contentLength = declaredLength(headers);
  if (contentLength === undefined) {
    if (!headers.has("transfer-encoding")) throw new S3Error("MissingContentLength");
    // S3 accepts the chunked transfer coding only around an aws-chunked body.
    if (!streaming) throw notImplemented("Transfer-Encoding");
  }

  let decodedLength: number | undefined;
  if (streaming) {
    const value = headers.get("x-amz-decoded-content-length");
    if (value === null || !/^\d+$/.test(value)) throw new S3Error("MissingContentLength");
    decodedLength = Number(value);
  }

  const proposedSize = decodedLength ?? contentLength ?? 0;
  if (proposedSize > maxSize) {
    throw new S3Error("EntityTooLarge", { details: { ProposedSize: proposedSize, MaxSizeAllowed: maxSize } });
  }

  let body: Uint8Array;
  try {
    body = new Uint8Array(await context.request.arrayBuffer());
  } catch {
    throw incompleteBody();
  }
  if (contentLength !== undefined && body.length !== contentLength) {
    throw new S3Error("IncompleteBody");
  }

  let data = body;
  let trailers: Map<string, string> | undefined;
  if (streaming) {
    const decoded = decodeAwsChunked(
      body,
      decodedLength!,
      payloadHash,
      authentication.type === "anonymous" ? undefined : authentication,
    );
    data = decoded.data;
    trailers = decoded.trailers;
  } else if (/^[0-9a-fA-F]{64}$/.test(payloadHash)) {
    const computed = sha256Hex(data);
    if (computed !== payloadHash.toLowerCase()) {
      throw new S3Error("XAmzContentSHA256Mismatch", {
        details: { ClientComputedContentSHA256: payloadHash, S3ComputedContentSHA256: computed },
      });
    }
  }

  const md5 = new Bun.CryptoHasher("md5").update(data).digest() as Buffer;
  const contentMd5 = headers.get("content-md5");
  if (contentMd5 !== null) {
    const expected = Buffer.from(contentMd5, "base64");
    if (expected.length !== 16 || expected.toString("base64") !== contentMd5.trim()) {
      throw new S3Error("InvalidDigest", { details: { "Content-MD5": contentMd5 } });
    }
    if (!expected.equals(md5)) {
      throw new S3Error("BadDigest", {
        details: { ExpectedDigest: contentMd5, CalculatedDigest: md5.toString("base64") },
      });
    }
  }

  return { data, md5, checksum: verifyChecksum(context, trailers, data) };
}

function verifyChecksum(
  context: RequestContext,
  trailers: Map<string, string> | undefined,
  data: Uint8Array,
): Payload["checksum"] {
  const { headers } = context;
  let declared = checksumFromHeaders(headers);

  const trailerNames = (headers.get("x-amz-trailer") ?? "")
    .split(",")
    .map(name => name.trim().toLowerCase())
    .filter(name => name !== "");
  for (const name of trailerNames) {
    const algorithm = CHECKSUM_ALGORITHMS.find(candidate => checksumHeaderName(candidate) === name);
    if (!algorithm) continue;
    const value = trailers?.get(name);
    if (value === undefined) throw new S3Error("MalformedTrailerError");
    if (declared) {
      throw invalidRequest("Expecting a single x-amz-checksum- header. Multiple checksum Types are not allowed.");
    }
    if (!isValidChecksumValue(algorithm, value)) throw invalidRequest(`Value for ${name} trailing header is invalid.`);
    declared = { algorithm, value };
  }

  const requested = parseChecksumAlgorithm(headers.get("x-amz-sdk-checksum-algorithm"), "x-amz-sdk-checksum-algorithm");
  if (requested) {
    if (!declared) {
      throw invalidRequest(
        "x-amz-sdk-checksum-algorithm specified, but no corresponding x-amz-checksum-* or x-amz-trailer headers were found.",
      );
    }
    if (declared.algorithm !== requested && STRICT_CHECKSUM_ALGORITHM.includes(context.operation)) {
      throw checksumMismatch(requested);
    }
  }

  if (!declared) return undefined;
  if (computeChecksum(declared.algorithm, data) !== declared.value) throw checksumMismatch(declared.algorithm);
  return declared;
}

/** Reads a body that holds a document, for example the XML of CompleteMultipartUpload. */
export async function readDocument(context: RequestContext): Promise<Uint8Array> {
  const payload = await readPayload(context, MAX_DOCUMENT_SIZE);
  return payload.data;
}
