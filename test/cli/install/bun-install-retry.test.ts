import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  readdirSorted,
  tempDir,
  tls,
  tmpdirSync,
  toBeValidBin,
  toBeWorkspaceLink,
  toHaveBins,
} from "harness";
import { join } from "path";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  requested,
  root_url,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);

expect.extend({
  toHaveBins,
  toBeValidBin,
  toBeWorkspaceLink,
});

let port: string;
let add_dir: string;
setDefaultTimeout(1000 * 60 * 5);

beforeAll(() => {
  port = new URL(root_url).port;
});

beforeEach(async () => {
  add_dir = tmpdirSync();
  await dummyBeforeEach();
});
afterEach(async () => {
  await dummyAfterEach();
});

// Manifest request 302-redirects and the redirect target answers a retryable
// 500 once. The install retry must restart from the original manifest URL.
it("retries a manifest whose redirect target 500s once", async () => {
  const urls: string[] = [];
  let redirectTargetHits = 0;
  setHandler(async request => {
    const { pathname } = new URL(request.url);
    urls.push(pathname);
    if (pathname === "/BaR") {
      return new Response(null, { status: 302, headers: { Location: `${root_url}/redirected/BaR` } });
    }
    if (pathname === "/redirected/BaR") {
      if (redirectTargetHits++ === 0) {
        return new Response("transient", { status: 500 });
      }
      return Response.json({
        name: "BaR",
        versions: {
          "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
        },
        "dist-tags": { latest: "0.0.2" },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
  // The retry restarts from the original manifest URL, so the server sees the
  // whole redirect chain a second time.
  expect(urls).toEqual(["/BaR", "/redirected/BaR", "/BaR", "/redirected/BaR", "/BaR-0.0.2.tgz"]);
  expect(await file(join(package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

// The registry (reached as `localhost`) redirects the manifest to a second
// server standing in for a CDN, and the retry restarts from the registry URL.
// Neither another hostname nor another port of the same hostname gets the
// token, and the retry must carry the original headers again and apply the
// same rule. Which redirects keep the token is covered by "registry token
// across redirects" in bun-install.test.ts.
const token = "test-registry-token";
it.each(["localhost", "127.0.0.1"])("retries an authorized manifest redirected to %s when it 500s once", async host => {
  const registryUrls: string[] = [];
  const cdnAuth: (string | null)[] = [];
  let cdnHits = 0;
  await using cdn = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/cdn/BaR") {
        return new Response("unexpected", { status: 404 });
      }
      cdnAuth.push(request.headers.get("authorization"));
      if (cdnHits++ === 0) {
        return new Response("transient", { status: 500 });
      }
      return Response.json({
        name: "BaR",
        versions: {
          "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
        },
        "dist-tags": { latest: "0.0.2" },
      });
    },
  });
  setHandler(async request => {
    const { pathname } = new URL(request.url);
    registryUrls.push(pathname);
    if (pathname === "/BaR") {
      // The registry requires the token on every request, including the retry.
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("missing authorization", { status: 401 });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: `http://${host}:${cdn.port}/cdn/BaR` },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: false,
        registry: { url: `${root_url}/`, token },
        saveTextLockfile: false,
      },
    }),
  );
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
  // Both registry hits carried the token (the handler 401s otherwise).
  expect(registryUrls).toEqual(["/BaR", "/BaR", "/BaR-0.0.2.tgz"]);
  expect(cdnAuth).toEqual([null, null]);
});

// Sibling retry site (tarball downloads in runTasks): the tarball URL
// 302-redirects and the target 500s once before serving the archive.
it("retries a tarball whose redirect target 500s once", async () => {
  const urls: string[] = [];
  let redirectTargetHits = 0;
  setHandler(async request => {
    const { pathname } = new URL(request.url);
    urls.push(pathname);
    if (pathname === "/BaR") {
      return Response.json({
        name: "BaR",
        versions: {
          "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
        },
        "dist-tags": { latest: "0.0.2" },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response(null, { status: 302, headers: { Location: `${root_url}/redirected/BaR-0.0.2.tgz` } });
    }
    if (pathname === "/redirected/BaR-0.0.2.tgz") {
      if (redirectTargetHits++ === 0) {
        return new Response("transient", { status: 500 });
      }
      return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  expect(out).toContain("1 package installed");
  expect(exitCode).toBe(0);
  expect(urls).toEqual([
    "/BaR",
    "/BaR-0.0.2.tgz",
    "/redirected/BaR-0.0.2.tgz",
    "/BaR-0.0.2.tgz",
    "/redirected/BaR-0.0.2.tgz",
  ]);
  expect(await file(join(package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
    name: "bar",
    version: "0.0.2",
  });
});

// The retry notice is added to the log as a warning, and the log printer
// prefixes it with `warn: ` when it prints it. The message itself used to carry
// a second `warn: `, so every retry printed as `warn: warn: ...`.
it("prints each verbose tarball retry as a single warn: line", async () => {
  setHandler(async request => {
    const { pathname } = new URL(request.url);
    if (pathname === "/BaR") {
      return Response.json({
        name: "BaR",
        "dist-tags": { latest: "0.0.2" },
        versions: {
          "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
        },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response("no", { status: 500 });
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "--verbose", "--no-progress", "--ignore-scripts"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: { ...env, BUN_CONFIG_HTTP_RETRY_COUNT: "2" },
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err.split(/\r?\n/).filter(line => line.includes("downloading tarball"))).toEqual([
    "warn: TarballFailedToDownload downloading tarball BaR@0.0.2. Retrying 1/2 in 1ms...",
    "warn: TarballFailedToDownload downloading tarball BaR@0.0.2. Retrying 2/2 in 2ms...",
  ]);
  expect(err).toContain(`error: GET ${root_url}/BaR-0.0.2.tgz - 500`);
  expect(out).not.toContain("installed");
  expect(exitCode).toBe(1);
});

it("retries on 500", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, undefined, 4));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add", "BaR", "--linker=hoisted"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Saved lockfile");
  const out = await stdout.text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    expect.stringContaining("bun add v1."),
    "",
    "installed BaR@0.0.2",
    "",
    "1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(urls.sort()).toEqual([
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
    `${root_url}/BaR-0.0.2.tgz`,
  ]);
  expect(requested).toBe(12);
  await Promise.all([
    (async () => expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "BaR"]))(),
    (async () => expect(await readdirSorted(join(package_dir, "node_modules", "BaR"))).toEqual(["package.json"]))(),
    (async () =>
      expect(await file(join(package_dir, "node_modules", "BaR", "package.json")).json()).toEqual({
        name: "bar",
        version: "0.0.2",
      }))(),
    (async () =>
      expect(await file(join(package_dir, "package.json")).text()).toEqual(
        JSON.stringify(
          {
            name: "foo",
            version: "0.0.1",
            dependencies: {
              BaR: "^0.0.2",
            },
          },
          null,
          2,
        ),
      ))(),
    async () => await access(join(package_dir, "bun.lockb")),
  ]);
});

// A tarball that fails permanently must run its download (and retry cycle)
// exactly once and be reported as exactly one error. Previously the resolve
// phase's failure dropped the dedupe entry so the install phase re-ran the
// entire download: a 500 endpoint saw 12 GETs instead of 6 and the same
// `error: GET ...` line was printed twice.
describe.each(["hoisted", "isolated"])("linker=%s", linker => {
  it.each([
    { status: 404, expectedGets: 1 },
    { status: 500, expectedGets: 6 },
  ])("does not re-download a tarball that already failed with $status", async ({ status, expectedGets }) => {
    const urls: string[] = [];
    setHandler(async request => {
      const { pathname } = new URL(request.url);
      urls.push(pathname);
      if (pathname === "/BaR") {
        return Response.json({
          name: "BaR",
          "dist-tags": { latest: "0.0.2" },
          versions: {
            "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
          },
        });
      }
      if (pathname === "/BaR-0.0.2.tgz") {
        return new Response("no", { status });
      }
      return new Response("unexpected", { status: 404 });
    });
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: `${root_url}/`,
          linker,
        },
      }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { BaR: "0.0.2" } }),
    );
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--no-progress", "--ignore-scripts"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

    const tarballGets = urls.filter(u => u === "/BaR-0.0.2.tgz");
    const errorLines = err.split("\n").filter(l => l.startsWith("error:"));
    expect({ tarballGets: tarballGets.length, errorLines }).toEqual({
      tarballGets: expectedGets,
      errorLines: [`error: GET ${root_url}/BaR-0.0.2.tgz - ${status}`],
    });
    expect(out).not.toContain("installed");
    expect(exitCode).toBe(1);
  });

  it("does not re-download an optional dependency's tarball that already failed", async () => {
    const urls: string[] = [];
    setHandler(async request => {
      const { pathname } = new URL(request.url);
      urls.push(pathname);
      if (pathname === "/BaR") {
        return Response.json({
          name: "BaR",
          "dist-tags": { latest: "0.0.2" },
          versions: {
            "0.0.2": { name: "BaR", version: "0.0.2", dist: { tarball: `${root_url}/BaR-0.0.2.tgz` } },
          },
        });
      }
      if (pathname === "/BaR-0.0.2.tgz") return new Response("no", { status: 404 });
      if (pathname === "/baz") {
        return Response.json({
          name: "baz",
          "dist-tags": { latest: "0.0.3" },
          versions: {
            "0.0.3": { name: "baz", version: "0.0.3", dist: { tarball: `${root_url}/baz-0.0.3.tgz` } },
          },
        });
      }
      if (pathname === "/baz-0.0.3.tgz") return new Response(file(join(import.meta.dir, "baz-0.0.3.tgz")));
      return new Response("unexpected", { status: 404 });
    });
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({
        install: {
          cache: false,
          registry: `${root_url}/`,
          linker,
        },
      }),
    );
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: { baz: "0.0.3" },
        optionalDependencies: { BaR: "0.0.2" },
      }),
    );
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--no-progress", "--ignore-scripts"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });
    const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);

    const tarballGets = urls.filter(u => u === "/BaR-0.0.2.tgz");
    const warnLines = err.split("\n").filter(l => l.startsWith("warn:"));
    const errorLines = err.split("\n").filter(l => l.startsWith("error:"));
    expect({ tarballGets: tarballGets.length, warnLines, errorLines }).toEqual({
      tarballGets: 1,
      warnLines: [`warn: GET ${root_url}/BaR-0.0.2.tgz - 404`],
      errorLines: [],
    });
    expect(await file(join(package_dir, "node_modules", "baz", "package.json")).json()).toMatchObject({
      name: "baz",
      version: "0.0.3",
    });
    if (linker === "hoisted") {
      expect(out).not.toContain("Failed to install");
      expect(exitCode).toBe(0);
    }
  });
});

