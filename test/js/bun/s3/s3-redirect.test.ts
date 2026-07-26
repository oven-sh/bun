import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// S3 endpoints signal wrong-region / wrong-endpoint with a 301/307 whose body
// is an <Error><Code>PermanentRedirect</Code>... document. The AWS SDKs surface
// that as an error so the caller can re-target and re-sign; they never replay
// the signed request (credentials + body) to whatever host the Location header
// names. These tests pin that behaviour: a 3xx from the configured endpoint
// must reject, and the Location target must see nothing.

const fixture = `
import { S3Client } from "bun";

type Seen = { method: string; securityToken: string | null; date: string | null; bodyLength: number };
const targetSeen: Seen[] = [];

// The host the origin's Location header points at. It records any request it
// receives; the S3 client must never reach it.
const target = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = await req.arrayBuffer();
    targetSeen.push({
      method: req.method,
      securityToken: req.headers.get("x-amz-security-token"),
      date: req.headers.get("x-amz-date"),
      bodyLength: body.byteLength,
    });
    return new Response(req.method === "HEAD" ? null : "TARGET-BODY", {
      headers: { "Content-Length": "11", ETag: '"etag"' },
    });
  },
});

// The configured S3 endpoint. Always answers 307 -> target, with an
// S3-shaped XML error body so the surfaced error carries a useful code.
const origin = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      "<Error><Code>TemporaryRedirect</Code>" +
      "<Message>Please re-send this request to the specified temporary endpoint.</Message>" +
      "<Endpoint>" + target.url.host + "</Endpoint></Error>";
    return new Response(req.method === "HEAD" ? null : body, {
      status: 307,
      headers: {
        Location: new URL(url.pathname + url.search, target.url).href,
        "Content-Type": "application/xml",
        "Content-Length": String(body.length),
      },
    });
  },
});

const s3 = new S3Client({
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretexample",
  sessionToken: "STS-SESSION-TOKEN-MUST-NOT-LEAVE-ORIGIN",
  region: "us-east-1",
  endpoint: origin.url.href,
  bucket: "bkt",
});

type Op = { name: string; resolved: unknown; code: unknown };
async function attempt(name: string, p: Promise<unknown>): Promise<Op> {
  try {
    return { name, resolved: await p, code: null };
  } catch (e) {
    return { name, resolved: null, code: (e as { code?: unknown }).code ?? (e as Error).name };
  }
}

async function drain(stream: ReadableStream): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += Buffer.from(chunk).toString();
  return out;
}

const ops = await Promise.all([
  attempt("text", s3.file("object.txt").text()),
  attempt("write", s3.write("object.txt", "PAYLOAD-THAT-MUST-NOT-LEAVE-ORIGIN")),
  attempt("exists", s3.exists("object.txt")),
  attempt("delete", s3.delete("object.txt")),
  attempt("list", s3.list()),
  attempt("stream", drain(s3.file("object.txt").stream())),
]);

process.stdout.write(JSON.stringify({ ops, targetSeen }));
target.stop(true);
origin.stop(true);
`;

// The S3 client does not honour NO_PROXY, so an inherited proxy would hijack
// the request to the loopback servers.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

describe("S3Client does not follow HTTP redirects", () => {
  test("3xx from the endpoint rejects and nothing is sent to the Location host", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: envWithoutProxy,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as {
      ops: { name: string; resolved: unknown; code: unknown }[];
      targetSeen: unknown[];
    };
    const ops = Object.fromEntries(result.ops.map(o => [o.name, o]));

    // The security-relevant assertion: no signed header, no session token and no
    // request body was ever delivered to the host named in Location.
    expect(result.targetSeen).toEqual([]);

    // Every operation must reject. Operations whose response carries the XML
    // error body surface its <Code>; HEAD has no body so exists() only needs
    // to reject.
    expect(ops.text).toEqual({ name: "text", resolved: null, code: "TemporaryRedirect" });
    expect(ops.write).toEqual({ name: "write", resolved: null, code: "TemporaryRedirect" });
    expect(ops.delete).toEqual({ name: "delete", resolved: null, code: "TemporaryRedirect" });
    expect(ops.list).toEqual({ name: "list", resolved: null, code: "TemporaryRedirect" });
    expect(ops.stream).toEqual({ name: "stream", resolved: null, code: "TemporaryRedirect" });
    expect(ops.exists.resolved).toBeNull();

    expect(exitCode).toBe(0);
  });
});
