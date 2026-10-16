// fetch() checks the response body against the `integrity` option
// (https://w3c.github.io/webappsec-subresource-integrity/) and rejects when it does not match.
//
// Most tests are one row of a table: a fetch, and the cell that it comes to. A cell is
// `<status> <body>` for a fetch that resolved. For one that rejected it is the error's `code`,
// and for an integrity error the `code` and the message.

import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import http2 from "node:http2";
import { createServer as createNetServer, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";

const BODY = "console.log('the real file')\n";
const EVIL = "console.log('something else')\n";
/** 2 MiB that do not compress: more than one read, and more than one HTTP/2 or HTTP/3 flow-control window. */
const BIG = randomBytes(2 * 1024 * 1024);

const sri = (algorithm: string, body: string | Uint8Array) =>
  `${algorithm}-${createHash(algorithm).update(body).digest("base64")}`;
const urlSafe = (metadata: string) => metadata.replaceAll("+", "-").replaceAll("/", "_");
const noPadding = (metadata: string) => metadata.replace(/=+$/, "");
/** A value that decodes to the digest of BODY and `extra` more bytes. */
const longer = (algorithm: string, extra: number) =>
  `${algorithm}-${Buffer.concat([createHash(algorithm).update(BODY).digest(), Buffer.alloc(extra, 1)]).toString("base64")}`;

const algorithms = ["sha256", "sha384", "sha512"] as const;
const [good256, good384, good512] = algorithms.map(algorithm => sri(algorithm, BODY));
const [bad256, bad384, bad512] = algorithms.map(algorithm => sri(algorithm, EVIL));
const empty256 = sri("sha256", "");
const big256 = sri("sha256", BIG);

const gzipped = gzipSync(BODY);
const bigGzipped = gzipSync(BIG);
const encoded: Record<string, Buffer> = {
  br: brotliCompressSync(BODY),
  zstd: zstdCompressSync(BODY),
  deflate: deflateSync(BODY),
};

/** A body as a table cell: its text when it is short, else its size and the start of its sha256. */
function show(body: string | Uint8Array) {
  const bytes = Buffer.from(body);
  const text = bytes.toString("latin1");
  if (bytes.length <= 64 && /^[\n\x20-\x7e]*$/.test(text)) return JSON.stringify(text);
  return `${bytes.length} bytes, sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}

/** The cell of a fetch that resolved with `status` and `body`. */
const ok = (body: string | Uint8Array, status = 200) => `${status} ${show(body)}`;
const GOOD = ok(BODY);

const FAILED = "IntegrityCheckFailed: Integrity check failed: ";
/** The cell of a fetch that rejected because `body`, which the server sent, has a digest that the metadata does not list. */
const mismatch = (body: string | Uint8Array, algorithm = "sha256") =>
  `${FAILED}the response body has the digest "${sri(algorithm, body)}", which is not in the 'integrity' option`;
const noValidDigest = (algorithm: string) => `${FAILED}the 'integrity' option has no valid ${algorithm} digest`;
const NULL_BODY = `${FAILED}a response without a body cannot match the 'integrity' option`;
const UNSUPPORTED = `${FAILED}fetch() cannot check the response to this kind of request against the 'integrity' option`;

const showError = (error: any) =>
  error?.code === "IntegrityCheckFailed"
    ? `${error.code}: ${error.message}`
    : typeof error?.code === "string"
      ? error.code
      : `${error?.name}: ${error?.message}`;

type Start = () => Promise<Response>;
type Row = [name: string, start: Start, expected: string];

/** A fetch of `url` with this `integrity`, not started yet. */
const get =
  (url: string, integrity: unknown, init: BunFetchRequestInit = {}): Start =>
  () =>
    fetch(url, { ...init, integrity: integrity as string });

/** Runs one fetch to its end and gives its cell. */
async function outcome(start: Start): Promise<string> {
  let response: Response;
  try {
    response = await start();
  } catch (error) {
    return showError(error);
  }
  try {
    return ok(await response.bytes(), response.status);
  } catch (error) {
    return `${response.status}, then the body read rejects: ${showError(error)}`;
  }
}

/** One concurrent test for each row. */
const rows = (table: Row[]) =>
  test.concurrent.each(table)("%s", async (_, start, expected) => {
    expect(await outcome(start)).toBe(expected);
  });

/** `<method> <target>` of every request that reached a server: how a test knows that a fetch sent nothing. */
const seen: string[] = [];

async function handle(request: Request) {
  const { pathname } = new URL(request.url);
  seen.push(`${request.method} ${pathname}`);
  const [, route, name] = pathname.split("/");
  switch (route) {
    case "good":
      return new Response(BODY);
    case "evil":
      return new Response(EVIL);
    case "empty":
      return new Response("");
    case "big":
      return new Response(BIG);
    case "status":
      return new Response(name === "404" ? BODY : null, { status: Number(name) });
    case "gzip":
      return new Response(name === "big" ? bigGzipped : gzipped, { headers: { "content-encoding": "gzip" } });
    case "encoded":
      return new Response(encoded[name], { headers: { "content-encoding": name } });
    case "redirect":
      return new Response("redirecting", { status: 302, headers: { location: `/${name || "good"}` } });
    case "upload":
      await request.arrayBuffer();
      return new Response(BODY);
    case "bucket":
      // S3 GetObject and PutObject.
      if (request.method === "GET") return new Response(BODY);
      await request.arrayBuffer();
      return new Response("", { headers: { etag: '"etag"' } });
  }
  return new Response("no such route", { status: 404 });
}

const server = Bun.serve({ port: 0, fetch: handle });
const secure = Bun.serve({ port: 0, tls, fetch: handle });
const socketDir = tempDir("fetch-integrity", { "real.js": BODY });
const unix = isWindows ? undefined : Bun.serve({ unix: join(String(socketDir), "server.sock"), fetch: handle });
afterAll(async () => {
  await Promise.all([server.stop(true), secure.stop(true), unix?.stop(true)]);
  socketDir[Symbol.dispose]();
});
const u = (path: string) => `http://127.0.0.1:${server.port}${path}`;
const insecure = { tls: { rejectUnauthorized: false } };

/** A 200 response with `body` in the chunked transfer coding, `step` bytes in each chunk. */
function chunkedResponse(body: Buffer, step: number) {
  const parts: (string | Buffer)[] = ["HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"];
  for (let offset = 0; offset < body.length; offset += step) {
    const chunk = body.subarray(offset, offset + step);
    parts.push(`${chunk.length.toString(16)}\r\n`, chunk, "\r\n");
  }
  parts.push("0\r\n\r\n");
  return Buffer.concat(parts.map(part => Buffer.from(part)));
}

/** A 200 response whose body ends when the server closes the connection. */
const closeDelimited = (body: string | Uint8Array, headers = "") =>
  Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nConnection: close\r\n${headers}\r\n`), Buffer.from(body)]);

const slowResponses = new Map<string, PromiseWithResolvers<void>>();
/** Resolves when the raw server has written the head and the first part of its response to `target`. */
function written(target: string) {
  let response = slowResponses.get(target);
  if (!response) slowResponses.set(target, (response = Promise.withResolvers<void>()));
  return response;
}

// The responses that an HTTP server library does not produce, byte for byte. One request for each connection.
const rawSockets = new Set<Socket>();
const raw = createNetServer(socket => {
  rawSockets.add(socket);
  socket.on("close", () => rawSockets.delete(socket));
  socket.on("error", () => {});
  socket.once("data", head => {
    const [method, target] = head.toString("latin1").split("\r\n", 1)[0].split(" ");
    seen.push(`${method} ${target}`);
    const [, route, name] = target.split(/[/?]/);
    switch (route) {
      case "chunked":
        return socket.end(name === "big" ? chunkedResponse(BIG, 64 * 1024) : chunkedResponse(Buffer.from(BODY), 5));
      case "close-delimited":
        return socket.end(closeDelimited(name === "big" ? BIG : name === "empty" ? "" : BODY));
      case "close-gzip":
        // `cut`: the server closes in the middle of the compressed body.
        return socket.end(
          closeDelimited(
            name === "cut" ? bigGzipped.subarray(0, bigGzipped.length / 2) : bigGzipped,
            "Content-Encoding: gzip\r\n",
          ),
        );
      case "null-with-content":
        // A null body status that frames content anyway.
        return socket.end(
          `HTTP/1.1 ${name} Null\r\nContent-Length: ${BODY.length}\r\nConnection: close\r\n\r\n${BODY}`,
        );
      case "reset":
        // Content-Length says 100, the server closes after 10.
        return socket.end("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n0123456789");
      case "corrupt-gzip":
        return socket.end(
          "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 20\r\n\r\nnot gzip data at all",
        );
      case "upgrade":
        return socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      case "slow":
        // The head and 10 of the 29 bytes. The body stays open until the client leaves.
        return socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${BODY.length}\r\n\r\n${BODY.slice(0, 10)}`,
          () => written(target).resolve(),
        );
    }
    return socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
  });
});
await once(raw.listen(0, "127.0.0.1"), "listening");
afterAll(() => {
  for (const socket of rawSockets) socket.destroy();
  raw.close();
});
const r = (path: string) => `http://127.0.0.1:${(raw.address() as AddressInfo).port}${path}`;

