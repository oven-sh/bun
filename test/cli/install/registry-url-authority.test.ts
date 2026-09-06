import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// A registry URL names the host `new URL()` names, however it reaches bun: the
// authority ends at `#`, `\` or `?` and the credentials end at the last `@`.
// Every registry below answers 404, so an install fails with exit 1; only where
// the manifest request lands and what it carries is checked.

function recorder() {
  const requests: { path: string; authorization: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      requests.push({ path: new URL(req.url).pathname, authorization: req.headers.get("authorization") });
      return new Response("not here", { status: 404 });
    },
  });
  return {
    port: server.port,
    requests,
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

async function install(files: Record<string, string>, args: string[], env: Record<string, string>) {
  using dir = tempDir("registry-url-authority", {
    "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "no-deps": "1.0.0" } }),
    ...files,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return await proc.exited;
}

const sources = {
  BUN_CONFIG_REGISTRY: (url: string) => ({ files: {}, args: [], env: { BUN_CONFIG_REGISTRY: url } }),
  "bunfig registry": (url: string) => ({
    files: { "bunfig.toml": Bun.TOML.stringify({ install: { registry: url } }) },
    args: [],
    env: {},
  }),
  ".npmrc registry": (url: string) => ({ files: { ".npmrc": `registry=${url}\n` }, args: [], env: {} }),
  "--registry": (url: string) => ({ files: {}, args: ["--registry", url], env: {} }),
};

describe.concurrent("registry URL authority", () => {
  // Every source goes through the same parser: the separators are covered once,
  // the sources with the one that regressed in 1.4. What follows the separator
  // is a fragment (`#`), a path prefix (`\` is `/`) or a query. A query makes
  // the registry URL unusable and nothing is requested at all.
  const prefixed = /^\/@127\.0\.0\.1\S*\/no-deps$/;
  test.each([
    ["BUN_CONFIG_REGISTRY", "#@", "/no-deps"],
    ["BUN_CONFIG_REGISTRY", "\\@", prefixed],
    ["BUN_CONFIG_REGISTRY", "?@", null],
    ["bunfig registry", "\\@", prefixed],
    [".npmrc registry", "\\@", prefixed],
    ["--registry", "\\@", prefixed],
  ] as const)(
    "%s: %j before a second host goes to the first host without credentials",
    async (source, separator, path) => {
      using a = recorder();
      using b = recorder();
      const { files, args, env } = sources[source](`http://127.0.0.1:${a.port}${separator}127.0.0.1:${b.port}/`);
      const exitCode = await install(files, args, env);
      expect({ a: a.requests, b: b.requests, exitCode }).toEqual({
        a:
          path === null
            ? []
            : [{ path: typeof path === "string" ? path : expect.stringMatching(path), authorization: null }],
        b: [],
        exitCode: 1,
      });
    },
  );

  test("credentials with an encoded @ are sent decoded", async () => {
    using a = recorder();
    const exitCode = await install({}, [], { BUN_CONFIG_REGISTRY: `http://carol:s3%40cret@127.0.0.1:${a.port}/` });
    expect({ a: a.requests, exitCode }).toEqual({
      a: [{ path: "/no-deps", authorization: `Basic ${Buffer.from("carol:s3@cret").toString("base64")}` }],
      exitCode: 1,
    });
  });

  test("a token before the host is still a Bearer token", async () => {
    using a = recorder();
    const exitCode = await install({}, [], { BUN_CONFIG_REGISTRY: `http://:tok-en@127.0.0.1:${a.port}/` });
    expect({ a: a.requests, exitCode }).toEqual({
      a: [{ path: "/no-deps", authorization: "Bearer tok-en" }],
      exitCode: 1,
    });
  });
});
