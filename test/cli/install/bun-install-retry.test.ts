import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "fs";
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
    expect(out).not.toContain("Failed to install");
    expect(exitCode).toBe(0);
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

  // There's only one dependency. While its request backs off, nothing is in flight, and the install only continues
  // because the timer wakes it.
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

  it("announces the Retry-After of the tarball after that of the manifest", async () => {
    using registry = flakyRegistry((_, hit) => (hit === 1 ? busy(429, "1") : undefined));
    using dir = project(registry.url);
    const { lines, exitCode } = await install(String(dir));
    expect(lines.filter(line => line.includes("asked to wait"))).toEqual([
      "warn: registry asked to wait 1s before retrying",
      "warn: registry asked to wait 1s before retrying",
    ]);
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
      "warn: registry asked to wait 1s before retrying",
    ]);
    expect(out).toContain("1 package installed");
    expect(registry.gaps(failing)).toEqual([expect.any(Number)]);
    expect(registry.gaps(failing)[0]).toBeGreaterThanOrEqual(1000);
    expect(exitCode).toBe(0);
  });

  it("waits a minute at most, and says so immediately", async () => {
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
      if (err.includes("before retrying\n")) break;
    }
    expect(err).toContain("warn: registry asked to wait 60s before retrying\n");
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
    { retryAfter: null, backoff: "nonsense", wait: /^([45][0-9]|60)ms$/ },
  ])("Retry-After %j", async ({ retryAfter, backoff, wait }) => {
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

  // These commands send one request and wait for its answer, outside the install loop.
  describe.each(["503", "429", "a dropped connection"])("the first request ends in %s", fault => {
    async function run(...cmd: string[]) {
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
      const requests: string[] = [];
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
          const { pathname } = new URL(request.url);
          requests.push(`${request.method} ${pathname} ${request.headers.get("authorization")}`);
          if (requests.length === 1) {
            return fault === "a dropped connection"
              ? Response.redirect(`http://127.0.0.1:${dropped.port}${pathname}`, 307)
              : busy(Number(fault));
          }
          if (pathname.endsWith(".tgz")) return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
          if (pathname === "/-/whoami") return Response.json({ username: "me" });
          if (pathname !== "/bar") return Response.json({});
          return Response.json({
            name: "bar",
            "dist-tags": { latest: "0.0.2" },
            versions: { "0.0.2": { name: "bar", version: "0.0.2", dist: { tarball: `${server.url}bar-0.0.2.tgz` } } },
          });
        },
      });
      using dir = tempDir("retry-one-request", {
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
        "bunfig.toml": Bun.TOML.stringify({
          install: { cache: false, registry: { url: server.url.href, token: "retry-token" } },
        }),
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          workspaces: { "": { name: "foo", dependencies: { bar: "0.0.2" } } },
          packages: { bar: ["bar@0.0.2", "", {}, ""] },
        }),
      });
      await using proc = spawn({ cmd: [bunExe(), ...cmd], cwd: String(dir), stdout: "pipe", stderr: "pipe", env });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
      return { err, requests, exitCode };
    }

    it.each([
      [["info", "bar"], "GET /bar"],
      [["pm", "view", "bar"], "GET /bar"],
      [["pm", "whoami"], "GET /-/whoami"],
      [["pm", "diff", "bar"], "GET /bar"],
      [["audit"], "POST /-/npm/v1/security/advisories/bulk"],
    ])("%j asks again", async (cmd, request) => {
      const { err, requests, exitCode } = await run(...cmd);
      expect(err).not.toContain("error:");
      expect(requests.slice(0, 2)).toEqual([`${request} Bearer retry-token`, `${request} Bearer retry-token`]);
      expect(exitCode).toBe(0);
    });

    // The registry may have taken the package before the answer was lost.
    it("bun publish does not upload the package again", async () => {
      const { requests, exitCode } = await run("publish");
      expect(requests).toEqual(["PUT /foo Bearer retry-token"]);
      expect(exitCode).toBe(1);
    });
  });

  describe.each([[["info", "bar"]], [["pm", "whoami"]], [["pm", "diff", "bar"]], [["audit"]]])("%j", cmd => {
    async function run(registry: string, extraEnv: Record<string, string> = {}) {
      using dir = tempDir("retry-one-request", {
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
        "bunfig.toml": Bun.TOML.stringify({ install: { cache: false, registry: { url: registry, token: "t" } } }),
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          workspaces: { "": { name: "foo", dependencies: { bar: "0.0.2" } } },
          packages: { bar: ["bar@0.0.2", "", {}, ""] },
        }),
      });
      await using proc = spawn({
        cmd: [bunExe(), ...cmd],
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
        env: { ...env, ...extraEnv },
      });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { err, exitCode };
    }

    // By now, the user has waited for as long as the timeout allows.
    it("doesn't retry a registry that accepts the connection and never responds", async () => {
      let connections = 0;
      using silent = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open() {
            connections++;
          },
          data() {},
        },
      });
      const { exitCode } = await run(`http://127.0.0.1:${silent.port}/`, { BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" });
      expect({ connections, exitCode }).toEqual({ connections: 1, exitCode: 1 });
    });

    it("doesn't retry after a 501", async () => {
      let requests = 0;
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (requests++, busy(501)) });
      const { exitCode } = await run(server.url.href);
      expect({ requests, exitCode }).toEqual({ requests: 1, exitCode: 1 });
    });

    it("doesn't print anything about a retry", async () => {
      let requests = 0;
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (requests++, busy(503)) });
      const { err, exitCode } = await run(server.url.href, {
        BUN_CONFIG_HTTP_RETRY_BACKOFF: "200",
        BUN_CONFIG_HTTP_RETRY_COUNT: "1",
      });
      expect(err).not.toMatch(/retry/i);
      expect({ requests, exitCode }).toEqual({ requests: 2, exitCode: 1 });
    });
  });

  // The manifest request fails twice.
  describe("two retries", () => {
    const run = async (...flags: string[]) => {
      using registry = flakyRegistry((kind, hit) => (kind === "manifest" && hit <= 2 ? busy(503) : undefined));
      using dir = project(registry.url);
      const { lines, exitCode } = await install(String(dir), { BUN_CONFIG_HTTP_RETRY_BACKOFF: "190" }, ...flags);
      expect(exitCode).toBe(0);
      return lines.filter(line => /retry/i.test(line));
    };

    it("print nothing", async () => {
      expect(await run()).toEqual([]);
    });

    it("get a line each with --verbose", async () => {
      expect(await run("--verbose")).toEqual([
        expect.stringMatching(/^warn: HTTPError downloading package manifest bar\. Retry 1\/5 in \d+ms\.\.\.$/),
        expect.stringMatching(/^warn: HTTPError downloading package manifest bar\. Retry 2\/5 in \d+ms\.\.\.$/),
      ]);
    });
  });

  // The next handshake would see the same certificate.
  it("does not retry a certificate it refuses", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("unreachable") });
    using dir = project(server.url.href);
    // The default backoff: five retries would take over a second.
    const { lines, exitCode } = await install(String(dir), { BUN_CONFIG_HTTP_RETRY_BACKOFF: "" }, "--verbose");
    expect(lines.filter(line => line.includes("downloading package manifest"))).toEqual([
      "error: DEPTH_ZERO_SELF_SIGNED_CERT downloading package manifest bar",
    ]);
    expect(exitCode).toBe(1);
  });

  // The next attempt would go round the same circle.
  it.each([
    ["manifest", "error: TooManyRedirects downloading package manifest bar"],
    ["tarball", "error: TooManyRedirects downloading tarball bar@0.0.2"],
  ] as const)("names a %s that redirects in a circle, and does not retry it", async (circling, message) => {
    using registry = flakyRegistry((kind, hit) =>
      kind === circling
        ? Response.redirect(`${registry.url}${kind === "tarball" ? `${hit}/bar-0.0.2.tgz` : `bar?${hit}`}`, 302)
        : undefined,
    );
    using dir = project(registry.url);
    const { lines, exitCode } = await install(String(dir));
    expect(lines.filter(line => line.startsWith("error: "))).toContain(message);
    // As many as `fetch()` follows.
    expect(registry.at[circling]).toHaveLength(127);
    expect(exitCode).toBe(1);
  });

  // This is what `bun init` writes. Peers are resolved after everything else, so offline they used to double the wait.
  it("doesn't request the project's peers once a dependency has failed", async () => {
    const requested: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        requested.push(new URL(request.url).pathname);
        return busy(503);
      },
    });
    using dir = tempDir("install-retry-peers", {
      "package.json": JSON.stringify({
        name: "foo",
        devDependencies: { bar: "latest" },
        peerDependencies: { baz: "^1" },
      }),
      "bunfig.toml": Bun.TOML.stringify({ install: { cache: false, registry: server.url.href } }),
    });
    const { lines, exitCode } = await install(String(dir));
    expect(lines.filter(line => line.startsWith("error:"))).toEqual([
      "error: GET " + server.url.href + "bar - 503",
      "error: bar@latest failed to resolve",
    ]);
    expect(requested).toEqual(Array(6).fill("/bar"));
    expect(exitCode).toBe(1);
  });

  it("doesn't request a package's peers once a dependency of that package has failed", async () => {
    const requested: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        requested.push(pathname);
        if (pathname !== "/bar") return busy(503);
        const version = {
          name: "bar",
          version: "1.0.0",
          dependencies: { qux: "^1" },
          peerDependencies: { baz: "^1" },
          dist: { tarball: `${origin}/bar-1.0.0.tgz` },
        };
        return Response.json({ name: "bar", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
      },
    });
    using dir = tempDir("install-retry-peers-below", {
      "package.json": JSON.stringify({ name: "foo", dependencies: { bar: "1.0.0" } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { cache: false, registry: server.url.href } }),
    });
    const { lines, exitCode } = await install(String(dir), {}, "--lockfile-only");
    expect(lines).toContain("error: GET " + server.url.href + "qux - 503");
    expect(requested).toEqual(["/bar", ...Array(6).fill("/qux")]);
    expect(exitCode).toBe(1);
  });

  // yarn.lock and pnpm-lock.yaml don't record `bin`, so a migration asks the registry for it and continues without a
  // response.
  describe.each(["yarn.lock", "pnpm-lock.yaml"] as const)("the manifests that complete a migrated %s", name => {
    const integrity = "sha512-" + Buffer.alloc(86, "A").toString() + "==";
    const lockfile = {
      "yarn.lock": `# yarn lockfile v1\n\n\nbar@0.0.2:\n  version "0.0.2"\n  integrity ${integrity}\n`,
      "pnpm-lock.yaml": `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      bar:\n        specifier: 0.0.2\n        version: 0.0.2\n\npackages:\n\n  bar@0.0.2:\n    resolution: {integrity: ${integrity}}\n\nsnapshots:\n\n  bar@0.0.2: {}\n`,
    }[name];

    it("are requested once when the registry can't be reached", async () => {
      const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
      await closed.stop(true);
      using dir = project(closed.url.href);
      await writeFile(join(String(dir), name), lockfile);
      const { lines, exitCode } = await install(String(dir), {}, "--lockfile-only", "--verbose");
      // macOS refuses a closed loopback port in connect(2) itself, which is a different error.
      expect(lines.filter(line => line.includes("downloading package manifest"))).toEqual([
        expect.stringMatching(/^warn: (ConnectionRefused|FailedToOpenSocket) downloading package manifest bar$/),
      ]);
      expect(await file(join(String(dir), "bun.lock")).text()).toContain(`"bar": ["bar@0.0.2", `);
      expect(exitCode).toBe(0);
    });

    it("are requested again when the registry is busy", async () => {
      using registry = flakyRegistry((_, hit) => (hit <= 2 ? busy(503) : undefined));
      using dir = project(registry.url);
      await writeFile(join(String(dir), name), lockfile);
      const { err, exitCode } = await install(String(dir), {}, "--lockfile-only");
      expect(err).not.toContain("warn:");
      expect(registry.at.manifest.length).toBe(3);
      expect(exitCode).toBe(0);
    });
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
      return lines.filter(
        line => line.includes("downloading package manifest") || line.includes("concurrent requests"),
      );
    }

    // A lower limit leaves the held manifests waiting for one that is never sent, until the server drops them.
    it("isn't changed by one dropped connection", async () => {
      expect(await peakAfter(1, 8)).toEqual([
        "warn: ConnectionClosed downloading package manifest bar. Retry 1/5 in 1ms...",
      ]);
    });

    it("drops by a quarter once the same request was dropped twice", async () => {
      expect(await peakAfter(2, 6)).toEqual([
        "warn: ConnectionClosed downloading package manifest bar. Retry 1/5 in 1ms...",
        "warn: request failed twice, limiting to 6 concurrent requests",
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
          it(`${fault}, ${group}, ${linker}, ${phase}`, async () => {
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

describe.concurrent("an optional dependency whose tarball is gone", () => {
  // Every package is at 1.0.0; the tarball of `bad` is a 404.
  async function project(linker: string, root: object, packages: Record<string, object> = {}) {
    packages = { ...packages, bad: {} };
    const tarballs = new Map<string, Uint8Array>();
    for (const [name, pkg] of Object.entries(packages)) {
      if (name === "bad") continue;
      const files = { "package/package.json": JSON.stringify({ name, version: "1.0.0", ...pkg }) };
      tarballs.set(`/${name}-1.0.0.tgz`, await new Bun.Archive(files, { compress: "gzip" }).bytes());
    }
    const registry = Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        const name = pathname.slice(1);
        if (name in packages) {
          const dist = { tarball: `${origin}/${name}-1.0.0.tgz` };
          return Response.json({
            name,
            "dist-tags": { latest: "1.0.0" },
            versions: { "1.0.0": { name, version: "1.0.0", ...packages[name], dist } },
          });
        }
        const tarball = tarballs.get(pathname);
        return tarball ? new Response(tarball) : new Response("gone", { status: 404 });
      },
    });
    const dir = tempDir("optional-tarball-gone", {
      "package.json": JSON.stringify({ name: "foo", ...root }),
      "bunfig.toml": Bun.TOML.stringify({ install: { cache: "./.bun-cache", registry: registry.url.href, linker } }),
    });
    let lastOut = "";
    return {
      dir: String(dir),
      lastOut: () => lastOut,
      has: (...path: string[]) => lstatSync(join(String(dir), ...path), { throwIfNoEntry: false }) !== undefined,
      async run(...args: string[]) {
        await using proc = spawn({
          cmd: [bunExe(), ...args],
          cwd: String(dir),
          env: { ...env, BUN_INSTALL_CACHE_DIR: undefined, BUN_CONFIG_HTTP_RETRY_COUNT: "0" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        lastOut = out;
        const count = (prefix: string) => err.split("\n").filter(line => line.startsWith(prefix)).length;
        return {
          errors: count("error:"),
          warnings: count("warn:"),
          failed: out.includes("Failed to install"),
          exitCode,
        };
      },
      [Symbol.dispose]() {
        registry.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }
  const leftOut = { errors: 0, warnings: 1, failed: false, exitCode: 0 };
  const goodAndOptionalBad = { dependencies: { good: "1.0.0" }, optionalDependencies: { bad: "1.0.0" } };

  describe.each(["hoisted", "isolated"])("%s", linker => {
    it("is left out without a link to it, but fails `bun add --optional`", async () => {
      using p = await project(linker, goodAndOptionalBad, { good: {} });
      // Downloaded while resolving, then by the linker.
      expect(await p.run("install")).toEqual(leftOut);
      expect(await p.run("install")).toEqual(leftOut);
      expect([p.has("node_modules", "good", "package.json"), p.has("node_modules", "bad")]).toEqual([true, false]);
      expect(await p.run("add", "--optional", "bad@1.0.0")).toMatchObject({ exitCode: 1 });
    });

    it("of a dependency is left out without a link to it", async () => {
      using p = await project(
        linker,
        { dependencies: { pkg: "1.0.0" } },
        { pkg: { optionalDependencies: { bad: "1.0.0" } } },
      );
      expect(await p.run("install", "--lockfile-only")).toMatchObject({ exitCode: 0 });
      expect(await p.run("install")).toEqual(leftOut);
      expect(p.has("node_modules", "pkg", "package.json")).toBe(true);
      const besidePkg = linker === "hoisted" ? ["node_modules"] : ["node_modules", ".bun", "pkg@1.0.0", "node_modules"];
      expect([p.has(...besidePkg, "bad"), p.has("node_modules", ".bun", "node_modules", "bad")]).toEqual([
        false,
        false,
      ]);
      // The isolated linker links `bad` beside `pkg` again and takes the link away again.
      expect(await p.run("install")).toEqual(leftOut);
      expect(p.lastOut()).toContain("(no changes)");
    });

    it("is left out by --offline", async () => {
      using p = await project(linker, goodAndOptionalBad, { good: {} });
      expect(await p.run("install")).toEqual(leftOut);
      rmSync(join(p.dir, "node_modules"), { recursive: true });
      expect(await p.run("install", "--offline")).toEqual({ ...leftOut, warnings: 0 });
      expect([p.has("node_modules", "good", "package.json"), p.has("node_modules", "bad")]).toEqual([true, false]);
    });

    // Whichever dependent reaches it first.
    it.each([
      ["the root", { dependencies: { needs: "1.0.0" }, optionalDependencies: { bad: "1.0.0" } }],
      ["a dependency that sorts after it", { dependencies: { aneeds: "1.0.0", pkg: "1.0.0" } }],
      ["a dependency that sorts before it", { dependencies: { zneeds: "1.0.0", pkg: "1.0.0" } }],
    ])("fails the install when a dependency requires it and it is optional for %s", async (_, root) => {
      const needs = { dependencies: { bad: "1.0.0" } };
      using p = await project(linker, root, {
        needs,
        aneeds: needs,
        zneeds: needs,
        pkg: { optionalDependencies: { bad: "1.0.0" } },
      });
      expect(await p.run("install", "--lockfile-only")).toMatchObject({ exitCode: 0 });
      expect(await p.run("install")).toMatchObject({ errors: 1, warnings: 0, exitCode: 1 });
    });
  });
});

// One download serves every dependency on a package, and one of them asks for it. Whether its
// failure fails the install must not depend on which one that is, nor on when it failed.
describe.concurrent("a failed download that several dependencies share", () => {
  type Pkg = { name: string; version: string } & Record<string, unknown>;

  async function project(linker: string, packages: Pkg[], files: Record<string, string> = {}) {
    const gone = new Set<string>();
    const tarballs = new Map<string, Uint8Array>();
    for (const pkg of packages) {
      tarballs.set(
        `/${pkg.name}-${pkg.version}.tgz`,
        await new Bun.Archive({ "package/package.json": JSON.stringify(pkg) }, { compress: "gzip" }).bytes(),
      );
    }
    const registry = Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        const tarball = tarballs.get(pathname);
        if (tarball) return gone.has(pathname) ? new Response("gone", { status: 404 }) : new Response(tarball);
        const versions = packages.filter(pkg => pkg.name === pathname.slice(1));
        if (versions.length === 0) return new Response("unexpected", { status: 404 });
        return Response.json({
          name: versions[0].name,
          "dist-tags": { latest: versions[0].version },
          versions: Object.fromEntries(
            versions.map(pkg => [
              pkg.version,
              { ...pkg, dist: { tarball: `${origin}/${pkg.name}-${pkg.version}.tgz` } },
            ]),
          ),
        });
      },
    });
    const dir = tempDir("shared-failed-download", {
      ...files,
      "bunfig.toml": Bun.TOML.stringify({ install: { cache: "./.bun-cache", registry: registry.url.href, linker } }),
    });
    let errorLines: string[] = [];
    return {
      dir: String(dir),
      url: (name: string, version: string) => `${registry.url.href}${name}-${version}.tgz`,
      /** Of the last install. */
      errorLines: () => errorLines,
      /** From now on nothing is installed or cached, and this tarball is a 404. */
      loseTarball(name: string, version: string) {
        rmSync(join(String(dir), "node_modules"), { recursive: true, force: true });
        rmSync(join(String(dir), ".bun-cache"), { recursive: true, force: true });
        gone.add(`/${name}-${version}.tgz`);
      },
      async install(root: object, ...args: string[]) {
        await writeFile(join(String(dir), "package.json"), JSON.stringify({ name: "foo", version: "0.0.1", ...root }));
        await using proc = spawn({
          cmd: [bunExe(), "install", "--ignore-scripts", ...args],
          cwd: String(dir),
          env: { ...env, BUN_INSTALL_CACHE_DIR: undefined, BUN_CONFIG_HTTP_RETRY_COUNT: "0" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const lines = err.split(/\r?\n/);
        errorLines = lines.filter(line => line.startsWith("error:"));
        return {
          errors: errorLines.length,
          // Excludes the ones about peers.
          warnings: lines.filter(line => line.startsWith("warn: GET ")).length,
          failed: out.includes("Failed to install"),
          exitCode,
        };
      },
      [Symbol.dispose]() {
        registry.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }
  const installed = { errors: 0, warnings: 0, failed: false, exitCode: 0 };
  const leftOut = { errors: 0, warnings: 1, failed: false, exitCode: 0 };
  const baz = { name: "baz", version: "1.0.0" };

  describe.each(["hoisted", "isolated"])("%s", linker => {
    // `b` resolves baz first and asks for its tarball, `a` finds baz resolved: the download that
    // fails while the dependencies are resolved is a warning. The linker then needs it for `a`.
    it("fails for the required alias after it failed for the optional alias while resolving", async () => {
      using p = await project(linker, [baz]);
      p.loseTarball("baz", "1.0.0");
      expect(
        await p.install({ dependencies: { a: "npm:baz@1.0.0" }, optionalDependencies: { b: "npm:baz@1.0.0" } }),
      ).toEqual({ errors: 1, warnings: 1, failed: true, exitCode: 1 });
      expect(p.errorLines()).toEqual(["error: failed to download baz@1.0.0"]);
    });

    // The same with the root's optional dependency first and a package that requires baz.
    it("fails for the package that requires it after it failed for the optional dependency while resolving", async () => {
      using p = await project(linker, [baz, { name: "bar", version: "1.0.0", dependencies: { baz: "1.0.0" } }]);
      p.loseTarball("baz", "1.0.0");
      expect(await p.install({ dependencies: { bar: "1.0.0" }, optionalDependencies: { baz: "1.0.0" } })).toEqual({
        errors: 1,
        warnings: 1,
        failed: true,
        exitCode: 1,
      });
      expect(p.errorLines()).toEqual(["error: failed to download baz@1.0.0"]);
    });

    // bun.lock resolves both to one package. The linker asks for it through `b`, which sorts first.
    it("is an error when the required url joins the download of the optional one", async () => {
      using p = await project(linker, [baz]);
      const url = p.url("baz", "1.0.0");
      expect(await p.install({ dependencies: { a: url } })).toEqual(installed);
      p.loseTarball("baz", "1.0.0");
      expect(await p.install({ dependencies: { a: url }, optionalDependencies: { b: url } })).toMatchObject({
        errors: 1,
        warnings: 0,
        exitCode: 1,
      });
    });

    it("--offline reports the package that a dependency requires and the root has as optional", async () => {
      using p = await project(linker, [baz, { name: "bar", version: "1.0.0", dependencies: { baz: "1.0.0" } }]);
      const root = { dependencies: { bar: "1.0.0" }, optionalDependencies: { baz: "1.0.0" } };
      expect(await p.install(root)).toEqual(installed);
      // bar stays cached.
      rmSync(join(p.dir, "node_modules"), { recursive: true });
      for (const entry of readdirSync(join(p.dir, ".bun-cache"))) {
        if (entry.startsWith("baz")) rmSync(join(p.dir, ".bun-cache", entry), { recursive: true });
      }
      expect(await p.install(root, "--offline")).toMatchObject({ errors: 1, exitCode: 1 });
    });

    it("is a warning when only a devDependency that --production skips requires the package", async () => {
      using p = await project(linker, [baz, { name: "bar", version: "1.0.0", dependencies: { baz: "1.0.0" } }]);
      const root = { devDependencies: { bar: "1.0.0" }, optionalDependencies: { baz: "1.0.0" } };
      expect(await p.install(root)).toEqual(installed);
      p.loseTarball("baz", "1.0.0");
      expect(await p.install(root, "--production")).toEqual(leftOut);
    });

    // `x` sorts first, so its optional peer is the dependency the linker asks through.
    it.each(["without a lockfile", "with a lockfile"])(
      "is a warning when an optional peer and an optional dependency share the package, %s",
      async phase => {
        using p = await project(linker, [
          baz,
          {
            name: "x",
            version: "1.0.0",
            peerDependencies: { baz: "*" },
            peerDependenciesMeta: { baz: { optional: true } },
          },
          { name: "y", version: "1.0.0", optionalDependencies: { baz: "1.0.0" } },
        ]);
        const root = { dependencies: { x: "1.0.0", y: "1.0.0" } };
        if (phase === "with a lockfile") expect(await p.install(root)).toEqual(installed);
        p.loseTarball("baz", "1.0.0");
        expect(await p.install(root)).toEqual(leftOut);
      },
    );

    // Dependencies sort by name, so the parent named `aaa` is the one the linker asks through.
    it.each([
      ["the parent with the peer", "aaa", "zzz"],
      ["the parent with the optional dependency", "zzz", "aaa"],
    ])("is an error when a peer needs the package and %s sorts first", async (_, peerHost, optionalHost) => {
      using p = await project(linker, [
        baz,
        { name: peerHost, version: "1.0.0", peerDependencies: { baz: "1.0.0" } },
        { name: optionalHost, version: "1.0.0", optionalDependencies: { baz: "1.0.0" } },
      ]);
      const root = { dependencies: { [peerHost]: "1.0.0", [optionalHost]: "1.0.0" } };
      expect(await p.install(root)).toEqual(installed);
      p.loseTarball("baz", "1.0.0");
      expect(await p.install(root)).toMatchObject({ errors: 1, warnings: 0, exitCode: 1 });
    });
  });

  // A name in both groups of one package.json is an optional peer.
  it.each([
    ["the root", {}, { optionalDependencies: { baz: "1.0.0" }, peerDependencies: { baz: "1.0.0" } }],
    [
      "a workspace, and the root owns the slot",
      {
        "packages/w/package.json": JSON.stringify({
          name: "w",
          version: "0.0.1",
          optionalDependencies: { baz: "1.0.0" },
          peerDependencies: { baz: "1.0.0" },
        }),
      },
      { workspaces: ["packages/*"], optionalDependencies: { baz: "1.0.0" } },
    ],
  ])("hoisted: is a warning when %s has the peer as optional too", async (_, files, root) => {
    using p = await project("hoisted", [baz], files);
    expect(await p.install(root)).toEqual(installed);
    p.loseTarball("baz", "1.0.0");
    expect(await p.install(root)).toEqual(leftOut);
  });

  // A peer needs the copy that the tree gives it, which isn't always the one that it resolved to. A dependency of the
  // root provides a peer regardless of its version.
  describe("hoisted: a peer that gets the root's version", () => {
    const packages = [
      baz,
      { name: "baz", version: "2.0.0" },
      { name: "x", version: "1.0.0", peerDependencies: { baz: "1.0.0" } },
      { name: "y", version: "1.0.0", optionalDependencies: { baz: "1.0.0" } },
    ];

    it("is an error when that version, optional for the root, cannot be downloaded", async () => {
      using p = await project("hoisted", packages);
      const root = { dependencies: { x: "1.0.0" }, optionalDependencies: { baz: "2.0.0" } };
      expect(await p.install(root)).toEqual(installed);
      expect(await file(join(p.dir, "node_modules", "baz", "package.json")).json()).toMatchObject({ version: "2.0.0" });
      p.loseTarball("baz", "2.0.0");
      expect(await p.install(root)).toMatchObject({ errors: 1, warnings: 0, exitCode: 1 });
    });

    it("is a warning when the version it resolved to, which only an optional dependency links, cannot be", async () => {
      using p = await project("hoisted", packages);
      const root = { dependencies: { x: "1.0.0", y: "1.0.0" }, optionalDependencies: { baz: "2.0.0" } };
      expect(await p.install(root)).toEqual(installed);
      p.loseTarball("baz", "1.0.0");
      expect(await p.install(root)).toEqual(leftOut);
    });
  });
});

// bun.lock has a package for an optional dependency, and the dependency is resolved again: `bun update` asks the
// registry about every entry of package.json, and so does an install after a rule for its name changed. If the
// registry then gives no manifest (the request fails, cannot be made, or --offline forbids it), the dependency takes
// a package that bun.lock has in its range. `bun update` warns that it did not check that package, and leaves the
// package.json entry as written.
describe.concurrent("an optional dependency that gets no manifest", () => {
  type Releases = Record<string, Record<string, object>>;
  const LEAF: Releases = { leaf: { "1.0.0": {}, "1.1.0": {} } };
  const OPTIONAL_LEAF = { optionalDependencies: { leaf: "^1.0.0" } };
  const cataloged = (leaf: string) => ({
    workspaces: { packages: [], catalog: { leaf } },
    optionalDependencies: { leaf: "catalog:" },
  });
  const notChecked = (reason = "", version = "1.1.0") => [
    `warn: leaf@${version} was not checked for updates${reason && `: ${reason}`}`,
  ];
  const notCached = 'error: --offline: no cached manifest for "leaf" (run once online, or use --prefer-offline)';
  const unresolved = "error: leaf@^1.0.0 failed to resolve";
  const ADDS_PATCHED_TXT = `diff --git a/patched.txt b/patched.txt
new file mode 100644
index 0000000000000000000000000000000000000000..3b18e512dba79e4c8300dd08aeb37f8e728b8dad
--- /dev/null
+++ b/patched.txt
@@ -0,0 +1 @@
+hello world
`;

  // `releases` is read for every request, so a test can publish or take away a version after the install.
  async function project(root: object, releases = LEAF, files: Record<string, string> = {}, bunfig: object = {}) {
    const tarballs = new Map<string, Uint8Array>();
    for (const [name, versions] of Object.entries(releases)) {
      for (const [version, fields] of Object.entries(versions)) {
        const packed = { "package/package.json": JSON.stringify({ name, version, ...fields }) };
        tarballs.set(`/${name}-${version}.tgz`, await new Bun.Archive(packed, { compress: "gzip" }).bytes());
      }
    }
    const statuses: Record<string, number> = {};
    const headers: Record<string, string> = {};
    let asked: string[] = [];
    const registry = Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname: encoded } = new URL(request.url);
        // The manifest of `@scope/name` is asked for as `/@scope%2fname`.
        const pathname = decodeURIComponent(encoded);
        const tarball = tarballs.get(pathname);
        if (tarball) return new Response(tarball);
        const name = pathname.slice(1);
        asked.push(name);
        if (statuses[name]) return new Response("refused", { status: statuses[name] });
        if (!releases[name]) return new Response("unexpected", { status: 404 });
        const versions = Object.entries(releases[name]).map(([version, fields]) => [
          version,
          { name, version, ...fields, dist: { tarball: `${origin}/${name}-${version}.tgz` } },
        ]);
        const latest = Object.keys(releases[name]).sort(Bun.semver.order).at(-1);
        return Response.json({ name, "dist-tags": { latest }, versions: Object.fromEntries(versions) }, { headers });
      },
    });
    const configure = (install: object) =>
      Bun.TOML.stringify({
        install: {
          cache: "./.bun-cache",
          registry: registry.url.href,
          saveTextLockfile: true,
          linker: "hoisted",
          ...install,
        },
      });
    const dir = tempDir("optional-no-manifest", {
      "package.json": JSON.stringify({ name: "foo", ...root }, null, 2),
      "bunfig.toml": configure(bunfig),
      ...files,
    });
    const path = (...parts: string[]) => join(String(dir), ...parts);
    async function runIn(cwd: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: path(cwd),
        env: { ...env, BUN_INSTALL_CACHE_DIR: undefined, BUN_CONFIG_HTTP_RETRY_COUNT: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = (prefix: string) => err.split(/\r?\n/).filter(line => line.startsWith(prefix));
      return {
        warnings: lines("warn:"),
        errors: lines("error:"),
        saved: err.includes("Saved lockfile"),
        out,
        err,
        exitCode,
      };
    }
    return {
      /** What the warning about a refused manifest says after its `warn: `. */
      refused: (status: number, name = "leaf") => `GET ${registry.url.origin}/${name} - ${status}`,
      path,
      runIn,
      run: (...args: string[]) => runIn("", ...args),
      configure: (install: object) => writeFile(path("bunfig.toml"), configure(install)),
      /** From now on the registry answers the request for this manifest with `status`; 0 serves it again. */
      refuse(name: string, status: number) {
        statuses[name] = status;
      },
      /** From now on a manifest is stale as soon as it is in the cache: an install asks for it again. */
      expireManifests() {
        headers["cache-control"] = "max-age=0";
      },
      /** The manifests that were requested since the last call. */
      asked() {
        const names = asked;
        asked = [];
        return names;
      },
      /** The file of the cache that has the manifest of `name`: the one with the URLs of its tarballs. */
      manifest(name: string) {
        const cached = readdirSync(path(".bun-cache")).filter(
          f => f.endsWith(".npm") && readFileSync(path(".bun-cache", f)).includes(`/${name}-`),
        );
        expect(cached).toHaveLength(1);
        return path(".bun-cache", cached[0]);
      },
      /** bun.lock and every package.json of the project. */
      written: (...workspaces: string[]) =>
        Promise.all(
          ["bun.lock", "package.json", ...workspaces.map(w => `${w}/package.json`)].map(f => file(path(f)).text()),
        ),
      /** The versions of `name` that bun.lock has. */
      async locked(name: string) {
        const { packages } = Bun.JSONC.parse(await file(path("bun.lock")).text()) as {
          packages: Record<string, [string]>;
        };
        return Object.values(packages)
          .filter(([id]) => id.startsWith(`${name}@`))
          .map(([id]) => id.slice(name.length + 1))
          .sort(Bun.semver.order);
      },
      installed: async (...parts: string[]) => (await file(path(...parts, "package.json")).json()).version as string,
      [Symbol.dispose]() {
        registry.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }
  const unchanged = { warnings: [] as string[], errors: [], saved: false, exitCode: 0 };

  // [the entry, the package.json key that reaches leaf, the fields that declare it, the update's arguments]
  it.each<[string, string, object, string[]]>([
    ["a plain entry", "leaf", OPTIONAL_LEAF, []],
    ["a plain entry under --latest", "leaf", OPTIONAL_LEAF, ["--latest"]],
    ["a `*` entry under --latest", "leaf", { optionalDependencies: { leaf: "*" } }, ["--latest"]],
    ["an npm: alias", "aliased", { optionalDependencies: { aliased: "npm:leaf@^1.0.0" } }, []],
    [
      "an entry that an override renames",
      "renamed",
      { optionalDependencies: { renamed: "*" }, overrides: { renamed: "npm:leaf@^1.0.0" } },
      [],
    ],
    ["a catalog: entry", "leaf", cataloged("^1.0.0"), []],
    ["a plain entry under --lockfile-only", "leaf", OPTIONAL_LEAF, ["--lockfile-only"]],
    ["a plain entry under --no-save", "leaf", OPTIONAL_LEAF, ["--no-save"]],
  ])("%s: `bun update` changes nothing after a 404 for its manifest", async (_, key, fields, args) => {
    using p = await project(fields);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    p.refuse("leaf", 404);
    p.asked();
    expect(await p.run("update", ...args)).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(404)) });
    expect(p.asked()).toEqual(["leaf"]);
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", key)).toBe("1.1.0");
  });

  it("is installed from bun.lock afterwards, and the next `bun update` moves it", async () => {
    const releases: Releases = { leaf: { "1.0.0": {}, "1.1.0": {}, "1.2.0": {} } };
    using p = await project(OPTIONAL_LEAF, releases);
    const { "1.2.0": newer, ...older } = releases.leaf;
    releases.leaf = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(404)) });

    rmSync(p.path("node_modules"), { recursive: true, force: true });
    expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");

    releases.leaf = { ...older, "1.2.0": newer };
    p.refuse("leaf", 0);
    expect(await p.run("update")).toMatchObject({ ...unchanged, saved: true });
    expect(await p.locked("leaf")).toEqual(["1.2.0"]);
    expect(await file(p.path("package.json")).json()).toEqual({
      name: "foo",
      optionalDependencies: { leaf: "^1.2.0" },
    });
  });

  // Nothing of it is installed here, so bun.lock is all that the platform it is for gets.
  it("for another platform stays in bun.lock after a 404 for its manifest", async () => {
    const os = [process.platform === "darwin" ? "linux" : "darwin"];
    using p = await project(OPTIONAL_LEAF, { leaf: { "1.0.0": { os }, "1.1.0": { os } } });
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();
    expect(await p.locked("leaf")).toEqual(["1.1.0"]);

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(404)) });
    expect(await p.written()).toEqual(before);
    expect(existsSync(p.path("node_modules", "leaf"))).toBe(false);
  });

  // The kept package brings what it depends on. The update asks about those as about any dependency of a package:
  // it moves them, or warns about them when it plans, which is before it warns about the kept package.
  const WITH_DEPENDENCIES = { dependencies: { dep: "^1.0.0" }, optionalDependencies: { odep: "^1.0.0" } };
  it("that has dependencies keeps them in bun.lock, and `bun update` still moves them", async () => {
    const older = { "1.0.0": {} };
    const newer = { ...older, "1.1.0": {} };
    const releases: Releases = { leaf: { "1.0.0": WITH_DEPENDENCIES }, dep: newer, odep: newer };
    using p = await project(OPTIONAL_LEAF, releases);
    releases.dep = releases.odep = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const packageJson = (await p.written())[1];
    releases.dep = releases.odep = newer;

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({
      ...unchanged,
      warnings: notChecked(p.refused(404), "1.0.0"),
      saved: true,
    });
    expect([await p.locked("leaf"), await p.locked("dep"), await p.locked("odep")]).toEqual([
      ["1.0.0"],
      ["1.1.0"],
      ["1.1.0"],
    ]);
    expect((await p.written())[1]).toBe(packageJson);

    rmSync(p.path("node_modules"), { recursive: true, force: true });
    expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
    expect(await Promise.all(["leaf", "dep", "odep"].map(name => p.installed("node_modules", name)))).toEqual([
      "1.0.0",
      "1.1.0",
      "1.1.0",
    ]);
  });

  it("that has dependencies: `bun update` changes nothing when no manifest of them arrives either", async () => {
    const releases = { leaf: { "1.0.0": WITH_DEPENDENCIES }, dep: { "1.0.0": {} }, odep: { "1.0.0": {} } };
    using p = await project(OPTIONAL_LEAF, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    for (const name of ["leaf", "dep", "odep"]) p.refuse(name, 503);
    expect(await p.run("update")).toMatchObject({
      ...unchanged,
      warnings: ["dep", "odep", "leaf"].map(
        name => `warn: ${name}@1.0.0 was not checked for updates: ${p.refused(503, name)}`,
      ),
    });
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "dep")).toBe("1.0.0");
  });

  it.each([401, 500])("`bun update` changes nothing after a %d for its manifest", async status => {
    using p = await project(OPTIONAL_LEAF);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    p.refuse("leaf", status);
    expect(await p.run("update")).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(status)) });
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  it("`bun update` changes nothing when the registry hangs up", async () => {
    using hangsUp = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open: socket => void socket.end(), data() {} },
    });
    using p = await project(OPTIONAL_LEAF);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    expect(await p.run("update", "--registry", `http://127.0.0.1:${hangsUp.port}/`)).toMatchObject({
      ...unchanged,
      warnings: [
        expect.stringMatching(
          /^warn: leaf@1\.1\.0 was not checked for updates: \w+ downloading package manifest leaf$/,
        ),
      ],
    });
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  it("`bun update` changes nothing when no request can be made to the registry URL", async () => {
    using p = await project(OPTIONAL_LEAF);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    await p.configure({ registry: "ftp://localhost/" });
    expect(await p.run("update")).toMatchObject({
      ...unchanged,
      warnings: [...notChecked(), "warn: Registry URL must be http:// or https://", "warn: InvalidURL"],
    });
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  // The manifest of `good` is in the cache, the one of leaf is not.
  it("`bun update --offline` changes nothing without its manifest in the cache", async () => {
    const root = { dependencies: { good: "^1.0.0" }, ...OPTIONAL_LEAF };
    using p = await project(root, { ...LEAF, good: { "1.0.0": {} } });
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();
    rmSync(p.manifest("leaf"));

    p.asked();
    expect(await p.run("update", "--offline")).toMatchObject({ ...unchanged, warnings: notChecked() });
    expect(p.asked()).toEqual([]);
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  // `other` is a new entry that has no manifest in the cache either. The failed request for leaf is not its fault.
  it("`bun update <name> --offline` blames only the entry that it names", async () => {
    const releases = { ...LEAF, other: { "1.0.0": {} }, parent: { "1.0.0": { dependencies: { other: "1.0.0" } } } };
    const root = { dependencies: { parent: "1.0.0" }, ...OPTIONAL_LEAF };
    using p = await project(root, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });

    const both = { optionalDependencies: { leaf: "^1.0.0", other: "^1.0.0" } };
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root, ...both }, null, 2));
    const before = await p.written();
    rmSync(p.path(".bun-cache"), { recursive: true, force: true });
    expect(await p.run("update", "leaf", "--offline")).toMatchObject({
      ...unchanged,
      errors: [notCached],
      exitCode: 1,
    });
    expect(await p.written()).toEqual(before);
  });

  // An online `bun update` moves bun.lock to 1.1.0 and package.json to ^1.1.0. The manifest in the cache is older
  // than that: it lists 1.0.0 only, so it has no version in the range, and --offline cannot ask for a newer one.
  // The entry keeps its package, as it does without a manifest. An update that names the entry fails, and so does
  // one for a required dependency.
  const noVersion = 'error: No version matching "^1.1.0" found for specifier "leaf" (but package exists)';
  it.each<[string, object, string[], object]>([
    ["`bun update --offline` changes nothing", OPTIONAL_LEAF, [], { warnings: notChecked() }],
    ["`bun update <name> --offline` fails", OPTIONAL_LEAF, ["leaf"], { errors: [noVersion], exitCode: 1 }],
    [
      "`bun update --offline` fails for a required dependency",
      { dependencies: { leaf: "^1.0.0" } },
      [],
      { errors: [noVersion, "error: leaf@^1.1.0 failed to resolve"], exitCode: 1 },
    ],
  ])("%s when the manifest in the cache is older than bun.lock", async (_, fields, args, printed) => {
    const releases = { ...LEAF };
    using p = await project(fields, releases);
    const { "1.1.0": newer, ...older } = releases.leaf;
    releases.leaf = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const manifest = p.manifest("leaf");
    const stale = readFileSync(manifest);
    releases.leaf = { ...older, "1.1.0": newer };
    expect(await p.run("update")).toMatchObject({ ...unchanged, saved: true });
    // Whether or not the update has written the newer manifest to the cache.
    await writeFile(manifest, stale);
    const before = await p.written();
    expect([await p.locked("leaf"), before[1]]).toEqual([["1.1.0"], expect.stringContaining('"leaf": "^1.1.0"')]);

    p.asked();
    expect(await p.run("update", ...args, "--offline")).toMatchObject({ ...unchanged, ...printed });
    expect(p.asked()).toEqual([]);
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  // The request is for the root's entry, and the manifest in the cache serves that one. The row of `parent` asks
  // for a range that this manifest lacks: it keeps its package, and the request does not fail because of it.
  it("`bun update <name> --offline` keeps a row of a package whose range the manifest in the cache lacks", async () => {
    const releases: Releases = {
      leaf: { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} },
      parent: { "1.0.0": { optionalDependencies: { leaf: "^2.0.0" } } },
    };
    using p = await project({ dependencies: { leaf: "^1.1.0" } }, releases);
    const { "2.0.0": newer, ...older } = releases.leaf;
    releases.leaf = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const manifest = p.manifest("leaf");
    const stale = readFileSync(manifest);
    releases.leaf = { ...older, "2.0.0": newer };
    const root = { dependencies: { leaf: "^1.1.0", parent: "1.0.0" } };
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root }, null, 2));
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    expect(await p.locked("leaf")).toEqual(["1.1.0", "2.0.0"]);
    await writeFile(manifest, stale);
    const before = await p.written();

    p.asked();
    expect(await p.run("update", "leaf", "--offline")).toMatchObject({
      ...unchanged,
      warnings: notChecked("", "2.0.0"),
    });
    expect(p.asked()).toEqual([]);
    expect(await p.written()).toEqual(before);
  });

  // The request names the package, and its own entry is served from the cache. The alias of that package asks for a
  // range that the manifest in the cache lacks: it keeps its package, and its entry stays as written.
  it("`bun update <name> --offline` leaves the entry of a kept alias of that package as written", async () => {
    const releases: Releases = { leaf: { "1.0.0": {}, "2.0.0": {}, "2.1.0": {} } };
    using p = await project({ dependencies: { leaf: "^1.0.0" } }, releases);
    releases.leaf = { "1.0.0": {} };
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const manifest = p.manifest("leaf");
    const stale = readFileSync(manifest);
    releases.leaf = { "1.0.0": {}, "2.0.0": {}, "2.1.0": {} };
    const root = { dependencies: { leaf: "^1.0.0" }, optionalDependencies: { aliased: "npm:leaf@^2.0.0" } };
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root }, null, 2));
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    expect(await p.locked("leaf")).toEqual(["1.0.0", "2.1.0"]);
    await writeFile(manifest, stale);
    const before = await p.written();

    expect(await p.run("update", "leaf", "--offline")).toMatchObject({
      ...unchanged,
      warnings: notChecked("", "2.1.0"),
    });
    expect(await p.written()).toEqual(before);
  });

  it.each(["", "--latest"])("`bun update %s` still moves the other entries", async flag => {
    const releases: Releases = { ...LEAF, other: { "1.0.0": {}, "1.1.0": {} } };
    using p = await project({ dependencies: { other: "^1.0.0" }, ...OPTIONAL_LEAF }, releases);
    const { "1.1.0": newer, ...older } = releases.other;
    releases.other = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.other = { ...older, "1.1.0": newer };

    p.refuse("leaf", 404);
    expect(await p.run("update", ...(flag ? [flag] : []))).toMatchObject({
      ...unchanged,
      warnings: notChecked(p.refused(404)),
      saved: true,
    });
    expect(await file(p.path("package.json")).json()).toEqual({
      name: "foo",
      dependencies: { other: "^1.1.0" },
      ...OPTIONAL_LEAF,
    });
    expect([await p.locked("other"), await p.locked("leaf")]).toEqual([["1.1.0"], ["1.1.0"]]);
    expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
  });

  // An update may also ask about the entries of the workspaces that it does not target. If it does, it warns about
  // the entry as well, and if it does not, it prints nothing.
  it.each<[string, string, string[], boolean]>([
    ["with -r", "", ["-r"], true],
    ["inside the workspace", "packages/pkg1", [], true],
    ["at the root", "", [], false],
    ["inside the workspace, for another name", "packages/pkg1", ["other"], false],
    ["inside another workspace", "packages/pkg2", [], false],
    ["with --filter for another workspace", "", ["--filter", "pkg2"], false],
  ])("in a workspace: `bun update` %s changes nothing after a 404 for its manifest", async (_, cwd, args, targeted) => {
    const other = { dependencies: { other: "^1.0.0" } };
    using p = await project(
      { workspaces: ["packages/*"] },
      { ...LEAF, other: { "1.0.0": {} } },
      {
        "packages/pkg1/package.json": JSON.stringify({ name: "pkg1", version: "1.0.0", ...other, ...OPTIONAL_LEAF }),
        "packages/pkg2/package.json": JSON.stringify({ name: "pkg2", version: "1.0.0", ...other }),
      },
    );
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written("packages/pkg1", "packages/pkg2");

    p.refuse("leaf", 404);
    const updated = await p.runIn(cwd, "update", ...args);
    expect(updated).toMatchObject({ errors: [], saved: false, exitCode: 0 });
    const kept = notChecked(p.refused(404));
    expect(targeted ? [kept] : [kept, []]).toContainEqual(updated.warnings);
    expect(await p.written("packages/pkg1", "packages/pkg2")).toEqual(before);
    expect(await p.locked("leaf")).toEqual(["1.1.0"]);
  });

  it.each<[string, object, string]>([
    ["the isolated linker", { linker: "isolated" }, "bun.lock"],
    ["a binary lockfile", { saveTextLockfile: false }, "bun.lockb"],
  ])("with %s: `bun update` changes nothing after a 404 for its manifest", async (_, bunfig, lockfile) => {
    using p = await project(OPTIONAL_LEAF, LEAF, {}, bunfig);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await Promise.all([file(p.path(lockfile)).bytes(), file(p.path("package.json")).text()]);

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(404)) });
    expect(await Promise.all([file(p.path(lockfile)).bytes(), file(p.path("package.json")).text()])).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  // The package is kept for both, and the update warns about it once. For a dependency of a package it has asked
  // for the manifest, and has warned, before it resolves the entry.
  it.each<[string, object, Record<string, string>, string[]]>([
    ["a dependency of a package", { dependencies: { parent: "1.0.0" }, ...OPTIONAL_LEAF }, {}, []],
    [
      "an entry of a workspace",
      { workspaces: ["packages/*"], ...OPTIONAL_LEAF },
      { "packages/pkg1/package.json": JSON.stringify({ name: "pkg1", ...OPTIONAL_LEAF }) },
      ["-r"],
    ],
  ])("that shares its package with %s: `bun update` warns once", async (_, root, files, args) => {
    const workspaces = Object.keys(files).map(f => f.replace("/package.json", ""));
    const releases = { ...LEAF, parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } } };
    using p = await project(root, releases, files);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written(...workspaces);

    p.refuse("leaf", 404);
    expect(await p.run("update", ...args)).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(404)) });
    expect(await p.written(...workspaces)).toEqual(before);
  });

  // bun.lock has two versions in the range: the entry shares 1.0.0 with `dep`, and `pin` has 1.1.0. The entry stays
  // on the version that it had, and the update warns about both.
  it.each([404, 503])("stays on its version next to a higher one, after a %d for its manifest", async status => {
    const releases: Releases = {
      ...LEAF,
      dep: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } },
      pin: { "1.0.0": { dependencies: { leaf: "1.1.0" } } },
    };
    const root = (leaf: string) => ({ dependencies: { dep: "1.0.0", pin: "1.0.0" }, optionalDependencies: { leaf } });
    using p = await project({ dependencies: { dep: "1.0.0" }, ...OPTIONAL_LEAF }, releases);
    const { "1.1.0": newer, ...older } = releases.leaf;
    releases.leaf = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.leaf = { ...older, "1.1.0": newer };
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root("^1.0.0") }));
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();
    expect(await p.locked("leaf")).toEqual(["1.0.0", "1.1.0"]);

    p.refuse("leaf", status);
    expect(await p.run("update")).toMatchObject({
      ...unchanged,
      warnings: [...notChecked(p.refused(status), "1.0.0"), ...notChecked(p.refused(status))],
    });
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.0.0");

    p.refuse("leaf", 0);
    expect(await p.run("update")).toMatchObject({ ...unchanged, saved: true });
    expect(await p.locked("leaf")).toEqual(["1.1.0"]);
    expect(await file(p.path("package.json")).json()).toEqual({ name: "foo", ...root("^1.1.0") });
  });

  // The row is new, because the package that declares it moves in the same update. The update warns about the
  // kept package once, however it was told to move `parent`. `<name> --latest` has the failed request on a line of
  // its own.
  it.each<[string, string[], (refused: string) => string[]]>([
    ["", [], refused => notChecked(refused)],
    [" <name>", ["parent"], refused => notChecked(refused)],
    [" --latest", ["--latest"], refused => notChecked(refused)],
    [" <name> --latest", ["parent", "--latest"], refused => [...notChecked(), `warn: ${refused}`]],
  ])(
    "of a package that `bun update%s` moves keeps its version after a 404 for its manifest",
    async (_, args, warns) => {
      const releases: Releases = { ...LEAF, parent: { "1.0.0": OPTIONAL_LEAF, "1.1.0": OPTIONAL_LEAF } };
      using p = await project({ dependencies: { parent: "^1.0.0" } }, releases);
      const { "1.1.0": newer, ...older } = releases.parent;
      releases.parent = older;
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      releases.parent = { ...older, "1.1.0": newer };

      p.refuse("leaf", 404);
      expect(await p.run("update", ...args)).toMatchObject({
        ...unchanged,
        warnings: warns(p.refused(404)),
        saved: true,
      });
      expect([await p.locked("parent"), await p.locked("leaf")]).toEqual([["1.1.0"], ["1.1.0"]]);
      expect(await file(p.path("package.json")).json()).toEqual({ name: "foo", dependencies: { parent: "^1.1.0" } });
      expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
      expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
    },
  );

  // The update warns that it did not check the package before it knows that `parent` moves. That line is not
  // pinned here.
  it("of a package that `bun update` moves is left out when the new version rejects its version", async () => {
    const releases: Releases = {
      ...LEAF,
      parent: { "1.0.0": OPTIONAL_LEAF, "1.1.0": { optionalDependencies: { leaf: "^2.0.0" } } },
    };
    using p = await project({ dependencies: { parent: "^1.0.0" } }, releases);
    const { "1.1.0": newer, ...older } = releases.parent;
    releases.parent = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.parent = { ...older, "1.1.0": newer };

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({ errors: [], saved: true, exitCode: 0 });
    expect([await p.locked("parent"), await p.locked("leaf")]).toEqual([["1.1.0"], []]);
    expect(existsSync(p.path("node_modules", "leaf"))).toBe(false);
  });

  // The rows are in the order of their keys, and the warnings in the order of the names of the packages.
  it("`bun update` warns about the kept packages in the order of their names", async () => {
    const optionalDependencies = { a: "npm:zed@^1.0.0", b: "npm:alpha@^1.0.0", c: "npm:mid@^1.0.0" };
    const releases = { zed: { "1.0.0": {} }, alpha: { "1.0.0": {} }, mid: { "1.0.0": {} } };
    using p = await project({ optionalDependencies }, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    for (const name of Object.keys(releases)) p.refuse(name, 404);
    expect(await p.run("update")).toMatchObject({
      ...unchanged,
      warnings: ["alpha", "mid", "zed"].map(
        name => `warn: ${name}@1.0.0 was not checked for updates: ${p.refused(404, name)}`,
      ),
    });
    expect(await p.written()).toEqual(before);
  });

  // The reason is what the failed request logged, and not another warning that has the name of the package in it.
  // `old` moves to a version that is deprecated, as all of its versions are: one that is not would be preferred.
  it("`bun update` gives the failed request as the reason, next to the deprecation warning of another package", async () => {
    const deprecated = "this package is unmaintained, use leaf instead";
    const releases: Releases = { ...LEAF, old: { "1.0.0": {}, "1.1.0": {} } };
    using p = await project({ dependencies: { old: "^1.0.0" }, ...OPTIONAL_LEAF }, releases);
    releases.old = { "1.0.0": {} };
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.old = { "1.0.0": { deprecated }, "1.1.0": { deprecated } };

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({
      ...unchanged,
      warnings: [...notChecked(p.refused(404)), `warn: deprecated old@1.1.0: ${deprecated}`],
      saved: true,
    });
    expect([await p.locked("old"), await p.locked("leaf")]).toEqual([["1.1.0"], ["1.1.0"]]);
    expect(await file(p.path("package.json")).json()).toEqual({
      name: "foo",
      dependencies: { old: "^1.1.0" },
      ...OPTIONAL_LEAF,
    });
  });

  it("`bun update --silent` prints nothing and changes nothing after a 404 for its manifest", async () => {
    using p = await project(OPTIONAL_LEAF);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    p.refuse("leaf", 404);
    p.asked();
    expect(await p.run("update", "--silent")).toMatchObject({ out: "", err: "", exitCode: 0 });
    expect(p.asked()).toEqual(["leaf"]);
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  // Only the entry that was kept stays as written. The same key of another workspace is another package here.
  it("leaves the entry of the same key in another workspace to `bun update`", async () => {
    const releases: Releases = { ...LEAF, other: { "2.0.0": {}, "2.1.0": {} } };
    const alias = (range: string) => ({ name: "pkg2", optionalDependencies: { leaf: `npm:other@${range}` } });
    using p = await project({ workspaces: ["packages/*"] }, releases, {
      "packages/pkg1/package.json": JSON.stringify({ name: "pkg1", ...OPTIONAL_LEAF }),
      "packages/pkg2/package.json": JSON.stringify(alias("^2.0.0")),
    });
    const { "2.1.0": newer, ...older } = releases.other;
    releases.other = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.other = { ...older, "2.1.0": newer };

    p.refuse("leaf", 404);
    expect(await p.run("update", "-r")).toMatchObject({
      ...unchanged,
      warnings: notChecked(p.refused(404)),
      saved: true,
    });
    expect(await file(p.path("packages/pkg1/package.json")).json()).toEqual({ name: "pkg1", ...OPTIONAL_LEAF });
    expect(await file(p.path("packages/pkg2/package.json")).json()).toEqual(alias("^2.1.0"));
    expect([await p.locked("leaf"), await p.locked("other")]).toEqual([["1.1.0"], ["2.1.0"]]);
  });

  // Nor does the name of the workspace tell the two entries apart: it may be the name of the root.
  it.each(["mylib", "core"])(
    "in a root named mylib: leaves the entry of the same key in a workspace named %s to `bun update --latest`",
    async name => {
      const releases: Releases = { ...LEAF, other: { "2.0.0": {}, "3.0.0": {} } };
      const alias = (range: string) => ({ name, optionalDependencies: { leaf: `npm:other@${range}` } });
      const root = { name: "mylib", workspaces: ["packages/*"], ...OPTIONAL_LEAF };
      using p = await project(root, releases, { "packages/m/package.json": JSON.stringify(alias("^2.0.0")) });
      const { "3.0.0": newer, ...older } = releases.other;
      releases.other = older;
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      releases.other = { ...older, "3.0.0": newer };

      p.refuse("leaf", 404);
      expect(await p.run("update", "--latest", "-r")).toMatchObject({
        ...unchanged,
        warnings: notChecked(p.refused(404)),
        saved: true,
      });
      expect(await file(p.path("package.json")).json()).toEqual(root);
      expect(await file(p.path("packages/m/package.json")).json()).toEqual(alias("^3.0.0"));
      expect([await p.locked("leaf"), await p.locked("other")]).toEqual([["1.1.0"], ["3.0.0"]]);
      expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
    },
  );

  // The same holds for the entries of a catalog: the one of another dependency moves, and so does the one that
  // another workspace has for the same key in another catalog.
  it("leaves the catalog entry of another dependency to `bun update`", async () => {
    const releases: Releases = { ...LEAF, other: { "2.0.0": {}, "2.1.0": {} } };
    const root = (other: string) => ({
      workspaces: { packages: [], catalog: { leaf: "^1.0.0", other } },
      optionalDependencies: { leaf: "catalog:", other: "catalog:" },
    });
    using p = await project(root("^2.0.0"), releases);
    const { "2.1.0": newer, ...older } = releases.other;
    releases.other = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.other = { ...older, "2.1.0": newer };

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(404)), saved: true });
    expect(await file(p.path("package.json")).json()).toEqual({ name: "foo", ...root("^2.1.0") });
    expect([await p.locked("leaf"), await p.locked("other")]).toEqual([["1.1.0"], ["2.1.0"]]);
  });

  it("leaves the entry of the same key in another catalog to `bun update`", async () => {
    const releases: Releases = { ...LEAF, other: { "2.0.0": {}, "2.1.0": {} } };
    const root = (range: string) => ({
      workspaces: {
        packages: ["packages/*"],
        catalog: { leaf: `npm:other@${range}` },
        catalogs: { b: { leaf: "^1.0.0" } },
      },
      optionalDependencies: { leaf: "catalog:" },
    });
    const pkg1 = JSON.stringify({ name: "pkg1", optionalDependencies: { leaf: "catalog:b" } });
    using p = await project(root("^2.0.0"), releases, { "packages/pkg1/package.json": pkg1 });
    const { "2.1.0": newer, ...older } = releases.other;
    releases.other = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.other = { ...older, "2.1.0": newer };

    p.refuse("leaf", 404);
    expect(await p.run("update", "-r")).toMatchObject({
      ...unchanged,
      warnings: notChecked(p.refused(404)),
      saved: true,
    });
    expect(await file(p.path("package.json")).json()).toEqual({ name: "foo", ...root("^2.1.0") });
    expect(await file(p.path("packages/pkg1/package.json")).text()).toBe(pkg1);
    expect([await p.locked("leaf"), await p.locked("other")]).toEqual([["1.1.0"], ["2.1.0"]]);
  });

  // A plain install asks again when a rule for the name changes, and for an entry that is new or is written
  // somewhere else. It prints nothing about a manifest that --offline does not have.
  describe.each<[string, string[]]>([
    ["after a 404 for its manifest", []],
    ["under --offline without its manifest in the cache", ["--offline"]],
  ])("%s", (_, args) => {
    const offline = args.includes("--offline");

    it.each<[string, string, string[]]>([
      ["keeps its version under a new override that accepts it", "^1.0.0", ["1.1.0"]],
      ["is left out under a new override that rejects its version", "1.0.0", []],
    ])("%s", async (_, rule, locked) => {
      const root = { dependencies: { parent: "1.0.0" } };
      const releases = { ...LEAF, parent: { "1.0.0": { optionalDependencies: { leaf: "^1.0.0" } } } };
      using p = await project(root, releases);
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      expect(await p.locked("leaf")).toEqual(["1.1.0"]);

      await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root, overrides: { leaf: rule } }));
      rmSync(p.path(".bun-cache"), { recursive: true, force: true });
      p.refuse("leaf", 404);
      p.asked();
      expect(await p.run("install", ...args)).toMatchObject({
        warnings: offline ? [] : [`warn: ${p.refused(404)}`],
        errors: [],
        exitCode: 0,
      });
      expect(p.asked()).toEqual(offline ? [] : ["leaf"]);
      expect(await p.locked("leaf")).toEqual(locked);
    });

    it("that is new takes the version that bun.lock has for a dependency of a package", async () => {
      const root = { dependencies: { parent: "1.0.0" } };
      const releases = { ...LEAF, parent: { "1.0.0": { dependencies: { leaf: "1.0.0" } } } };
      using p = await project(root, releases);
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });

      await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root, ...OPTIONAL_LEAF }));
      rmSync(p.path(".bun-cache"), { recursive: true, force: true });
      p.refuse("leaf", 404);
      p.asked();
      expect(await p.run("install", ...args)).toMatchObject({
        warnings: offline ? [] : [`warn: ${p.refused(404)}`],
        errors: [],
        exitCode: 0,
      });
      expect(p.asked()).toEqual(offline ? [] : ["leaf"]);
      expect(await p.locked("leaf")).toEqual(["1.0.0"]);
      expect((await p.written())[0]).not.toContain('"unresolved"');
      expect(await p.installed("node_modules", "leaf")).toBe("1.0.0");
    });

    // [the edit, package.json before, the other files before, the files after, the key that reaches leaf]
    it.each<[string, object, Record<string, string>, Record<string, object>, string]>([
      [
        "moved from dependencies to optionalDependencies",
        { dependencies: { leaf: "^1.0.0" } },
        {},
        { "package.json": OPTIONAL_LEAF },
        "leaf",
      ],
      [
        "moved from the root to a workspace",
        { workspaces: ["packages/*"], ...OPTIONAL_LEAF },
        { "packages/pkg1/package.json": JSON.stringify({ name: "pkg1" }) },
        {
          "package.json": { workspaces: ["packages/*"] },
          "packages/pkg1/package.json": { name: "pkg1", ...OPTIONAL_LEAF },
        },
        "leaf",
      ],
      [
        "renamed to an npm: alias of its package",
        OPTIONAL_LEAF,
        {},
        { "package.json": { optionalDependencies: { aliased: "npm:leaf@^1.0.0" } } },
        "aliased",
      ],
      ["moved to a catalog with its range", OPTIONAL_LEAF, {}, { "package.json": cataloged("^1.0.0") }, "leaf"],
    ])("keeps its version when its entry is %s", async (_, before, files, after, key) => {
      using p = await project(before, LEAF, files);
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      expect(await p.locked("leaf")).toEqual(["1.1.0"]);

      for (const [name, fields] of Object.entries(after)) {
        await writeFile(p.path(name), JSON.stringify({ name: "foo", ...fields }));
      }
      // Only the manifest goes. The extracted package stays, for --offline to install under the new key.
      rmSync(p.manifest("leaf"));
      p.refuse("leaf", 404);
      p.asked();
      expect(await p.run("install", ...args)).toMatchObject({
        warnings: offline ? [] : [`warn: ${p.refused(404)}`],
        errors: [],
        exitCode: 0,
      });
      expect(p.asked()).toEqual(offline ? [] : ["leaf"]);
      expect(await p.locked("leaf")).toEqual(["1.1.0"]);
      expect((await p.written())[0]).not.toContain('"unresolved"');
      expect(await p.installed("node_modules", key)).toBe("1.1.0");
    });

    // Nothing is kept for an entry that is a required one afterwards: the install fails and writes nothing.
    it.each<[string, object, object]>([
      [
        "moved from dependencies to devDependencies",
        { dependencies: { leaf: "^1.0.0" } },
        { devDependencies: { leaf: "^1.0.0" } },
      ],
      ["moved from optionalDependencies to dependencies", OPTIONAL_LEAF, { dependencies: { leaf: "^1.0.0" } }],
    ])("a required entry that is %s fails the install", async (_, before, after) => {
      using p = await project(before);
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      const lock = (await p.written())[0];

      await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...after }));
      rmSync(p.manifest("leaf"));
      p.refuse("leaf", 404);
      expect(await p.run("install", ...args)).toMatchObject({
        warnings: [],
        errors: [offline ? notCached : `error: ${p.refused(404)}`, unresolved],
        saved: false,
        exitCode: 1,
      });
      expect((await p.written())[0]).toBe(lock);
    });
  });

  // As an install without the failure does: both rows move to the version that has a patch.
  it("takes the patched version that a new override allows, after a 404 for its manifest", async () => {
    const parent = { dependencies: { parent: "1.0.0" } };
    const patched = {
      ...parent,
      optionalDependencies: { leaf: "1.0.0" },
      patchedDependencies: { "leaf@1.0.0": "patches/leaf@1.0.0.patch" },
    };
    const releases = { ...LEAF, parent: { "1.0.0": { optionalDependencies: { leaf: "^1.0.0" } } } };
    using p = await project(parent, releases, { "patches/leaf@1.0.0.patch": ADDS_PATCHED_TXT });
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...patched }));
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    expect(await p.locked("leaf")).toEqual(["1.0.0", "1.1.0"]);

    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...patched, overrides: { leaf: "^1.0.0" } }));
    rmSync(p.path(".bun-cache"), { recursive: true, force: true });
    p.refuse("leaf", 404);
    expect(await p.run("install")).toMatchObject({ warnings: [`warn: ${p.refused(404)}`], errors: [], exitCode: 0 });
    expect(await p.locked("leaf")).toEqual(["1.0.0"]);
    expect(await file(p.path("node_modules", "leaf", "patched.txt")).text()).toBe("hello world\n");
  });

  // bun.lock and package.json agree on an override, and a row is still bound outside of it, as after a merge. That
  // row is resolved again once everything else is: it takes the version that bun.lock has for the rule.
  it.each(["install", "update"])(
    "`bun %s` moves a row that a merged bun.lock has outside an override",
    async command => {
      const root = { dependencies: { parent: "1.0.0", other: "1.0.0" } };
      const releases = {
        ...LEAF,
        parent: { "1.0.0": { optionalDependencies: { leaf: "^1.0.0" } } },
        other: { "1.0.0": { dependencies: { leaf: "1.0.0" } } },
      };
      using p = await project({ dependencies: { parent: "1.0.0" } }, releases);
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root }));
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      expect(await p.locked("leaf")).toEqual(["1.0.0", "1.1.0"]);

      const rule = '"overrides": {\n    "leaf": "1.0.0",\n  },\n  ';
      const lock = await file(p.path("bun.lock")).text();
      expect(lock).toContain('\n  "packages": {');
      await writeFile(p.path("bun.lock"), lock.replace('"packages": {', rule + '"packages": {'));
      await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root, overrides: { leaf: "1.0.0" } }));
      rmSync(p.manifest("leaf"));
      p.refuse("leaf", 404);
      expect(await p.run(command)).toMatchObject({ errors: [], exitCode: 0 });
      expect(await p.locked("leaf")).toEqual(["1.0.0"]);
      expect((await p.written())[0]).not.toContain('"unresolved"');
    },
  );

  // An entry that is new has no version of its own. `bun update` holds it on the patched version, and --latest does
  // not, as when the registry answers.
  it.each<[string[], string]>([
    [[], "1.0.0"],
    [["--latest"], "1.1.0"],
  ])("that is new: `bun update %s` takes the patched version only without --latest", async (args, version) => {
    const root = {
      dependencies: { low: "1.0.0", high: "1.0.0" },
      patchedDependencies: { "leaf@1.0.0": "patches/leaf@1.0.0.patch" },
    };
    const releases = {
      ...LEAF,
      low: { "1.0.0": { dependencies: { leaf: "1.0.0" } } },
      high: { "1.0.0": { dependencies: { leaf: "1.1.0" } } },
    };
    using p = await project(root, releases, { "patches/leaf@1.0.0.patch": ADDS_PATCHED_TXT });
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    expect(await p.locked("leaf")).toEqual(["1.0.0", "1.1.0"]);

    const packageJson = JSON.stringify({ name: "foo", ...root, ...OPTIONAL_LEAF }, null, 2);
    await writeFile(p.path("package.json"), packageJson);
    p.refuse("leaf", 404);
    expect(await p.run("update", ...args)).toMatchObject({ errors: [], exitCode: 0 });
    expect(await p.installed("node_modules", "leaf")).toBe(version);
    expect(await file(p.path("package.json")).text()).toBe(packageJson);
  });

  it("whose key now asks for another package does not keep the package of the old name", async () => {
    const releases = { ...LEAF, other: { "1.0.0": {} } };
    using p = await project(OPTIONAL_LEAF, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });

    const packageJson = JSON.stringify({ name: "foo", optionalDependencies: { leaf: "npm:other@^1.0.0" } }, null, 2);
    await writeFile(p.path("package.json"), packageJson);
    p.refuse("other", 404);
    expect(await p.run("update")).toMatchObject({ errors: [], exitCode: 0 });
    expect([await p.locked("leaf"), await p.locked("other")]).toEqual([[], []]);
    expect(await file(p.path("package.json")).text()).toBe(packageJson);
  });

  // The entry is on 1.1.0, and `pin` has 1.0.0, which has a patch. --latest does not hold an entry on a patched
  // version, and a failed request does not move the entry down to one either. After a 404 or a 503 the failed
  // request is on a line of its own.
  it.each<[string, number, string[], (refused: string) => string[]]>([
    ["after a 404 for its manifest", 404, [], refused => [`warn: ${refused}`, ...notChecked()]],
    ["after a 503 for its manifest", 503, [], refused => [`warn: ${refused}`, ...notChecked()]],
    ["under --offline without its manifest in the cache", 404, ["--offline"], () => notChecked()],
  ])("`bun update --latest` does not move it down to a patched version %s", async (_, status, args, warns) => {
    const root = { dependencies: { pin: "1.0.0" }, ...OPTIONAL_LEAF };
    const patched = { ...root, patchedDependencies: { "leaf@1.0.0": "patches/leaf@1.0.0.patch" } };
    const releases = { ...LEAF, pin: { "1.0.0": { dependencies: { leaf: "1.0.0" } } } };
    using p = await project(root, releases, { "patches/leaf@1.0.0.patch": ADDS_PATCHED_TXT });
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...patched }));
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();
    expect(await p.locked("leaf")).toEqual(["1.0.0", "1.1.0"]);

    rmSync(p.manifest("leaf"));
    p.refuse("leaf", status);
    expect(await p.run("update", "--latest", ...args)).toMatchObject({
      ...unchanged,
      warnings: warns(p.refused(status)),
    });
    expect(await p.written()).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
    expect(await file(p.path("node_modules", "pin", "node_modules", "leaf", "patched.txt")).text()).toBe(
      "hello world\n",
    );
  });

  // The registry lets no manifest be used again without a request. `aaa` asks for an exact version that the cached
  // manifest lists, which needs no request: bun.lock has leaf@1.2.0 by the time the request for the range fails.
  // The entry takes 1.1.0, which bun.lock had before, and not the version that this install added.
  it("that is new takes no version that the same install added to bun.lock", async () => {
    const root = { dependencies: { parent: "1.0.0" } };
    const releases = {
      leaf: { "1.0.0": {}, "1.1.0": {}, "1.2.0": {} },
      parent: { "1.0.0": { optionalDependencies: { leaf: "~1.1.0" } } },
    };
    using p = await project(root, releases);
    p.expireManifests();
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    expect(await p.locked("leaf")).toEqual(["1.1.0"]);

    const optionalDependencies = { aaa: "npm:leaf@1.2.0", leaf: "^1.0.0" };
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root, optionalDependencies }));
    p.refuse("leaf", 503);
    p.asked();
    expect(await p.run("install")).toMatchObject({ warnings: [`warn: ${p.refused(503)}`], errors: [], exitCode: 0 });
    expect(p.asked()).toEqual(["leaf"]);
    expect(await p.locked("leaf")).toEqual(["1.1.0", "1.2.0"]);
    expect((await p.written())[0]).not.toContain('"unresolved"');
    expect([await p.installed("node_modules", "aaa"), await p.installed("node_modules", "leaf")]).toEqual([
      "1.2.0",
      "1.1.0",
    ]);
  });

  // What a failed request must not turn into a package: an entry that asks for something else now, an entry that
  // asks for a dist-tag, and a version that the registry no longer lists. --latest asks for the tag `latest` where
  // a `catalog:` entry is written, so that entry is left out too.
  it.each<[string, Releases, object, object, string[]]>([
    [
      "a catalog entry that now rejects its version",
      { leaf: { "1.0.0-beta.1": {} } },
      cataloged("*"),
      cataloged("^2.0.0"),
      [],
    ],
    ["a catalog entry that is now a tag", LEAF, cataloged("^1.0.0"), cataloged("next"), []],
    ["a range that now rejects its version", LEAF, OPTIONAL_LEAF, { optionalDependencies: { leaf: "^2.0.0" } }, []],
    ["--latest for a catalog entry", LEAF, cataloged("^1.0.0"), cataloged("^1.0.0"), ["--latest"]],
  ])("is left out under %s, after a 404 for its manifest", async (_, releases, installed, edited, args) => {
    using p = await project(installed, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    expect(await p.locked("leaf")).toHaveLength(1);

    const packageJson = JSON.stringify({ name: "foo", ...edited }, null, 2);
    await writeFile(p.path("package.json"), packageJson);
    p.refuse("leaf", 404);
    expect(await p.run("update", ...args)).toMatchObject({ errors: [], exitCode: 0 });
    expect(await p.locked("leaf")).toEqual([]);
    expect(await file(p.path("package.json")).text()).toBe(packageJson);
  });

  it("that asks for a dist-tag and never resolved stays unresolved", async () => {
    const releases = { ...LEAF, parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } } };
    const root = { dependencies: { parent: "1.0.0" }, optionalDependencies: { leaf: "no-such-tag" } };
    using p = await project(root, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();
    expect(before[0]).toContain('"unresolved"');

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({ errors: [], saved: false, exitCode: 0 });
    expect(await p.written()).toEqual(before);
  });

  // An entry that asks for a range is another matter, whether or not it had a package. Its first install got a
  // 404, and a later one brought `parent` without asking again about the entry: bun.lock lists it as unresolved,
  // and has a package in its range.
  it("that asks for a range and never resolved takes the version that bun.lock has for a dependency of a package", async () => {
    const releases = { ...LEAF, parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } } };
    using p = await project(OPTIONAL_LEAF, releases);
    p.refuse("leaf", 404);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    p.refuse("leaf", 0);
    const root = { dependencies: { parent: "1.0.0" }, ...OPTIONAL_LEAF };
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...root }));
    expect(await p.run("install")).toMatchObject({ errors: [], exitCode: 0 });
    const before = await p.written();
    expect(before[0]).toContain('"unresolved"');

    p.refuse("leaf", 404);
    expect(await p.run("update")).toMatchObject({ ...unchanged, warnings: notChecked(p.refused(404)), saved: true });
    const after = await p.written();
    expect(after[0]).not.toContain('"unresolved"');
    expect(after[1]).toBe(before[1]);
    expect(await p.locked("leaf")).toEqual(["1.1.0"]);
    expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
  });

  it("is left out when the registry answers and no longer lists a version in its range", async () => {
    const releases: Releases = { leaf: { "1.0.0": {}, "1.1.0": {}, "2.0.0": {} } };
    using p = await project(OPTIONAL_LEAF, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    expect(await p.locked("leaf")).toEqual(["1.1.0"]);
    delete releases.leaf["1.0.0"];
    delete releases.leaf["1.1.0"];

    expect(await p.run("update")).toMatchObject({ warnings: [], errors: [], exitCode: 0 });
    expect(await p.locked("leaf")).toEqual([]);
    expect(await file(p.path("package.json")).json()).toEqual({ name: "foo", ...OPTIONAL_LEAF });
  });

  // A dependency that the install cannot do without still fails it, and then nothing is written. The update has
  // warned about the package before that when it asked for a dependency of a package, or for the optional entry.
  it.each<[string, object, Releases, Record<string, string>, string[], (refused: string) => object]>([
    [
      "the root requires the package",
      { dependencies: { leaf: "^1.0.0" } },
      LEAF,
      {},
      [],
      refused => ({ warnings: [], errors: [`error: ${refused}`, unresolved] }),
    ],
    [
      "the root requires the package that a dependency of a package also has",
      { dependencies: { parent: "1.0.0", leaf: "^1.0.0" } },
      { ...LEAF, parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } } },
      {},
      [],
      refused => ({ warnings: notChecked(refused), errors: [unresolved] }),
    ],
    [
      "a workspace requires the package",
      { workspaces: ["packages/*"], ...OPTIONAL_LEAF },
      LEAF,
      { "packages/pkg1/package.json": JSON.stringify({ name: "pkg1", dependencies: { leaf: "^1.0.0" } }) },
      ["-r"],
      refused => ({ warnings: notChecked(), errors: [`error: ${refused}`, unresolved] }),
    ],
  ])("`bun update` fails after a 404 for the manifest when %s", async (_, root, releases, files, args, printed) => {
    const workspaces = Object.keys(files).map(f => f.replace("/package.json", ""));
    using p = await project(root, releases, files);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written(...workspaces);

    p.refuse("leaf", 404);
    expect(await p.run("update", ...args)).toMatchObject({ ...printed(p.refused(404)), saved: false, exitCode: 1 });
    expect(await p.written(...workspaces)).toEqual(before);
    expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
  });

  // So does a dependency that the kept package cannot do without. New overrides make a plain install ask again
  // for the package and for its dependency, and neither manifest arrives.
  it("fails the install when a dependency that its package requires gets no manifest either", async () => {
    const releases = { leaf: { "1.0.0": { dependencies: { dep: "^1.0.0" } } }, dep: { "1.0.0": {} } };
    using p = await project(OPTIONAL_LEAF, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const lock = (await p.written())[0];

    const overrides = { leaf: "^1.0.0", dep: "^1.0.0" };
    await writeFile(p.path("package.json"), JSON.stringify({ name: "foo", ...OPTIONAL_LEAF, overrides }));
    rmSync(p.path(".bun-cache"), { recursive: true, force: true });
    p.refuse("leaf", 404);
    p.refuse("dep", 404);
    expect(await p.run("install")).toMatchObject({
      warnings: [`warn: ${p.refused(404)}`],
      errors: [`error: ${p.refused(404, "dep")}`, "error: dep@^1.0.0 failed to resolve"],
      saved: false,
      exitCode: 1,
    });
    expect((await p.written())[0]).toBe(lock);
    expect(await p.installed("node_modules", "leaf")).toBe("1.0.0");
  });

  // So does an entry that the command selects, by a name, a pattern or a flag: nothing is kept for it, and the
  // refused request is the last one. A pattern asks about the dependencies of packages before that.
  it.each<[string, string[], string[]]>([
    ["<name> --latest", ["parent", "--latest"], ["parent"]],
    ["<pattern>", ["*"], ["leaf", "parent"]],
    ["--prod", ["--prod"], ["parent"]],
    ["--depth 0", ["--depth", "0"], ["parent"]],
  ])("`bun update %s` fails after a 404 for the manifest of the entry", async (_, args, asked) => {
    const releases = { ...LEAF, parent: { "1.0.0": { dependencies: { leaf: "^1.0.0" } } } };
    using p = await project({ optionalDependencies: { parent: "^1.0.0" } }, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();

    p.refuse("parent", 404);
    p.asked();
    expect(await p.run("update", ...args)).toMatchObject({
      ...unchanged,
      warnings: [`warn: ${p.refused(404, "parent")}`],
      exitCode: 1,
    });
    expect(p.asked()).toEqual(asked);
    expect(await p.written()).toEqual(before);
  });

  // The same under --offline, where the manifest of `good` is in the cache and the one of leaf is not: the update
  // fails as it does for a required dependency, whatever else it names.
  it.each(["leaf", "leaf@^9.0.0", "leaf good", "leaf good -r"])(
    "`bun update %s --offline` fails without the manifest of the entry in the cache",
    async names => {
      const root = { dependencies: { good: "^1.0.0" }, ...OPTIONAL_LEAF };
      using p = await project(root, { ...LEAF, good: { "1.0.0": {} } });
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      const before = await p.written();
      rmSync(p.manifest("leaf"));

      p.asked();
      expect(await p.run("update", ...names.split(" "), "--offline")).toMatchObject({
        ...unchanged,
        errors: [notCached],
        exitCode: 1,
      });
      expect(p.asked()).toEqual([]);
      expect(await p.written()).toEqual(before);
      expect(await p.installed("node_modules", "leaf")).toBe("1.1.0");
    },
  );

  // `bun add` names its entry too. bun.lock has a version in the range, for `parent`, and the entry does not take
  // it.
  it.each<[string, string[]]>([
    ["", []],
    [" --exact", ["--exact"]],
  ])("`bun add --optional <name>@<range>%s --offline` fails without its manifest in the cache", async (_, flags) => {
    const releases = { ...LEAF, parent: { "1.0.0": { dependencies: { leaf: "1.0.0" } } } };
    using p = await project({ dependencies: { parent: "1.0.0" } }, releases);
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    const before = await p.written();
    rmSync(p.manifest("leaf"));

    p.asked();
    expect(await p.run("add", "--optional", "leaf@^1.0.0", ...flags, "--offline")).toMatchObject({
      ...unchanged,
      errors: [notCached],
      exitCode: 1,
    });
    expect(p.asked()).toEqual([]);
    expect(await p.written()).toEqual(before);
  });

  // No request can be made to the registry URL of its scope, and `dev` has a newer version by then. An update that
  // names both asks about `dev`, fails and writes nothing, whether the row of `dev` comes before the entry or after.
  const cannotAsk = ["warn: Registry URL must be http:// or https://", "warn: InvalidURL"];
  const scoped = (group: string, dev: string) => ({
    [group]: { dev },
    optionalDependencies: { "@priv/leaf": "^1.0.0" },
  });
  it.each([
    ["devDependency", "devDependencies"],
    ["dependency", "dependencies"],
  ])(
    "`bun update <%s> <name>` fails when no request can be made to the registry URL of its scope",
    async (_, group) => {
      const releases: Releases = { dev: { "1.0.0": {}, "1.1.0": {} }, "@priv/leaf": LEAF.leaf };
      using p = await project(scoped(group, "^1.0.0"), releases);
      const { "1.1.0": newer, ...older } = releases.dev;
      releases.dev = older;
      expect(await p.run("install")).toMatchObject({ exitCode: 0 });
      releases.dev = { ...older, "1.1.0": newer };
      const before = await p.written();

      await p.configure({ scopes: { priv: "ftp://localhost/" } });
      p.asked();
      expect(await p.run("update", "dev", "@priv/leaf")).toMatchObject({
        ...unchanged,
        warnings: cannotAsk,
        exitCode: 1,
      });
      expect(p.asked()).toEqual(["dev"]);
      expect(await p.written()).toEqual(before);
    },
  );

  // A bare update in the same state moves `dev` and keeps the entry.
  it("`bun update` still moves the other entries when no request can be made to the registry URL of its scope", async () => {
    const releases: Releases = { dev: { "1.0.0": {}, "1.1.0": {} }, "@priv/leaf": LEAF.leaf };
    using p = await project(scoped("dependencies", "^1.0.0"), releases);
    const { "1.1.0": newer, ...older } = releases.dev;
    releases.dev = older;
    expect(await p.run("install")).toMatchObject({ exitCode: 0 });
    releases.dev = { ...older, "1.1.0": newer };

    await p.configure({ scopes: { priv: "ftp://localhost/" } });
    expect(await p.run("update")).toMatchObject({
      ...unchanged,
      warnings: ["warn: @priv/leaf@1.1.0 was not checked for updates", ...cannotAsk],
      saved: true,
    });
    expect(await file(p.path("package.json")).json()).toEqual({ name: "foo", ...scoped("dependencies", "^1.1.0") });
    expect([await p.locked("dev"), await p.locked("@priv/leaf")]).toEqual([["1.1.0"], ["1.1.0"]]);
    expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
  });
});