/** One request and its response on each server: time for what an earlier fetch sent or received to arrive. */
async function roundTrip() {
  await Promise.all([fetch(u("/good")), fetch(r("/ok"))].map(async response => (await response).bytes()));
}

// Servers for one protocol only: a fetch that fell back to HTTP/1.1 gets no response from them.
const h2 = http2.createSecureServer({ ...tls, allowHTTP1: false }, async (request, response) => {
  const answer = await handle(new Request(`https://h2${request.url}`, { method: request.method }));
  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(Buffer.from(await answer.arrayBuffer()));
});
h2.on("clientError", () => {});
h2.on("secureConnection", socket => socket.on("error", () => {}));
await once(h2.listen(0), "listening");
const h3 = Bun.serve({ port: 0, tls, http3: true, http1: false, fetch: handle });
afterAll(() => {
  h2.close();
  // Not awaited: the client keeps its HTTP/3 session to this origin until the idle timeout.
  void h3.stop(true);
});

const blobUrls: string[] = [];
/** A blob: URL for `blob`, revoked when the file is done. */
function blobUrl(blob: Blob) {
  const url = URL.createObjectURL(blob);
  blobUrls.push(url);
  return url;
}
afterAll(() => blobUrls.forEach(url => URL.revokeObjectURL(url)));

