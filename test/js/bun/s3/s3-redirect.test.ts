import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A request that Bun signed is not sent again to the Location of a 3xx.

// Two loopback servers. `endpoint` is the configured S3 endpoint. It answers the
// object key "<status>/<cross|same>/<id>" with that status and a Location on
// `target` (cross) or on its own "/moved" path (same). Each request that arrives
// at a Location is recorded in `targetHits`.
const servers = `
const targetHits: string[] = [];
const endpointHits = new Map<string, number>();

const target = Bun.serve({
  port: 0,
  async fetch(req) {
    await req.arrayBuffer();
    targetHits.push(req.method + " " + new URL(req.url).pathname);
    return new Response(req.method === "HEAD" ? null : "TARGET-BODY");
  },
});

const endpoint = Bun.serve({
  port: 0,
  async fetch(req) {
    await req.arrayBuffer();
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/moved/")) {
      targetHits.push(req.method + " " + pathname);
      return new Response(req.method === "HEAD" ? null : "TARGET-BODY");
    }
    endpointHits.set(pathname, (endpointHits.get(pathname) ?? 0) + 1);
    const [, , status, kind] = pathname.split("/");
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      "<Error><Code>TemporaryRedirect</Code>" +
      "<Message>Please re-send this request to the specified temporary endpoint.</Message></Error>";
    return new Response(req.method === "HEAD" ? null : body, {
      status: Number(status) || 307,
      headers: {
        Location: kind === "same" ? "/moved" + pathname : new URL("/moved" + pathname, target.url).href,
        "Content-Type": "application/xml",
      },
    });
  },
});

const s3 = {
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretexample",
  sessionToken: "sessiontokenexample",
  region: "us-east-1",
  endpoint: endpoint.url.href,
};
`;

const clientFixture = `
import { S3Client } from "bun";
${servers}
const client = new S3Client({ ...s3, bucket: "bkt" });

async function attempt(name: string, run: () => Promise<unknown>) {
  try {
    return { name, resolved: await run(), code: null };
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
  attempt("text", () => client.file("307/cross/text").text()),
  attempt("slice", () => client.file("307/cross/slice").slice(0, 4).text()),
  attempt("stream", () => drain(client.file("307/cross/stream").stream())),
  attempt("write", () => client.write("307/cross/write", "payload")),
  attempt("writer", async () => {
    const writer = client.file("307/cross/writer").writer();
    writer.write("payload");
    return await writer.end();
  }),
  attempt("delete", () => client.delete("307/cross/delete")),
  attempt("list", () => client.list()),
  attempt("exists", () => client.exists("307/cross/exists")),
  attempt("stat", () => client.stat("307/cross/stat")),
]);

process.stdout.write(JSON.stringify({ ops, targetHits }));
target.stop(true);
endpoint.stop(true);
`;

const fetchMatrixFixture = `
${servers}
const ops: Record<string, () => RequestInit> = {
  "GET": () => ({}),
  "PUT string": () => ({ method: "PUT", body: "payload" }),
  "PUT Blob": () => ({ method: "PUT", body: new Blob(["payload"]) }),
  "HEAD": () => ({ method: "HEAD" }),
  "DELETE": () => ({ method: "DELETE" }),
  "ranged GET": () => ({ headers: { range: "bytes=0-3" } }),
};
const modes: Record<string, (url: string, init: RequestInit) => Promise<Response>> = {
  "default": (url, init) => fetch(url, { ...init, s3 }),
  "redirect: follow": (url, init) => fetch(url, { ...init, s3, redirect: "follow" }),
  "Request": (url, init) => fetch(new Request(url, init), { s3 }),
};

let rows = 0;
const bad: unknown[] = [];
for (const status of [301, 302, 303, 307, 308]) {
  for (const kind of ["cross", "same"]) {
    for (const [op, init] of Object.entries(ops)) {
      for (const [mode, call] of Object.entries(modes)) {
        const key = status + "/" + kind + "/" + rows++;
        let got: Record<string, unknown>;
        try {
          const res = await call("s3://bkt/" + key, init());
          await res.arrayBuffer();
          got = { status: res.status, redirected: res.redirected, location: res.headers.has("location") };
        } catch (e) {
          got = { rejected: (e as { code?: unknown }).code ?? (e as Error).name };
        }
        got.endpoint = endpointHits.get("/bkt/" + key) ?? 0;
        got.target = targetHits.filter(hit => hit.endsWith("/bkt/" + key)).length;
        const want = { status, redirected: false, location: true, endpoint: 1, target: 0 };
        if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ row: [status, kind, op, mode].join(", "), got });
      }
    }
  }
}

process.stdout.write(JSON.stringify({ rows, badCount: bad.length, bad: bad.slice(0, 8) }));
target.stop(true);
endpoint.stop(true);
`;

