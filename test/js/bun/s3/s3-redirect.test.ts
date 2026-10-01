import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// S3 answers a request for the wrong region or endpoint with a 301/307 whose
// body is an <Error><Code>PermanentRedirect</Code>... document. The AWS SDKs
// report that as an error and the caller picks the endpoint. They do not send
// the request again to the host in the Location header. This test pins the same
// behaviour: a 3xx from the configured endpoint rejects, and the Location host
// receives no request.

const fixture = `
import { S3Client } from "bun";

const targetSeen: { method: string; path: string }[] = [];

// The host that the Location header names. It records each request it receives.
const target = Bun.serve({
  port: 0,
  async fetch(req) {
    await req.arrayBuffer();
    targetSeen.push({ method: req.method, path: new URL(req.url).pathname });
    return new Response(req.method === "HEAD" ? null : "TARGET-BODY", {
      headers: { "Content-Length": "11", ETag: '"etag"' },
    });
  },
});

// The configured S3 endpoint. It answers every request with a 307 to the
// target, with the XML error body that S3 sends.
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
  sessionToken: "sessiontokenexample",
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
  attempt("write", s3.write("object.txt", "payload")),
  attempt("exists", s3.exists("object.txt")),
  attempt("delete", s3.delete("object.txt")),
  attempt("list", s3.list()),
  attempt("stream", drain(s3.file("object.txt").stream())),
]);

process.stdout.write(JSON.stringify({ ops, targetSeen }));
target.stop(true);
origin.stop(true);
`;

// An inherited proxy would hijack the requests to the loopback servers.
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

    // The Location host receives no request.
    expect(result.targetSeen).toEqual([]);

    // Every operation rejects. An operation whose response has the XML error
    // body reports its <Code>. A HEAD response has no body, so exists() only
    // has to reject.
    expect(ops.text).toEqual({ name: "text", resolved: null, code: "TemporaryRedirect" });
    expect(ops.write).toEqual({ name: "write", resolved: null, code: "TemporaryRedirect" });
    expect(ops.delete).toEqual({ name: "delete", resolved: null, code: "TemporaryRedirect" });
    expect(ops.list).toEqual({ name: "list", resolved: null, code: "TemporaryRedirect" });
    expect(ops.stream).toEqual({ name: "stream", resolved: null, code: "TemporaryRedirect" });
    expect(ops.exists.resolved).toBeNull();

    expect(exitCode).toBe(0);
  });
});