describe("integrity: the metadata", () => {
  test("the digests of the test bodies have both base64 alphabets' characters and padding", () => {
    // The base64url and padding rows check nothing with a digest that is the same in both forms.
    expect([good512, bad512]).toEqual([expect.stringMatching(/[+/].*=$/), expect.stringMatching(/[+/].*=$/)]);
  });

  describe("the body must have a digest of the strongest algorithm that the metadata names", () => {
    rows([
      ...algorithms.flatMap((algorithm): Row[] => [
        [`${algorithm} match`, get(u("/good"), sri(algorithm, BODY)), GOOD],
        [`${algorithm} mismatch`, get(u("/evil"), sri(algorithm, BODY)), mismatch(EVIL, algorithm)],
      ]),
      // The strongest algorithm wins, and any digest of it may match.
      ["sha256 wrong + sha512 right", get(u("/good"), `${bad256} ${good512}`), GOOD],
      ["sha256 right + sha512 wrong", get(u("/good"), `${good256} ${bad512}`), mismatch(BODY, "sha512")],
      ["sha384 right + sha256 wrong", get(u("/good"), `${good384} ${bad256}`), GOOD],
      ["sha256 right + sha384 wrong", get(u("/good"), `${good256} ${bad384}`), mismatch(BODY, "sha384")],
      ["sha512 wrong + sha512 right", get(u("/good"), `${bad512} ${good512}`), GOOD],
      ["sha512 right + sha512 wrong", get(u("/good"), `${good512} ${bad512}`), GOOD],
      [
        "sha512 wrong + another wrong",
        get(u("/good"), `${bad512} ${sri("sha512", "a third body")}`),
        mismatch(BODY, "sha512"),
      ],
      // A value that is not a digest of its algorithm matches nothing, but its algorithm still counts.
      ["sha512 undecodable + sha512 right", get(u("/good"), `sha512-!!! ${good512}`), GOOD],
      ["sha512 undecodable + sha256 right", get(u("/good"), `sha512-!!! ${good256}`), noValidDigest("sha512")],
      ["sha256 right + sha512 undecodable", get(u("/good"), `${good256} sha512-!!!`), noValidDigest("sha512")],
      ["sha384 undecodable + sha256 right", get(u("/good"), `sha384-!!! ${good256}`), noValidDigest("sha384")],
    ]);
  });

  describe("tokens are split at ASCII whitespace, the algorithm is in any letter case, and the digest may be base64url, without padding, before ?options", () => {
    rows([
      // A character that did not split would leave one sha256 token with a value that is no digest.
      ...["\t", "\n", "\r", "\f", " "].map((separator): Row => [
        `${JSON.stringify(separator)} between tokens`,
        get(u("/good"), `${bad256}${separator}${good512}`),
        GOOD,
      ]),
      ["a vertical tab does not split", get(u("/good"), `${bad256}\v${good512}`), noValidDigest("sha256")],
      ["whitespace around every token", get(u("/good"), `  ${bad256}\t\n${bad384}\r\f ${good512}  `), GOOD],
      ["sha512 base64url with padding", get(u("/good"), urlSafe(good512)), GOOD],
      ["sha512 base64url without padding", get(u("/good"), noPadding(urlSafe(good512))), GOOD],
      ["sha512 base64 without padding", get(u("/good"), noPadding(good512)), GOOD],
      ["sha256 base64 without padding", get(u("/good"), noPadding(good256)), GOOD],
      ["sha512 base64url, wrong digest", get(u("/good"), urlSafe(bad512)), mismatch(BODY, "sha512")],
      [
        "sha512 base64url without padding, wrong digest",
        get(u("/good"), noPadding(urlSafe(bad512))),
        mismatch(BODY, "sha512"),
      ],
      ["sha256 right ?options", get(u("/good"), `${good256}?foo=bar`), GOOD],
      ["sha256 wrong ?options", get(u("/good"), `${bad256}?foo=bar`), mismatch(BODY)],
      ["SHA256 right", get(u("/good"), good256.replace("sha256", "SHA256")), GOOD],
      ["SHA256 wrong", get(u("/good"), bad256.replace("sha256", "SHA256")), mismatch(BODY)],
      ["Sha512 wrong", get(u("/good"), bad512.replace("sha512", "Sha512")), mismatch(BODY, "sha512")],
    ]);
  });

  describe("a supported algorithm with a value that is not one of its digests matches no body", () => {
    rows([
      ["sha256-!!!", get(u("/good"), "sha256-!!!"), noValidDigest("sha256")],
      ["sha256- (no value)", get(u("/good"), "sha256-"), noValidDigest("sha256")],
      ["sha256 (no dash)", get(u("/good"), "sha256"), noValidDigest("sha256")],
      ["sha256 with the sha512 digest", get(u("/good"), good512.replace("sha512", "sha256")), noValidDigest("sha256")],
      ["sha256 right digest and a *", get(u("/good"), `${good256}*`), noValidDigest("sha256")],
      ["sha256 right digest and three =", get(u("/good"), `${noPadding(good256)}===`), noValidDigest("sha256")],
      ["sha256 digest cut short", get(u("/good"), good256.slice(0, 30)), noValidDigest("sha256")],
      // More bytes than the digest has: one more, and as many as the next algorithm's digest.
      ["sha256 digest + 1 byte", get(u("/good"), longer("sha256", 1)), noValidDigest("sha256")],
      ["sha512 digest + 1 byte", get(u("/good"), longer("sha512", 1)), noValidDigest("sha512")],
      ["sha384 digest + 16 bytes", get(u("/good"), longer("sha384", 16)), noValidDigest("sha384")],
      [
        "a value of 1 MiB",
        get(u("/good"), `sha256-${Buffer.alloc(1024 * 1024, "A").toString()}`),
        noValidDigest("sha256"),
      ],
      ["too long + right", get(u("/good"), `${longer("sha256", 1)} ${good256}`), GOOD],
      ["right + too long", get(u("/good"), `${good256} ${longer("sha256", 1)}`), GOOD],
      ["too long, another body", get(u("/evil"), `${longer("sha256", 1)} ${good256}`), mismatch(EVIL)],
    ]);
  });

  describe("metadata that names no supported algorithm checks no digest, and still refuses a response without a body", () => {
    rows([
      ["md5-AAAA, 200 with a body", get(u("/good"), "md5-AAAA"), GOOD],
      ["garbage, 200 with a body", get(u("/good"), "garbage"), GOOD],
      ["sha1 digest of another body", get(u("/good"), sri("sha1", EVIL)), GOOD],
      ["a single space, 200 with a body", get(u("/good"), " "), GOOD],
      ["md5-AAAA, 204", get(u("/status/204"), "md5-AAAA"), NULL_BODY],
      ["garbage, 204", get(u("/status/204"), "garbage"), NULL_BODY],
      ["a single space, 204", get(u("/status/204"), " "), NULL_BODY],
      ["md5-AAAA, HEAD", get(u("/good"), "md5-AAAA", { method: "HEAD" }), NULL_BODY],
      ["garbage, HEAD", get(u("/good"), "garbage", { method: "HEAD" }), NULL_BODY],
    ]);
  });

  describe('it is a DOMString: "" and undefined ask for no check, every other value is checked as its string', () => {
    rows([
      ['"" on another body', get(u("/evil"), ""), ok(EVIL)],
      ['"" on a 204', get(u("/status/204"), ""), ok("", 204)],
      ["undefined on another body", get(u("/evil"), undefined), ok(EVIL)],
      ["undefined on a 204", get(u("/status/204"), undefined), ok("", 204)],
      // "null" and "123" name no algorithm.
      ["null on a body", get(u("/good"), null), GOOD],
      ["null on a 204", get(u("/status/204"), null), NULL_BODY],
      ["123 on a body", get(u("/good"), 123), GOOD],
      ["123 on a 204", get(u("/status/204"), 123), NULL_BODY],
      ["{ toString() } right", get(u("/good"), { toString: () => good256 }), GOOD],
      ["{ toString() } wrong", get(u("/good"), { toString: () => bad256 }), mismatch(BODY)],
    ]);
  });
});

