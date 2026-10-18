import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { lstatSync, readdirSync, rmSync } from "fs";
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

    // Whoever typed the command has waited for as long as the timeout allows.
    it("does not ask again a registry that takes the connection and never answers", async () => {
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

    it("does not ask again after a 501", async () => {
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

  // What `bun init` writes. Peers are resolved after everything else, so offline they doubled the wait.
  it("does not ask for the project's peers once a dependency has failed", async () => {
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

  it("does not ask for a package's peers once a dependency of that package has failed", async () => {
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

  // yarn.lock and pnpm-lock.yaml do not record `bin`, so a migration asks the registry for it and goes on without an answer.
  describe.each(["yarn.lock", "pnpm-lock.yaml"] as const)("the manifests a migrated %s is completed from", name => {
    const integrity = "sha512-" + Buffer.alloc(86, "A").toString() + "==";
    const lockfile = {
      "yarn.lock": `# yarn lockfile v1\n\n\nbar@0.0.2:\n  version "0.0.2"\n  integrity ${integrity}\n`,
      "pnpm-lock.yaml": `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      bar:\n        specifier: 0.0.2\n        version: 0.0.2\n\npackages:\n\n  bar@0.0.2:\n    resolution: {integrity: ${integrity}}\n\nsnapshots:\n\n  bar@0.0.2: {}\n`,
    }[name];

    it("are asked for once when the registry cannot be reached", async () => {
      const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
      await closed.stop(true);
      using dir = project(closed.url.href);
      await writeFile(join(String(dir), name), lockfile);
      const { lines, exitCode } = await install(String(dir), {}, "--lockfile-only", "--verbose");
      // macOS refuses a closed loopback port in connect(2) itself, which has its own name.
      expect(lines.filter(line => line.includes("downloading package manifest"))).toEqual([
        expect.stringMatching(/^warn: (ConnectionRefused|FailedToOpenSocket) downloading package manifest bar$/),
      ]);
      expect(await file(join(String(dir), "bun.lock")).text()).toContain(`"bar": ["bar@0.0.2", `);
      expect(exitCode).toBe(0);
    });

    it("are asked for again when the registry is busy", async () => {
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
    it("stays as it is after one dropped connection", async () => {
      expect(await peakAfter(1, 8)).toEqual([
        "warn: ConnectionClosed downloading package manifest bar. Retry 1/5 in 1ms...",
      ]);
    });

    it("loses a quarter once the same request was dropped twice", async () => {
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
          // Not the ones about peers.
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

  // What a peer needs is the copy the tree gives it, which is not always the one it resolved to:
  // a dependency of the root provides a peer whatever its version.
  describe("hoisted: a peer that is served the root's version", () => {
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