describe.concurrent("backoff", () => {
  type Kind = "manifest" | "tarball";

  /**
   * Serves `bar@0.0.2`. `answer` may replace the answer to the n-th (1-based)
   * request for the manifest / the tarball. Every request is recorded.
   */
  function flakyRegistry(answer: (kind: Kind, hit: number) => Response | undefined) {
    const at: Record<Kind, number[]> = { manifest: [], tarball: [] };
    const authorization: Record<Kind, (string | null)[]> = { manifest: [], tarball: [] };
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const kind: Kind = request.url.endsWith(".tgz") ? "tarball" : "manifest";
        at[kind].push(performance.now());
        authorization[kind].push(request.headers.get("authorization"));
        const replaced = answer(kind, at[kind].length);
        if (replaced) return replaced;
        if (kind === "tarball") return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
        return Response.json({
          name: "bar",
          "dist-tags": { latest: "0.0.2" },
          versions: { "0.0.2": { name: "bar", version: "0.0.2", dist: { tarball: `${server.url}bar-0.0.2.tgz` } } },
        });
      },
    });
    return {
      url: server.url.href,
      at,
      authorization,
      /** Milliseconds between one request and the next. */
      gaps: (kind: Kind) => at[kind].slice(1).map((time, i) => time - at[kind][i]),
      [Symbol.dispose]: () => void server.stop(true),
    };
  }

  function project(registry: string | { url: string; token: string }) {
    return tempDir("install-retry-backoff", {
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { cache: false, registry } }),
    });
  }

  async function install(cwd: string, extraEnv: Record<string, string> = {}, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "install", "--no-progress", ...args],
      cwd,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env: { ...env, ...extraEnv },
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { out, err, lines: err.split(/\r?\n/), exitCode };
  }

  const busy = (status: number, retryAfter?: string | null) =>
    new Response("busy", { status, headers: retryAfter == null ? {} : { "Retry-After": retryAfter } });

  // There is one dependency: while its request backs off nothing is in flight,
  // and the install goes on only because the timer wakes it.
  it.each(["manifest", "tarball"] as const)("waits longer before each retry of a %s", async failing => {
    using registry = flakyRegistry((kind, hit) => (kind === failing && hit <= 3 ? busy(503) : undefined));
    using dir = project(registry.url);
    const { err, out, exitCode } = await install(String(dir), { BUN_CONFIG_HTTP_RETRY_BACKOFF: "50" });
    expect(err).not.toContain("error:");
    expect(out).toContain("1 package installed");
    // 50, 100 and 200 ms, each less 20% at most. A busy machine only makes them longer.
    const gaps = registry.gaps(failing);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeGreaterThanOrEqual(40);
    expect(gaps[1]).toBeGreaterThanOrEqual(80);
    expect(gaps[2]).toBeGreaterThanOrEqual(160);
    expect(exitCode).toBe(0);
  });

  // With a lockfile the tarball is downloaded by the linker's own wait loop.
  it.each(["hoisted", "isolated"])("the %s linker waits for a tarball that backs off", async linker => {
    using registry = flakyRegistry((kind, hit) => (kind === "tarball" && hit <= 2 ? busy(500) : undefined));
    using dir = project(registry.url);
    expect(await install(String(dir), {}, "--lockfile-only")).toMatchObject({ exitCode: 0 });
    expect(registry.at.tarball).toHaveLength(0);
    const { err, out, exitCode } = await install(String(dir), {}, `--linker=${linker}`);
    expect(err).not.toContain("error:");
    expect(out).toContain("1 package installed");
    expect(registry.at.tarball).toHaveLength(3);
    expect(await file(join(String(dir), "node_modules", "bar", "package.json")).json()).toEqual({
      name: "bar",
      version: "0.0.2",
    });
    expect(exitCode).toBe(0);
  });

  it.each([
    ["manifest", 429],
    ["tarball", 503],
  ] as const)("waits as long as the Retry-After of a %s answered with %d", async (failing, status) => {
    using registry = flakyRegistry((kind, hit) => (kind === failing && hit === 1 ? busy(status, "1") : undefined));
    using dir = project(registry.url);
    const { err, lines, out, exitCode } = await install(String(dir));
    expect(err).not.toContain("error:");
    expect(lines.filter(line => line.includes("asked to wait"))).toEqual([
      "warn: the registry asked to wait 1s before the next attempt",
    ]);
    expect(out).toContain("1 package installed");
    expect(registry.gaps(failing)).toEqual([expect.any(Number)]);
    expect(registry.gaps(failing)[0]).toBeGreaterThanOrEqual(1000);
    expect(exitCode).toBe(0);
  });

  it("waits a minute at most, and says so at once", async () => {
    using registry = flakyRegistry((kind, hit) => (kind === "manifest" && hit === 1 ? busy(429, "86400") : undefined));
    using dir = project(registry.url);
    await using proc = spawn({
      cmd: [bunExe(), "install", "--no-progress"],
      cwd: String(dir),
      stdout: "ignore",
      stdin: "ignore",
      stderr: "pipe",
      env,
    });
    let err = "";
    for await (const chunk of proc.stderr.pipeThrough(new TextDecoderStream())) {
      err += chunk;
      if (err.includes("next attempt\n")) break;
    }
    expect(err).toContain("warn: the registry asked to wait 60s before the next attempt\n");
    expect(registry.at.manifest).toHaveLength(1);
  });

  // `--verbose` prints the wait. The harness sets a base of 1 ms, too small for any jitter.
  it.each([
    { retryAfter: null, backoff: "1", wait: /^1ms$/ },
    { retryAfter: "0", backoff: "1", wait: /^1ms$/ },
    { retryAfter: "-1", backoff: "1", wait: /^1ms$/ },
    { retryAfter: "soon", backoff: "1", wait: /^1ms$/ },
    { retryAfter: "Wed, 21 Oct 2096 07:28:00 GMT", backoff: "1", wait: /^1ms$/ },
    { retryAfter: "3600", backoff: "0", wait: /^0ms$/ },
    { retryAfter: null, backoff: "nonsense", wait: /^(2[0-9][0-9]|300)ms$/ },
  ])("Retry-After: $retryAfter with a base of $backoff", async ({ retryAfter, backoff, wait }) => {
    using registry = flakyRegistry((_, hit) => (hit === 1 ? busy(503, retryAfter) : undefined));
    using dir = project(registry.url);
    const { err, lines, exitCode } = await install(
      String(dir),
      { BUN_CONFIG_HTTP_RETRY_BACKOFF: backoff },
      "--verbose",
    );
    expect(err).not.toContain("error:");
    expect(err).not.toContain("asked to wait");
    const waits = lines.flatMap(
      line => /^warn: .* downloading .* Retry(?:ing)? 1\/5 in (\d+ms)\.\.\.$/.exec(line)?.[1] ?? [],
    );
    expect(waits).toEqual([expect.stringMatching(wait), expect.stringMatching(wait)]);
    expect(exitCode).toBe(0);
  });

  it.each([
    { status: 408, requests: 2 },
    { status: 429, requests: 2 },
    { status: 500, requests: 2 },
    { status: 400, requests: 1 },
    { status: 401, requests: 1 },
    { status: 404, requests: 1 },
  ])("a $status is asked for $requests time(s)", async ({ status, requests }) => {
    for (const failing of ["manifest", "tarball"] as const) {
      using registry = flakyRegistry((kind, hit) => (kind === failing && hit === 1 ? busy(status) : undefined));
      using dir = project(registry.url);
      const { exitCode } = await install(String(dir));
      expect({ failing, requests: registry.at[failing].length, exitCode }).toEqual({
        failing,
        requests,
        exitCode: requests === 2 ? 0 : 1,
      });
    }
  });

  it("sends the retry with the headers of the first attempt", async () => {
    using registry = flakyRegistry((_, hit) => (hit <= 2 ? busy(503) : undefined));
    using dir = project({ url: registry.url, token: "retry-token" });
    const { err, exitCode } = await install(String(dir));
    expect(err).not.toContain("error:");
    expect(registry.authorization).toEqual({
      manifest: ["Bearer retry-token", "Bearer retry-token", "Bearer retry-token"],
      tarball: ["Bearer retry-token", "Bearer retry-token", "Bearer retry-token"],
    });
    expect(exitCode).toBe(0);
  });

  // The retry starts from the registry's URL again, with the token, and the token follows the
  // same-origin redirect again.
  it("sends the token again after a 503 behind a same-origin redirect", async () => {
    const seen: [string, string | null][] = [];
    let redirected = 0;
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const { pathname } = new URL(request.url);
        seen.push([pathname, request.headers.get("authorization")]);
        if (pathname === "/bar") return Response.redirect(`${server.url}moved/bar`, 302);
        if (pathname.endsWith(".tgz")) return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
        if (++redirected === 1) return busy(503);
        return Response.json({
          name: "bar",
          "dist-tags": { latest: "0.0.2" },
          versions: { "0.0.2": { name: "bar", version: "0.0.2", dist: { tarball: `${server.url}bar-0.0.2.tgz` } } },
        });
      },
    });
    using dir = project({ url: server.url.href, token: "retry-token" });
    const { err, exitCode } = await install(String(dir));
    expect(err).not.toContain("error:");
    expect(seen).toEqual([
      ["/bar", "Bearer retry-token"],
      ["/moved/bar", "Bearer retry-token"],
      ["/bar", "Bearer retry-token"],
      ["/moved/bar", "Bearer retry-token"],
      ["/bar-0.0.2.tgz", "Bearer retry-token"],
    ]);
    expect(exitCode).toBe(0);
  });

  // The next handshake would see the same certificate.
  it("does not retry a certificate it refuses", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("unreachable") });
    using dir = project(server.url.href);
    // The default backoff: five retries would take over 6 seconds.
    const { lines, exitCode } = await install(String(dir), { BUN_CONFIG_HTTP_RETRY_BACKOFF: "" }, "--verbose");
    expect(lines.filter(line => line.includes("downloading package manifest"))).toEqual([
      "error: DEPTH_ZERO_SELF_SIGNED_CERT downloading package manifest bar",
    ]);
    expect(exitCode).toBe(1);
  });

  describe("request concurrency", () => {
    /**
     * `bar` needs 8 packages, so the install wants their 8 manifests at once. The
     * connection of the first `drops` requests for `bar` is closed without an
     * answer. The 8 manifests are held until `together` of them are in flight.
     */
    async function peakAfter(drops: number, together: number) {
      using dropped = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) {
            socket.end();
          },
          data() {},
        },
      });
      const names = Array.from({ length: 8 }, (_, i) => `dep-${i}`);
      let barRequests = 0;
      let inFlight = 0;
      const release = Promise.withResolvers<void>();
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request) {
          const name = new URL(request.url).pathname.slice(1);
          if (name.endsWith(".tgz")) return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
          if (name === "bar") {
            if (++barRequests <= drops) return Response.redirect(`http://127.0.0.1:${dropped.port}/bar`, 302);
          } else {
            if (++inFlight === together) release.resolve();
            await release.promise;
          }
          return Response.json({
            name,
            "dist-tags": { latest: "0.0.2" },
            versions: {
              "0.0.2": {
                name,
                version: "0.0.2",
                dependencies: name === "bar" ? Object.fromEntries(names.map(dep => [dep, "0.0.2"])) : undefined,
                dist: { tarball: `${server.url}${name}-0.0.2.tgz` },
              },
            },
          });
        },
      });
      using dir = project(server.url.href);
      const { err, lines, out, exitCode } = await install(String(dir), {}, "--verbose", "--network-concurrency=8");
      expect(err).not.toContain("error:");
      expect(out).toContain("9 packages installed");
      expect(exitCode).toBe(0);
      return lines.filter(line => line.includes("downloading package manifest") || line.includes("at a time"));
    }

    // A lower limit leaves the held manifests waiting for one that is never sent, until the server drops them.
    it("stays as it is after one dropped connection", async () => {
      expect(await peakAfter(1, 8)).toEqual([
        "warn: ConnectionClosed downloading package manifest bar. Retry 1/5 in 1ms...",
      ]);
    });

    it("loses a quarter once the same request was dropped twice", async () => {
      expect(await peakAfter(2, 6)).toEqual([
        "warn: ConnectionClosed downloading package manifest bar. Retry 1/5 in 1ms...",
        "warn: A request failed twice. Sending at most 6 requests at a time",
        "warn: ConnectionClosed downloading package manifest bar. Retry 2/5 in 2ms...",
      ]);
    });
  });
});