describe("integrity: the response", () => {
  test("a fetch that the check refuses rejects with a TypeError that has a code and the URL of the response", async () => {
    const shape = (promise: Promise<Response>) =>
      promise.then(
        response => `resolved ${response.status}`,
        error => ({ isTypeError: error instanceof TypeError, name: error.name, code: error.code, path: error.path }),
      );
    const refused = { isTypeError: true, name: "TypeError", code: "IntegrityCheckFailed" };
    expect(
      await Promise.all([
        shape(fetch(u("/evil"), { integrity: good256 })),
        shape(fetch(u("/redirect/evil"), { integrity: good256 })),
        shape(fetch(u("/status/204"), { integrity: good256 })),
        shape(fetch(`http://user:secret@127.0.0.1:${server.port}/evil`, { integrity: good256 })),
        shape(fetch("data:,x", { integrity: good256 })),
      ]),
    ).toEqual([
      { ...refused, path: u("/evil") },
      { ...refused, path: u("/evil") },
      { ...refused, path: u("/status/204") },
      { ...refused, path: u("/evil") },
      { ...refused, path: "data:,x" },
    ]);
  });

  describe("HEAD, 204, 205 and 304 have no body to check and are refused, whatever the digest", () => {
    rows([
      ["204 + digest of ''", get(u("/status/204"), empty256), NULL_BODY],
      ["205 + digest of ''", get(u("/status/205"), empty256), NULL_BODY],
      ["304 + digest of ''", get(u("/status/304"), empty256), NULL_BODY],
      ["HEAD + digest of ''", get(u("/good"), empty256, { method: "HEAD" }), NULL_BODY],
      ["HEAD + digest of the GET body", get(u("/good"), good256, { method: "HEAD" }), NULL_BODY],
      // The content that such a response frames anyway is not its body.
      ...[204, 205, 304].map((status): Row => [
        `${status} that frames content + the digest of that content`,
        get(r(`/null-with-content/${status}`), good256),
        NULL_BODY,
      ]),
      // An empty body is a body.
      ["200 with an empty body + digest of ''", get(u("/empty"), empty256), ok("")],
      ["200 with an empty body + another digest", get(u("/empty"), good256), mismatch("")],
      ["404 with a body + its digest", get(u("/status/404"), good256), ok(BODY, 404)],
      ["404 with a body + another digest", get(u("/status/404"), bad256), mismatch(BODY)],
    ]);
  });

  describe("the digest is of the bytes that the caller gets: decoded, put together, and from the last response of a redirect", () => {
    const ofGzipped = sri("sha256", gzipped);
    const ofBigGzipped = sri("sha256", bigGzipped);
    const of302 = sri("sha256", "redirecting");
    const undecoded = { decompress: false };
    const manual = { redirect: "manual" } as const;
    rows([
      ["gzip + digest of the decoded bytes", get(u("/gzip"), good256), GOOD],
      ["gzip + digest of the compressed bytes", get(u("/gzip"), ofGzipped), mismatch(BODY)],
      ["gzip, decompress: false + digest of the compressed bytes", get(u("/gzip"), ofGzipped, undecoded), ok(gzipped)],
      ["gzip, decompress: false + digest of the decoded bytes", get(u("/gzip"), good256, undecoded), mismatch(gzipped)],
      ...Object.keys(encoded).flatMap((encoding): Row[] => [
        [`${encoding} + digest of the decoded bytes`, get(u(`/encoded/${encoding}`), good256), GOOD],
        [`${encoding} + another digest`, get(u(`/encoded/${encoding}`), bad256), mismatch(BODY)],
      ]),
      ["chunked match", get(r("/chunked"), good256), GOOD],
      ["chunked mismatch", get(r("/chunked"), bad256), mismatch(BODY)],
      ["close-delimited match", get(r("/close-delimited"), good256), GOOD],
      ["close-delimited mismatch", get(r("/close-delimited"), bad256), mismatch(BODY)],
      ["close-delimited, empty + digest of ''", get(r("/close-delimited/empty"), empty256), ok("")],
      ["close-delimited, empty + another digest", get(r("/close-delimited/empty"), good256), mismatch("")],
      ["redirect follow + digest of the last body", get(u("/redirect"), good256), GOOD],
      ["redirect follow + digest of the 302 body", get(u("/redirect"), of302), mismatch(BODY)],
      ["redirect manual + digest of the 302 body", get(u("/redirect"), of302, manual), ok("redirecting", 302)],
      ["redirect manual + digest of the last body", get(u("/redirect"), good256, manual), mismatch("redirecting")],
      // Bodies that arrive in more than one read.
      ["2 MiB with a Content-Length, match", get(u("/big"), big256), ok(BIG)],
      ["2 MiB with a Content-Length, mismatch", get(u("/big"), good256), mismatch(BIG)],
      ["2 MiB chunked, match", get(r("/chunked/big"), big256), ok(BIG)],
      ["2 MiB chunked, mismatch", get(r("/chunked/big"), good256), mismatch(BIG)],
      ["2 MiB close-delimited, match", get(r("/close-delimited/big"), big256), ok(BIG)],
      ["2 MiB close-delimited, mismatch", get(r("/close-delimited/big"), good256), mismatch(BIG)],
      ["2 MiB gzip + digest of the decoded bytes", get(u("/gzip/big"), big256), ok(BIG)],
      ["2 MiB gzip + digest of the compressed bytes", get(u("/gzip/big"), ofBigGzipped), mismatch(BIG)],
      ["2 MiB gzip, close-delimited + digest of the decoded bytes", get(r("/close-gzip/big"), big256), ok(BIG)],
      [
        "2 MiB gzip, close-delimited + digest of the compressed bytes",
        get(r("/close-gzip/big"), ofBigGzipped),
        mismatch(BIG),
      ],
      [
        "2 MiB gzip, close-delimited, decompress: false + digest of the compressed bytes",
        get(r("/close-gzip/big"), ofBigGzipped, undecoded),
        ok(bigGzipped),
      ],
    ]);
  });

  describe("every route to the server has the check", () => {
    const s3 = { s3: { endpoint: u(""), accessKeyId: "a", secretAccessKey: "b" } };
    const secureUrl = (path: string) => `https://localhost:${secure.port}${path}`;
    const checked = { tls: { rejectUnauthorized: false, checkServerIdentity: () => undefined } };
    rows([
      ["HTTPS match", get(secureUrl("/good"), good256, insecure), GOOD],
      ["HTTPS mismatch", get(secureUrl("/evil"), good256, insecure), mismatch(EVIL)],
      ["HTTPS with checkServerIdentity, match", get(secureUrl("/good"), good256, checked), GOOD],
      ["HTTPS with checkServerIdentity, mismatch", get(secureUrl("/evil"), good256, checked), mismatch(EVIL)],
      ["s3: GET match", get("s3://bucket/real.js", good256, s3), GOOD],
      ["s3: GET mismatch", get("s3://bucket/real.js", bad256, s3), mismatch(BODY)],
      ["POST with a string body, match", get(u("/upload"), good256, { method: "POST", body: "x" }), GOOD],
      ["POST with a string body, mismatch", get(u("/upload"), bad256, { method: "POST", body: "x" }), mismatch(BODY)],
      ...(unix
        ? ([
            ["unix socket match", get("http://localhost/good", good256, { unix: unix.url.pathname }), GOOD],
            [
              "unix socket mismatch",
              get("http://localhost/evil", good256, { unix: unix.url.pathname }),
              mismatch(EVIL),
            ],
          ] satisfies Row[])
        : []),
    ]);
  });

  test("a match resolves with the unread Response that the same fetch gives without integrity", async () => {
    const shape = async (response: Response) => {
      const before = { bodyUsed: response.bodyUsed, status: response.status, redirected: response.redirected };
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body!) chunks.push(chunk);
      return {
        ...before,
        path: new URL(response.url).pathname,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        body: Buffer.concat(chunks).toString(),
      };
    };
    const expected = {
      bodyUsed: false,
      status: 200,
      redirected: true,
      path: "/good",
      contentType: "text/plain;charset=utf-8",
      contentLength: String(BODY.length),
      body: BODY,
    };
    expect({
      checked: await shape(await fetch(u("/redirect"), { integrity: good256 })),
      unchecked: await shape(await fetch(u("/redirect"))),
    }).toEqual({ checked: expected, unchecked: expected });
  });

  describe("a response that fails after its head rejects fetch(), where without integrity the body read rejects", () => {
    const onError = { redirect: "error" } as const;
    rows([
      ["server closes mid-body", () => fetch(r("/reset")), "200, then the body read rejects: ECONNRESET"],
      ["server closes mid-body + integrity", get(r("/reset"), good256), "ECONNRESET"],
      ["corrupt gzip", () => fetch(r("/corrupt-gzip")), "200, then the body read rejects: ZlibError"],
      ["corrupt gzip + integrity", get(r("/corrupt-gzip"), good256), "ZlibError"],
      ["gzip that the server cuts short + integrity", get(r("/close-gzip/cut"), big256), "ZlibError"],
      ["redirect: error", () => fetch(u("/redirect"), onError), "UnexpectedRedirect"],
      ["redirect: error + integrity", get(u("/redirect"), good256, onError), "UnexpectedRedirect"],
    ]);
  });

  test("the promise is pending while the body is open, and an abort rejects it with the signal's reason", async () => {
    // A target of its own for each run of this test: `written()` is about this run's response.
    const run = crypto.randomUUID();
    const slow = (name: string) => `/slow?${name}-${run}`;
    // Without integrity the promise resolves at the head, and the abort reaches the body read.
    const unchecked = new AbortController();
    const response = await fetch(r(slow("unchecked")), { signal: unchecked.signal });
    unchecked.abort();
    const uncheckedBody = await response.bytes().then(ok, showError);

    const aborted = new AbortController();
    const withReason = new AbortController();
    const reason = new RangeError("my reason");
    const pending = [
      fetch(r(slow("aborted")), { integrity: good256, signal: aborted.signal }),
      fetch(r(slow("reason")), { integrity: good256, signal: withReason.signal }),
    ];
    const outcomes = Promise.all([
      outcome(() => pending[0]),
      pending[1].then(
        response => `resolved ${response.status}`,
        error => [error === reason, showError(error)],
      ),
      outcome(get(r(slow("timeout")), good256, { signal: AbortSignal.timeout(50) })),
    ]);
    // A fetch that settles before the server wrote its response ends the wait.
    const settledEarly = Promise.race(pending.map(promise => promise.then(Boolean, Boolean)));
    await Promise.race([
      Promise.all([written(slow("aborted")).promise, written(slow("reason")).promise]),
      settledEarly,
    ]);
    // The head and the first part of the body are written. After two more round trips the client has read them.
    await roundTrip();
    await roundTrip();
    const whileOpen = pending.map(promise => Bun.peek.status(promise));
    aborted.abort();
    withReason.abort(reason);
    const [abortedOutcome, reasonOutcome, timeoutOutcome] = await outcomes;

    expect({
      unchecked: [response.status, uncheckedBody],
      whileOpen,
      aborted: abortedOutcome,
      withReason: reasonOutcome,
      timedOut: timeoutOutcome,
    }).toEqual({
      unchecked: [200, "AbortError: The operation was aborted."],
      whileOpen: ["pending", "pending"],
      aborted: "AbortError: The operation was aborted.",
      withReason: [true, "RangeError: my reason"],
      timedOut: "TimeoutError: The operation timed out.",
    });
  });
});

