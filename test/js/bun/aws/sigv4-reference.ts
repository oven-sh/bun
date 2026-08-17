// Independent, deliberately straightforward SigV4 implementation used as an
// oracle for Bun's native signer. Follows
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
import { createHash, createHmac } from "node:crypto";

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function hmac(key: string | Buffer, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function sha256Hex(data: string | Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

export type ReferenceRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  service: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** YYYYMMDDTHHMMSSZ */
  datetime: string;
  unsignedPayload?: boolean;
};

function canonicalUri(pathname: string, s3: boolean) {
  if (pathname === "") return "/";
  if (s3) {
    return decodeURIComponent(pathname)
      .split("/")
      .map(seg => enc(seg))
      .join("/");
  }
  const segments: string[] = [];
  for (const seg of pathname.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segments.pop();
    else segments.push(enc(seg));
  }
  let out = "/" + segments.join("/");
  if (segments.length && pathname.endsWith("/")) out += "/";
  return out;
}

function canonicalQuery(search: string) {
  if (search.startsWith("?")) search = search.slice(1);
  if (!search) return "";
  const pairs: [string, string][] = [];
  for (const part of search.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = i === -1 ? part : part.slice(0, i);
    const v = i === -1 ? "" : part.slice(i + 1);
    if (k === "X-Amz-Signature") continue;
    const dec = (s: string) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
    pairs.push([enc(dec(k)), enc(dec(v))]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/** Returns the headers Bun should add (lowercase names). */
export function referenceSign(req: ReferenceRequest) {
  const url = new URL(req.url);
  const s3 = req.service === "s3";
  const payloadHash = req.unsignedPayload ? "UNSIGNED-PAYLOAD" : sha256Hex(req.body ?? "");
  const headers: [string, string][] = [
    ["host", url.host],
    ["x-amz-date", req.datetime],
  ];
  if (s3) headers.push(["x-amz-content-sha256", payloadHash]);
  if (req.sessionToken) headers.push(["x-amz-security-token", req.sessionToken]);
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const name = k.toLowerCase();
    if (["host", "authorization", "user-agent", "content-length", "connection", "x-amz-date"].includes(name)) continue;
    headers.push([name, v.trim().replace(/[ \t]+/g, " ")]);
  }
  headers.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = headers.map(h => h[0]).join(";");
  const canonical = [
    req.method,
    canonicalUri(url.pathname, s3),
    canonicalQuery(url.search),
    headers.map(([k, v]) => `${k}:${v}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const date = req.datetime.slice(0, 8);
  const scope = `${date}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", req.datetime, scope, sha256Hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + req.secretAccessKey, date), req.region), req.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    canonical,
    stringToSign,
    authorization: `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-date": req.datetime,
    "x-amz-content-sha256": payloadHash,
  };
}

/** Recomputes the signature of a presigned URL and returns [expected, actual]. */
export function referencePresignCheck(
  presigned: string,
  opts: { method?: string; service: string; region: string; secretAccessKey: string },
) {
  const url = new URL(presigned);
  const actual = url.searchParams.get("X-Amz-Signature");
  const datetime = url.searchParams.get("X-Amz-Date")!;
  const s3 = opts.service === "s3";
  const payloadHash = s3 ? "UNSIGNED-PAYLOAD" : sha256Hex("");
  const canonical = [
    opts.method ?? "GET",
    canonicalUri(url.pathname, s3),
    canonicalQuery(url.search),
    `host:${url.host}\n`,
    "host",
    payloadHash,
  ].join("\n");
  const date = datetime.slice(0, 8);
  const scope = `${date}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", datetime, scope, sha256Hex(canonical)].join("\n");
  const kSigning = hmac(
    hmac(hmac(hmac("AWS4" + opts.secretAccessKey, date), opts.region), opts.service),
    "aws4_request",
  );
  const expected = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return { expected, actual, canonical };
}