// However the tarball of `bad` fails, and whichever linker or phase of the install asks for it: a
// dependency fails the install with one error, an optional dependency is left out with one warning.
describe.concurrent("a tarball that cannot be installed", () => {
  const faults = ["404", "dropped connection", "corrupt tarball"] as const;

  async function serve(fault: (typeof faults)[number]) {
    const tarball = (name: string) =>
      new Bun.Archive(
        { "package/package.json": JSON.stringify({ name, version: "1.0.0" }) },
        { compress: "gzip" },
      ).bytes();
    const [good, bad] = await Promise.all([tarball("good"), tarball("bad")]);
    const hangsUp = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open: socket => void socket.end(), data() {} },
    });
    const registry = Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        if (pathname === "/good-1.0.0.tgz") return new Response(good);
        if (pathname === "/bad-1.0.0.tgz") {
          return fault === "404" ? new Response("gone", { status: 404 }) : new Response(bad.slice(0, bad.length >> 1));
        }
        const name = pathname.slice(1);
        const host = name === "bad" && fault === "dropped connection" ? `http://127.0.0.1:${hangsUp.port}` : origin;
        return Response.json({
          name,
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball: `${host}/${name}-1.0.0.tgz` } } },
        });
      },
    });
    return {
      url: registry.url.href,
      [Symbol.dispose]() {
        registry.stop(true);
        hangsUp.stop(true);
      },
    };
  }

  for (const linker of ["hoisted", "isolated"]) {
    for (const fault of faults) {
      for (const group of ["dependencies", "optionalDependencies"]) {
        // Without a lockfile the tarballs are downloaded while the dependencies are resolved, with one by the linker.
        for (const phase of ["without a lockfile", "with a lockfile"]) {
          // Still wrong: the isolated linker fails the install for an optional dependency, and
          // both linkers do for a tarball that does not extract.
          const wrong = group === "optionalDependencies" && (linker === "isolated" || fault === "corrupt tarball");
          (wrong ? it.failing : it)(`${fault}, ${group}, ${linker}, ${phase}`, async () => {
            using registry = await serve(fault);
            using dir = tempDir("tarball-fails", {
              "package.json": JSON.stringify({
                name: "foo",
                dependencies: { good: "1.0.0" },
                [group]: { bad: "1.0.0" },
              }),
              "bunfig.toml": Bun.TOML.stringify({ install: { cache: "./.bun-cache", registry: registry.url, linker } }),
            });
            const install = async (...args: string[]) => {
              await using proc = spawn({
                cmd: [bunExe(), "install", ...args],
                cwd: String(dir),
                env: { ...env, BUN_INSTALL_CACHE_DIR: undefined, BUN_CONFIG_HTTP_RETRY_COUNT: "0" },
                stdout: "ignore",
                stderr: "pipe",
              });
              const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
              const count = (prefix: string) => err.split("\n").filter(line => line.startsWith(prefix)).length;
              return { errors: count("error:"), warnings: count("warn:"), exitCode };
            };
            if (phase === "with a lockfile") {
              expect(await install("--lockfile-only")).toEqual({ errors: 0, warnings: 0, exitCode: 0 });
            }

            expect(await install()).toEqual(
              group === "dependencies"
                ? { errors: 1, warnings: 0, exitCode: 1 }
                : { errors: 0, warnings: 1, exitCode: 0 },
            );
          });
        }
      }
    }
  }
});