describe("integrity: the request", () => {
  test("the integrity of a Request applies unless the init has the member", async () => {
    class Subclass extends Request {}
    let getterReads = 0;
    class GetterSubclass extends Request {
      get integrity() {
        getterReads++;
        return "";
      }
    }
    const good = (integrity: string, Class = Request) => new Class(u("/good"), { integrity });
    const evil = (integrity: string, Class = Request) => new Class(u("/evil"), { integrity });
    const withOwnProperty = (request: Request, integrity: string) =>
      Object.defineProperty(request, "integrity", { value: integrity });
    const twice = evil(good256);
    using session = new Bun.FetchSession();
    const table: Row[] = [
      ["fetch(request) match", () => fetch(good(good256)), GOOD],
      ["fetch(request) mismatch", () => fetch(evil(good256)), mismatch(EVIL)],
      ['fetch(request, { integrity: "" }) on another body', () => fetch(evil(good256), { integrity: "" }), ok(EVIL)],
      [
        "fetch(request, { integrity: undefined })",
        () => fetch(evil(good256), { integrity: undefined }),
        mismatch(EVIL),
      ],
      ["fetch(request, {})", () => fetch(evil(good256), {}), mismatch(EVIL)],
      [
        "fetch(request with a wrong digest, { integrity: right })",
        () => fetch(good(bad256), { integrity: good256 }),
        GOOD,
      ],
      [
        "fetch(request with the right digest, { integrity: wrong })",
        () => fetch(good(good256), { integrity: bad256 }),
        mismatch(BODY),
      ],
      ["fetch(request.clone())", () => fetch(evil(good256).clone() as Request), mismatch(EVIL)],
      ["fetch(new Request(request))", () => fetch(new Request(evil(good256))), mismatch(EVIL)],
      [
        'fetch(new Request(request, { integrity: "" }))',
        () => fetch(new Request(evil(good256), { integrity: "" })),
        ok(EVIL),
      ],
      ["the same Request, first fetch", () => fetch(twice), mismatch(EVIL)],
      ["the same Request, second fetch", () => fetch(twice), mismatch(EVIL)],
      ["fetch(subclass) match", () => fetch(good(good256, Subclass)), GOOD],
      ["fetch(subclass) mismatch", () => fetch(evil(good256, Subclass)), mismatch(EVIL)],
      [
        'fetch(subclass, { integrity: "" }) on another body',
        () => fetch(evil(good256, Subclass), { integrity: "" }),
        ok(EVIL),
      ],
      // What the Request stores applies. A property of the object does not hide it and does not replace it.
      [
        'fetch(subclass with an integrity getter that returns "")',
        () => fetch(evil(good256, GetterSubclass)),
        mismatch(EVIL),
      ],
      [
        'fetch(new Request(subclass with an integrity getter that returns ""))',
        () => fetch(new Request(evil(good256, GetterSubclass))),
        mismatch(EVIL),
      ],
      [
        'fetch(request with an own integrity property "")',
        () => fetch(withOwnProperty(evil(good256), "")),
        mismatch(EVIL),
      ],
      [
        'fetch(new Request(request with an own integrity property ""))',
        () => fetch(new Request(withOwnProperty(evil(good256), ""))),
        mismatch(EVIL),
      ],
      [
        "fetch(request with an own integrity property of another digest)",
        () => fetch(withOwnProperty(good(good256), bad256)),
        GOOD,
      ],
      [
        'fetch(subclass with an integrity getter that returns "", { integrity: "" })',
        () => fetch(evil(good256, GetterSubclass), { integrity: "" }),
        ok(EVIL),
      ],
      ["fetch(url, requestAsInit)", () => fetch(u("/evil"), good(good256)), mismatch(EVIL)],
      ["fetch(url, requestAsInit without integrity)", () => fetch(u("/evil"), new Request(u("/good"))), ok(EVIL)],
      ["fetch({ url, integrity }) match", () => fetch({ url: u("/good"), integrity: good256 } as any), GOOD],
      [
        "fetch({ url, integrity }) mismatch",
        () => fetch({ url: u("/evil"), integrity: good256 } as any),
        mismatch(EVIL),
      ],
      [
        "fetch({ url, integrity: wrong }, { integrity: right })",
        get({ url: u("/good"), integrity: bad256 } as any, good256),
        GOOD,
      ],
      [
        "fetch({ url, integrity: right }, { integrity: wrong })",
        get({ url: u("/good"), integrity: good256 } as any, bad256),
        mismatch(BODY),
      ],
      ["FetchSession.fetch match", () => session.fetch(u("/good"), { integrity: good256 }), GOOD],
      ["FetchSession.fetch mismatch", () => session.fetch(u("/evil"), { integrity: good256 }), mismatch(EVIL)],
    ];
    const cells = await Promise.all(table.map(([, start]) => outcome(start)));
    expect(table.map(([name], i) => [name, cells[i]])).toEqual(table.map(([name, , expected]) => [name, expected]));
    // fetch() and new Request() do not read the `integrity` property of a Request that is their input.
    expect(getterReads).toBe(0);
  });

  test("init.integrity is read first and once, and an input object's only when the init has none", async () => {
    const spy = (target: object) => {
      const keys: string[] = [];
      const proxy: any = new Proxy(target, {
        get(target, key, receiver) {
          if (typeof key === "string") keys.push(key);
          return Reflect.get(target, key, receiver);
        },
      });
      return { keys, proxy, reads: () => keys.filter(key => key === "integrity").length };
    };
    const init = spy({});
    const dataInit = spy({});
    const input = spy({ url: u("/good") });
    const overridden = { input: spy({ url: u("/good"), integrity: bad256 }), init: spy({ integrity: good256 }) };
    const inherited = { input: spy({ url: u("/good"), integrity: bad256 }), init: spy({}) };
    const outcomes = await Promise.all(
      [
        () => fetch(u("/good"), init.proxy),
        () => fetch("data:,x", dataInit.proxy),
        () => fetch(input.proxy),
        () => fetch(overridden.input.proxy, overridden.init.proxy),
        () => fetch(inherited.input.proxy, inherited.init.proxy),
      ].map(outcome),
    );
    expect({
      "fetch(url, init)": { first: init.keys[0], reads: init.reads() },
      "fetch(data:, init)": { keys: dataInit.keys },
      "fetch(input)": { afterUrl: input.keys[input.keys.indexOf("url") + 1], reads: input.reads() },
      "fetch(input, init with integrity)": [overridden.init.reads(), overridden.input.reads()],
      "fetch(input, init without integrity)": [inherited.init.reads(), inherited.input.reads()],
      outcomes,
    }).toEqual({
      "fetch(url, init)": { first: "integrity", reads: 1 },
      "fetch(data:, init)": { keys: ["integrity"] },
      "fetch(input)": { afterUrl: "integrity", reads: 1 },
      "fetch(input, init with integrity)": [1, 0],
      "fetch(input, init without integrity)": [1, 1],
      outcomes: [GOOD, ok("x"), GOOD, GOOD, mismatch(BODY)],
    });
  });

  test("a request that cannot be checked is refused before anything is sent", async () => {
    const seenBefore = seen.length;
    let getterCalls = 0;
    const cancelled: Record<string, string> = {};
    const streamed = (name: string) =>
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("streamed"));
          controller.close();
        },
        cancel(reason) {
          cancelled[name] = showError(reason);
        },
      });
    const boom = (message: string): string => {
      throw new Error(message);
    };
    const revoked = blobUrl(new Blob([BODY]));
    URL.revokeObjectURL(revoked);
    const upgrade = { headers: { Upgrade: "websocket", Connection: "Upgrade" } };
    const upload = (name: string) => ({
      method: "PUT",
      s3: { endpoint: u(""), accessKeyId: "a", secretAccessKey: "b" },
      body: streamed(name),
    });
    const table: Row[] = [
      ["a Symbol", get(u("/unsent/symbol"), Symbol("x")), "TypeError: Cannot convert a symbol to a string"],
      [
        "a getter that throws",
        () =>
          fetch(u("/unsent/getter"), {
            get integrity() {
              getterCalls++;
              return boom("from the getter");
            },
          }),
        "Error: from the getter",
      ],
      [
        "a toString() that throws",
        get(u("/unsent/toString"), { toString: () => boom("from toString()") }),
        "Error: from toString()",
      ],
      [
        "a getter that throws, data: URL",
        () =>
          fetch("data:,x", {
            get integrity() {
              return boom("from the getter, data:");
            },
          }),
        "Error: from the getter, data:",
      ],
      [
        "a signal that is already aborted",
        get(u("/unsent/aborted"), good256, { signal: AbortSignal.abort() }),
        "AbortError: The operation was aborted.",
      ],
      // An upgraded connection and the Response of a stream upload do not have the body of an HTTP response.
      ["an upgrade", get(r("/upgrade?unsent"), good256, upgrade), UNSUPPORTED],
      [
        "an upgrade with a ReadableStream body",
        get(r("/upgrade?unsent-stream"), good256, { ...upgrade, method: "POST", body: streamed("upgrade") }),
        UNSUPPORTED,
      ],
      ["an s3: stream upload", get("s3://bucket/unsent", good256, upload("s3")), UNSUPPORTED],
      // Without integrity the last two kinds are sent.
      ["an upgrade, no integrity", () => fetch(r("/upgrade?sent"), upgrade), ok("", 101)],
      ["an s3: stream upload, no integrity", () => fetch("s3://bucket/sent", upload("s3, no integrity")), ok("")],
      // A request that fetch() refuses for another reason keeps that reason.
      ["a blob: URL that is revoked", get(revoked, good256), "ERR_INVALID_ARG_VALUE"],
      ["a protocol that fetch() does not have", get("gopher://127.0.0.1/", good256), "ERR_INVALID_ARG_VALUE"],
    ];
    const cells = await Promise.all(table.map(([, start]) => outcome(start)));
    expect(table.map(([name], i) => [name, cells[i]])).toEqual(table.map(([name, , expected]) => [name, expected]));
    await roundTrip();
    expect({
      getterCalls,
      cancelled,
      sent: seen
        .slice(seenBefore)
        .filter(request => /unsent|upgrade|bucket\/(un)?sent/.test(request))
        .sort(),
    }).toEqual({
      getterCalls: 1,
      cancelled: { upgrade: UNSUPPORTED, s3: UNSUPPORTED },
      sent: ["GET /upgrade?sent", "PUT /bucket/sent"],
    });
  });
});

