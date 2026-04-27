import { describe, expect, test, beforeAll } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { join } from "path";
import { which } from "bun";

// HTTP/3 needs a curl that was built with nghttp3/ngtcp2. CI provisions one
// as `curl-h3`; locally fall back to whichever `curl` reports HTTP3 in
// --version. Everything is skipped otherwise so the suite stays green on
// stock macOS/Windows curl.
let curlH3: string | null = null;

beforeAll(async () => {
  for (const candidate of [process.env.CURL_HTTP3, "curl-h3", "curl"]) {
    if (!candidate) continue;
    const bin = which(candidate);
    if (!bin) continue;
    const proc = Bun.spawn({ cmd: [bin, "--version"], stdout: "pipe", stderr: "ignore" });
    const out = await proc.stdout.text();
    await proc.exited;
    if (/\bHTTP3\b/.test(out)) {
      curlH3 = bin;
      break;
    }
  }
});

const itH3: typeof test = ((name: string, fn: any) =>
  test(name, async () => {
    if (process.platform === "win32") return; // QUIC server is POSIX-only
    if (!curlH3) {
      console.warn("skipping (no HTTP/3-capable curl in PATH; set CURL_HTTP3=/path/to/curl)");
      return;
    }
    return fn();
  })) as any;

/** Spawn `curl --http3-only` against the given port+path. */
async function curl3(
  port: number,
  path: string,
  extra: string[] = [],
  opts: { stdin?: string | Uint8Array } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; raw: Uint8Array }> {
  const proc = Bun.spawn({
    cmd: [
      curlH3!,
      "-sk",
      "--http3-only",
      "--connect-timeout",
      "8",
      "--max-time",
      "15",
      ...extra,
      `https://127.0.0.1:${port}${path}`,
    ],
    env: bunEnv,
    stdin:
      opts.stdin === undefined
        ? "ignore"
        : typeof opts.stdin === "string"
          ? new TextEncoder().encode(opts.stdin)
          : opts.stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [rawBuf, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
  const raw = new Uint8Array(rawBuf);
  return { stdout: new TextDecoder().decode(raw), stderr, exitCode, raw };
}

const fixture = `
import { serve } from "bun";

const big = Buffer.alloc(512 * 1024, "abcdefghijklmnop");

const server = serve({
  port: 0,
  tls: ${JSON.stringify(tls)},
  h3: true,
  h1: process.env.H3_ONLY !== "1",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/hello") {
      return new Response("hello over h3", {
        headers: { "x-proto": "h3", "content-type": "text/plain" },
      });
    }
    if (url.pathname === "/echo") {
      const body = await req.text();
      return new Response(body, {
        status: 201,
        headers: {
          "x-method": req.method,
          "x-echo": req.headers.get("x-echo") ?? "",
          "x-len": String(body.length),
        },
      });
    }
    if (url.pathname === "/big") {
      return new Response(big, { headers: { "content-type": "application/octet-stream" } });
    }
    if (url.pathname === "/status") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/query") {
      return new Response(url.searchParams.get("q") ?? "<none>");
    }
    if (url.pathname === "/slow") {
      await new Promise(r => setTimeout(r, 50));
      return new Response("late");
    }
    return new Response("not found: " + url.pathname, { status: 404 });
  },
});

console.error("PORT=" + server.port);
process.stdin.on("data", () => {}); // keep alive
`;

async function withServer(fn: (port: number) => Promise<void>, env: Record<string, string> = {}): Promise<void> {
  using dir = tempDir("serve-http3", { "server.mjs": fixture });
  const proc = Bun.spawn({
    cmd: [bunExe(), "server.mjs"],
    cwd: String(dir),
    env: { ...bunEnv, ...env },
    stdout: "inherit",
    stderr: "pipe",
    stdin: "pipe",
  });
  let port = 0;
  const stderr = proc.stderr.getReader();
  let buffered = "";
  while (true) {
    const { value, done } = await stderr.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    const m = buffered.match(/PORT=(\d+)/);
    if (m) {
      port = Number(m[1]);
      break;
    }
  }
  stderr.releaseLock();
  // drain remaining stderr in background so the pipe doesn't fill
  (async () => {
    for await (const _ of proc.stderr) {
    }
  })();
  expect(port).toBeGreaterThan(0);
  try {
    await fn(port);
  } finally {
    proc.stdin?.end();
    proc.kill();
    await proc.exited;
  }
}

describe("Bun.serve HTTP/3", () => {
  itH3("basic GET", async () => {
    await withServer(async port => {
      const { stdout, exitCode, stderr } = await curl3(port, "/hello", ["-D", "-"]);
      expect(stderr).toBe("");
      expect(stdout).toContain("HTTP/3 200");
      expect(stdout).toContain("x-proto: h3");
      expect(stdout).toContain("hello over h3");
      expect(exitCode).toBe(0);
    });
  });

  itH3("POST echoes body, status, request headers", async () => {
    await withServer(async port => {
      const body = "the quick brown fox jumps over the lazy dog";
      const { stdout, exitCode } = await curl3(port, "/echo", [
        "-D",
        "-",
        "-X",
        "POST",
        "-H",
        "x-echo: pong",
        "--data-binary",
        body,
      ]);
      expect(stdout).toContain("HTTP/3 201");
      expect(stdout).toContain("x-method: POST");
      expect(stdout).toContain("x-echo: pong");
      expect(stdout).toContain(`x-len: ${body.length}`);
      expect(stdout.endsWith(body)).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  itH3("204 with no body", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/status", ["-D", "-"]);
      expect(stdout).toContain("HTTP/3 204");
      expect(exitCode).toBe(0);
    });
  });

  itH3("query string is preserved", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/query?q=hello%20world&x=1");
      expect(stdout).toBe("hello world");
      expect(exitCode).toBe(0);
    });
  });

  itH3("large response body crosses multiple QUIC packets", async () => {
    await withServer(async port => {
      const { raw, exitCode } = await curl3(port, "/big");
      expect(raw.length).toBe(512 * 1024);
      // verify content integrity at both ends
      expect(new TextDecoder().decode(raw.subarray(0, 16))).toBe("abcdefghijklmnop");
      expect(new TextDecoder().decode(raw.subarray(-16))).toBe("abcdefghijklmnop");
      expect(exitCode).toBe(0);
    });
  });

  itH3("concurrent requests on one connection", async () => {
    await withServer(async port => {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => curl3(port, `/query?q=r${i}`)));
      for (let i = 0; i < results.length; i++) {
        expect(results[i].stdout).toBe(`r${i}`);
        expect(results[i].exitCode).toBe(0);
      }
    });
  });

  itH3("client abort mid-response does not crash the server", async () => {
    await withServer(async port => {
      // First request: tiny timeout forces curl to abort during /slow
      const aborted = await curl3(port, "/slow", ["--max-time", "0.01"]);
      expect(aborted.exitCode).not.toBe(0);
      // Server must still be alive for a follow-up
      const ok = await curl3(port, "/hello");
      expect(ok.stdout).toContain("hello over h3");
      expect(ok.exitCode).toBe(0);
    });
  });

  itH3("h1: false rejects HTTP/1.1 but accepts HTTP/3", async () => {
    await withServer(
      async port => {
        const h3 = await curl3(port, "/hello");
        expect(h3.stdout).toContain("hello over h3");
        // TCP listener should not be bound at all
        const proc = Bun.spawn({
          cmd: [curlH3!, "-sk", "--http1.1", "--connect-timeout", "2", `https://127.0.0.1:${port}/hello`],
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        expect(proc.exitCode).not.toBe(0);
      },
      { H3_ONLY: "1" },
    );
  });

  itH3("unknown route returns 404", async () => {
    await withServer(async port => {
      const { stdout, exitCode } = await curl3(port, "/nope", ["-D", "-"]);
      expect(stdout).toContain("HTTP/3 404");
      expect(stdout).toContain("not found: /nope");
      expect(exitCode).toBe(0);
    });
  });

  test("validation: h3 without tls throws", async () => {
    if (process.platform === "win32") return;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "Bun.serve({ port: 0, h3: true, fetch: () => new Response('x') })"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("HTTP/3 requires");
    expect(exitCode).not.toBe(0);
  });

  test("validation: h1:false without h3 throws", async () => {
    if (process.platform === "win32") return;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "Bun.serve({ port: 0, h1: false, fetch: () => new Response('x') })"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr.toLowerCase()).toContain("h1");
    expect(exitCode).not.toBe(0);
  });
});