const fetchModesFixture = `
${servers}
async function settle(run: () => Promise<Response>) {
  try {
    const res = await run();
    await res.arrayBuffer();
    return { status: res.status, redirected: res.redirected };
  } catch (e) {
    return { rejected: (e as { code?: unknown }).code ?? (e as Error).name };
  }
}

using session = new Bun.FetchSession();
const results = {
  "redirect: error": await settle(() => fetch("s3://bkt/307/cross/error", { s3, redirect: "error" })),
  "Request with redirect: error": await settle(() =>
    fetch(new Request("s3://bkt/307/cross/request-error", { redirect: "error" }), { s3 }),
  ),
  "redirect: manual": await settle(() => fetch("s3://bkt/307/cross/manual", { s3, redirect: "manual" })),
  "maxRedirects: 0": await settle(() => fetch("s3://bkt/307/cross/max-redirects", { s3, maxRedirects: 0 })),
  "Bun.fetch": await settle(() => Bun.fetch("s3://bkt/307/cross/bun-fetch", { s3 })),
  "FetchSession#fetch": await settle(() => session.fetch("s3://bkt/307/cross/session", { s3 })),
};

process.stdout.write(JSON.stringify({ results, targetHits }));
target.stop(true);
endpoint.stop(true);
`;

// An inherited proxy would hijack the requests to the loopback servers.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

async function run(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: envWithoutProxy,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  return { result: JSON.parse(stdout), exitCode };
}

describe.concurrent("a 3xx from the S3 endpoint is not followed", () => {
  test("S3Client rejects", async () => {
    const { result, exitCode } = await run(clientFixture);

    expect(result.targetHits).toEqual([]);
    const ops = Object.fromEntries(
      (result.ops as { name: string; resolved: unknown; code: unknown }[]).map(op => [op.name, op]),
    );
    // An operation whose response has the XML error body reports its <Code>.
    for (const name of ["text", "slice", "stream", "write", "writer", "delete", "list"]) {
      expect(ops[name]).toEqual({ name, resolved: null, code: "TemporaryRedirect" });
    }
    // A HEAD response has no body.
    for (const name of ["exists", "stat"]) {
      expect(ops[name]).toEqual({ name, resolved: null, code: expect.any(String) });
    }
    expect(exitCode).toBe(0);
  });

  test('fetch("s3://") resolves with the 3xx for each method, status, Location and way to ask for "follow"', async () => {
    const { result, exitCode } = await run(fetchMatrixFixture);

    expect(result).toEqual({ rows: 180, badCount: 0, bad: [] });
    expect(exitCode).toBe(0);
  });

  test('fetch("s3://") keeps "error" and "manual", and maxRedirects has no effect', async () => {
    const { result, exitCode } = await run(fetchModesFixture);

    expect(result).toEqual({
      results: {
        "redirect: error": { rejected: "UnexpectedRedirect" },
        "Request with redirect: error": { rejected: "UnexpectedRedirect" },
        "redirect: manual": { status: 307, redirected: false },
        "maxRedirects: 0": { status: 307, redirected: false },
        "Bun.fetch": { status: 307, redirected: false },
        "FetchSession#fetch": { status: 307, redirected: false },
      },
      targetHits: [],
    });
    expect(exitCode).toBe(0);
  });
});