describe("integrity: data:, blob: and file: URLs", () => {
  const file = join(String(socketDir), "real.js");
  const fileUrl = pathToFileURL(file).href;
  const dataUrl = `data:text/javascript,${encodeURIComponent(BODY)}`;
  const base64Url = `data:text/javascript;base64,${Buffer.from(BODY).toString("base64")}`;
  const s3file = new Bun.S3Client({ endpoint: u(""), accessKeyId: "a", secretAccessKey: "b", bucket: "bucket" }).file(
    "real.js",
  );

  rows([
    ["data: match", get(dataUrl, good256), GOOD],
    ["data: mismatch", get(dataUrl, bad256), mismatch(BODY)],
    ["data: in base64, match", get(base64Url, good512), GOOD],
    ["data: in base64, mismatch", get(base64Url, bad512), mismatch(BODY, "sha512")],
    ["data: with an empty body + digest of ''", get("data:,", empty256), ok("")],
    ["data: with an empty body + another digest", get("data:,", good256), mismatch("")],
    ["blob: of a Blob in memory, match", () => fetch(blobUrl(new Blob([BODY])), { integrity: good256 }), GOOD],
    [
      "blob: of a Blob in memory, mismatch",
      () => fetch(blobUrl(new Blob([BODY])), { integrity: bad256 }),
      mismatch(BODY),
    ],
    [
      "blob: of a slice, match",
      () => fetch(blobUrl(new Blob(["// header\n", BODY]).slice(10)), { integrity: good256 }),
      GOOD,
    ],
    [
      "blob: of a slice + the digest of the whole Blob",
      () =>
        fetch(blobUrl(new Blob(["// header\n", BODY]).slice(10)), { integrity: sri("sha256", "// header\n" + BODY) }),
      mismatch(BODY),
    ],
    // fetch() does not read a file or an S3 object to check it: a body that is not in memory is refused.
    ["file: URL", get(fileUrl, good256), UNSUPPORTED],
    ["blob: of Bun.file()", () => fetch(blobUrl(Bun.file(file)), { integrity: good256 }), UNSUPPORTED],
    ["blob: of an S3 file", () => fetch(blobUrl(s3file), { integrity: good256 }), UNSUPPORTED],
    // Nothing to check: no integrity, and metadata that names no supported algorithm.
    ["file: URL, no integrity", () => fetch(fileUrl), GOOD],
    ['file: URL, integrity ""', get(fileUrl, ""), GOOD],
    ["file: URL, md5-AAAA", get(fileUrl, "md5-AAAA"), GOOD],
    ["blob: of Bun.file(), garbage", () => fetch(blobUrl(Bun.file(file)), { integrity: "garbage" }), GOOD],
  ]);

  test("the promise is settled when fetch() returns, as it is without integrity", () => {
    const states = (integrity?: string) =>
      [dataUrl, blobUrl(new Blob([BODY])), fileUrl].map(url => {
        const promise = fetch(url, { integrity });
        promise.catch(() => {});
        return Bun.peek.status(promise);
      });
    expect({ unchecked: states(), match: states(good256), mismatch: states(bad256) }).toEqual({
      unchecked: ["fulfilled", "fulfilled", "fulfilled"],
      match: ["fulfilled", "fulfilled", "rejected"],
      mismatch: ["rejected", "rejected", "rejected"],
    });
  });
});

describe.each([
  ["HTTP/2", `https://localhost:${(h2.address() as AddressInfo).port}`, { protocol: "http2", ...insecure }],
  ["HTTP/3", `https://localhost:${h3.port}`, { protocol: "http3", ...insecure }],
] as const)("integrity over %s", (_, origin, init) => {
  rows([
    ["match", get(`${origin}/good`, good256, init as BunFetchRequestInit), GOOD],
    ["mismatch", get(`${origin}/evil`, good256, init as BunFetchRequestInit), mismatch(EVIL)],
    ["gzip + digest of the decoded bytes", get(`${origin}/gzip`, good256, init as BunFetchRequestInit), GOOD],
    ["204", get(`${origin}/status/204`, empty256, init as BunFetchRequestInit), NULL_BODY],
    ["HEAD", get(`${origin}/good`, good256, { ...init, method: "HEAD" } as BunFetchRequestInit), NULL_BODY],
    ["2 MiB, match", get(`${origin}/big`, big256, init as BunFetchRequestInit), ok(BIG)],
    ["2 MiB, mismatch", get(`${origin}/big`, good256, init as BunFetchRequestInit), mismatch(BIG)],
  ]);
});

describe.concurrent("integrity in a child process", () => {
  async function run(script: string) {
    await using child = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ORIGIN: u("") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    return { stdout, stderr, exitCode };
  }

  test("a mismatch that nothing handles is reported and ends the process with code 1", async () => {
    const { stdout, stderr, exitCode } = await run(
      `fetch(process.env.ORIGIN + "/evil", { integrity: ${JSON.stringify(good256)} }); console.log("started");`,
    );
    expect(stdout).toBe("started\n");
    expect(stderr).toContain(`the response body has the digest "${sri("sha256", EVIL)}"`);
    expect(exitCode).toBe(1);
  });

  test("fetches that match, that mismatch and that have no body leave no protected promise behind", async () => {
    const { stdout, stderr, exitCode } = await run(/* js */ `
      import { heapStats } from "bun:jsc";
      const protectedPromises = () => {
        Bun.gc(true);
        return heapStats().protectedObjectTypeCounts.Promise ?? 0;
      };
      const origin = process.env.ORIGIN;
      const integrity = ${JSON.stringify(good256)};
      const batch = () =>
        Promise.allSettled([
          fetch(origin + "/good", { integrity }).then(response => response.bytes()),
          fetch(origin + "/evil", { integrity }),
          fetch(origin + "/status/204", { integrity }),
          fetch("data:,x", { integrity }),
        ]);
      // The first batch makes what is made once for the process.
      await batch();
      const before = protectedPromises();
      for (let i = 0; i < 25; i++) await batch();
      console.log(JSON.stringify({ leaked: Math.max(0, protectedPromises() - before) }));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe('{"leaked":0}\n');
    expect(exitCode).toBe(0);
  });
});
