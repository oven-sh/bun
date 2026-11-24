import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { once } from "events";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { access, writeFile } from "fs/promises";
import {
  bunExe,
  bunEnv as env,
  isASAN,
  isGlibcVersionAtLeast,
  isLinux,
  isMacOS,
  isWindows,
  readdirSorted,
  tempDir,
  tls,
  tmpdirSync,
  toBeValidBin,
  toBeWorkspaceLink,
  toHaveBins,
} from "harness";
import { connect, createServer, type AddressInfo } from "net";
import { constants } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { brotliCompressSync, gzipSync, constants as zlib } from "zlib";
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

  it.each(["manifest", "tarball"] as const)("retries a %s whose Content-Encoding is unfinished", async failing => {
    const unfinished = gzipSync("{}", { finishFlush: zlib.Z_SYNC_FLUSH });
    using registry = flakyRegistry((kind, hit) =>
      kind === failing && hit === 1 ? new Response(unfinished, { headers: { "Content-Encoding": "gzip" } }) : undefined,
    );
    using dir = project(registry.url);
    const { lines, out, exitCode } = await install(String(dir));
    expect(lines).toContain("Decompression error: ZlibError");
    expect(out).toContain("1 package installed");
    expect(registry.at[failing]).toHaveLength(2);
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

  it("keeps the connection alive again after a proxy refused a tunnel", async () => {
    const seen: [string, string | null][] = [];
    using registry = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        seen.push([pathname, request.headers.get("connection")]);
        if (pathname.endsWith(".tgz")) return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
        const dist = { tarball: `${origin}/bar-0.0.2.tgz` };
        return Response.json({ name: "bar", versions: { "0.0.2": { name: "bar", version: "0.0.2", dist } } });
      },
    });
    let tunnels = 0;
    await using proxy = createServer(client => {
      client.on("error", () => {});
      let head = "";
      client.on("data", function onHead(chunk) {
        head += chunk;
        if (!head.endsWith("\r\n\r\n")) return;
        client.off("data", onHead);
        if (++tunnels === 1) return client.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
        const upstream = connect(registry.port!, "127.0.0.1", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => client.destroy());
        client.on("close", () => upstream.destroy());
      });
    }).listen(0, "127.0.0.1");
    await once(proxy, "listening");
    using dir = project(registry.url.href);
    writeFileSync(join(String(dir), "ca.pem"), tls.cert);
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const { err, exitCode } = await install(
      String(dir),
      { https_proxy: proxyUrl, HTTPS_PROXY: proxyUrl, no_proxy: "", NO_PROXY: "" },
      "--cafile=ca.pem",
    );
    expect(err).not.toContain("error:");
    expect({ seen, tunnels }).toEqual({
      seen: [
        ["/bar", "keep-alive"],
        ["/bar-0.0.2.tgz", "keep-alive"],
      ],
      tunnels: 2,
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

describe.concurrent("an optional dependency for which there is no memory", () => {
  const CAP = 8;
  const long = () => Buffer.alloc(1.5 * CAP * 1024 * 1024, "a").toString();
  const manifestOf = (name: string, more?: object) => JSON.stringify({ name, version: "1.0.0", ...more });
  const tarball = async (files: Record<string, string>, level: 0 | 1) =>
    Bun.gzipSync(await new Bun.Archive(files).bytes(), { level });
  const shortTarball = (more?: object) =>
    tarball(
      {
        "package/package.json": manifestOf("bar", { bin: "cli.js", ...more }),
        "package/cli.js": "",
        // More than one read from a socket takes.
        "package/lib/a": Buffer.alloc(600_000, "a").toString(),
      },
      0,
    );
  const longTarball = () => tarball({ "package/package.json": manifestOf("bar"), "package/long": long() }, 0);
  const scannerTarball = () =>
    tarball(
      {
        "package/package.json": manifestOf("scanner"),
        "package/index.js": `exports.scanner = { version: "1", scan: async () => [] }`,
      },
      1,
    );
  const encoders = {
    identity: (bytes: Buffer) => bytes,
    gzip: (bytes: Buffer) => Bun.gzipSync(bytes, { level: 1 }),
    br: (bytes: Buffer) => brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 1 } }),
    zstd: (bytes: Buffer) => Bun.zstdCompressSync(bytes),
  };

  function project(files: Record<string, string | Uint8Array> = {}, spec = "^1.0.0", linker = "hoisted") {
    const served = {
      long: undefined as "manifest" | "full manifest" | "old version" | "tarball" | undefined,
      encoding: "identity" as keyof typeof encoders,
      /** The answer to the second request for what is long. */
      again: "the same" as number | "nothing" | "a page" | "the same",
      status: 200,
      refuses: 0,
      refusesFullManifests: false,
      /** The registry takes no connection once it is asked for a tarball. */
      stops: false,
    };
    const asked = new Set<string>();
    const registry = Bun.serve({
      port: 0,
      // One of the two addresses of localhost.
      hostname: "127.0.0.1",
      async fetch({ url, headers }) {
        if (served.refuses) return new Response(null, { status: served.refuses });
        if (url.endsWith("/never")) return new Promise<Response>(() => {});
        if (url.endsWith("/scanner-1.0.0.tgz")) return new Response(await scannerTarball());
        if (served.again !== "the same" && url.endsWith(".tgz") === (served.long === "tarball")) {
          if (!asked.has(url)) asked.add(url);
          else if (served.again === 200) Object.assign(served, { long: undefined, again: "the same" });
          else if (served.again === "a page") return new Response("<p>");
          else if (served.again !== "nothing") return new Response(null, { status: served.again });
          else {
            registry.stop(true);
            return new Promise<Response>(() => {});
          }
        }
        const { status } = served;
        if (url.endsWith(".tgz")) {
          if (served.stops) registry.stop();
          if (served.long === "tarball") return new Response(await longTarball(), { status });
          return new Response(await shortTarball());
        }
        const name = decodeURIComponent(new URL(url).pathname.slice(1));
        const version = (version: string, tarball: string) => ({
          name,
          version,
          ...(name === "scanner" ? { optionalDependencies: { bar: "1.0.0" } } : { bin: { bar: "cli.js" } }),
          dist: { tarball },
        });
        const isFull = !headers.get("Accept")!.includes("install-v1");
        if (isFull && served.refusesFullManifests) return new Response(null, { status: 503 });
        const manifest = JSON.stringify({
          name,
          readme: served.long === "manifest" || (served.long === "full manifest" && isFull) ? long() : "",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "0.0.1": version("0.0.1", url + (served.long === "old version" ? long() : "")),
            "1.0.0": version("1.0.0", url + "-1.0.0.tgz"),
          },
        });
        return new Response(encoders[served.encoding](Buffer.from(manifest)), {
          status: served.long === "manifest" ? status : 200,
          headers: { "Content-Encoding": served.encoding },
        });
      },
    });
    const port = String(registry.port);
    const url = `http://localhost:${port}/`;
    const dir = tempDir("no-memory", {
      "package.json": JSON.stringify({ name: "foo", optionalDependencies: { bar: spec.replace("PORT", port) } }),
      "bunfig.toml": Bun.TOML.stringify({ install: { cache: "./.bun-cache", registry: url, linker } }),
      ...files,
    });
    const saved = () =>
      ["bun.lock", "package.json"]
        .map(name => join(String(dir), name))
        .map(path => existsSync(path) && readFileSync(path, "utf8"))
        .join();
    async function run(args: string[], more?: Record<string, string>, launcher: string[] = []) {
      await using proc = spawn({
        cmd: [...launcher, bunExe(), ...args.map(arg => arg.replace("PORT", port))],
        cwd: String(dir),
        env: {
          ...env,
          BUN_INSTALL_CACHE_DIR: undefined,
          BUN_CONFIG_HTTP_RETRY_COUNT: "1",
          BUN_CONFIG_HTTP_RETRY_BACKOFF: "0",
          BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "1",
          ...gitEnv,
          ...more,
        },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [err, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const lines = err.replaceAll(":" + port, ":PORT").split("\n");
      return { said: lines.filter(line => /^(error|warn|E[A-Z]+):/.test(line)), exitCode };
    }
    return {
      served,
      url,
      path: (...parts: string[]) => join(String(dir), ...parts),
      run,
      async prepare(...args: string[]) {
        expect(await run(args)).toEqual({ said: [], exitCode: 0 });
      },
      async withoutMemory(
        args = ["install"],
        more: Record<string, string> = {
          ASAN_OPTIONS: [env.ASAN_OPTIONS, "allocator_may_return_null=1", `max_allocation_size_mb=${CAP}`]
            .filter(Boolean)
            .join(":"),
        },
        launcher?: string[],
      ) {
        const before = saved();
        const result = await run(args, more, launcher);
        return { ...result, saved: saved() === before ? "nothing" : "something" };
      },
      [Symbol.dispose]() {
        registry.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }
  const writeYarnLock = (app: ReturnType<typeof project>) =>
    writeFileSync(
      app.path("yarn.lock"),
      `# yarn lockfile v1\n\nbar@^1.0.0:\n  version "1.0.0"\n  resolved "${app.url}bar-1.0.0.tgz"\n`,
    );
  const gitEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  async function fromGit(paths: string[], manifest = manifestOf("bar"), linker?: string) {
    const app = project({}, undefined, linker);
    const commit = `blob\nmark :1\ndata ${manifest.length}\n${manifest}\ncommit refs/heads/main\ncommitter a <a@a> 0 +0000\ndata 0\n`;
    const input = new Response(commit + paths.map(path => `M 100644 :1 ${path}\n`).join(""));
    const repo = app.path("repo");
    await Bun.$`git init -q --bare -b main ${repo} && git -C ${repo} fast-import --quiet < ${input}`.env({
      ...env,
      ...gitEnv,
    });
    const bar = "git+" + pathToFileURL(repo);
    writeFileSync(app.path("package.json"), JSON.stringify({ name: "foo", optionalDependencies: { bar } }));
    return app;
  }
  const root = (more: object) => JSON.stringify({ name: "foo", ...more });
  const fromFile = async (more?: object, files?: Record<string, string>) =>
    project({
      "package.json": root({ optionalDependencies: { bar: "file:./bar.tgz" }, trustedDependencies: ["bar"] }),
      "bar.tgz": await shortTarball(more),
      ...files,
    });
  const ENOMEM = `ENOMEM: ${isMacOS ? "Out of memory" : "Cannot allocate memory"}`;
  const fails = (call: string, ...said: string[]) => ({
    said: [...said, `${ENOMEM}: could not finish (${call})`],
    exitCode: 1,
    saved: "nothing",
  });

  describe.skipIf(!isASAN)("fails the install", () => {
    const withoutManifest = fails("recv", "error: OutOfMemory downloading package manifest bar");

    it.each(Object.keys(encoders) as (keyof typeof encoders)[])("manifest, %s", async encoding => {
      using app = project();
      Object.assign(app.served, { long: "manifest", encoding });
      expect(await app.withoutMemory()).toEqual(withoutManifest);
    });

    it("manifest, for `bun update`", async () => {
      using app = project();
      await app.prepare("install");
      app.served.long = "manifest";
      expect(await app.withoutMemory(["update"])).toEqual(withoutManifest);
      expect(existsSync(app.path("node_modules", "bar", "package.json"))).toBeTrue();
    });

    it.each([
      [["install"], withoutManifest],
      [["install", "--silent"], fails("recv")],
      [["pm", "migrate"], withoutManifest],
    ])("manifest that completes a migrated lockfile, %j", async (args, expected) => {
      using app = project();
      writeYarnLock(app);
      app.served.long = "manifest";
      expect(await app.withoutMemory(args)).toEqual(expected);
    });

    it.each(["the same", 503])("manifest that says which libc it is for, if the next attempt gets %s", async again => {
      using app = project({ "package.json": root({ optionalDependencies: { "bar-linux-musl": "1.0.0" } }) });
      Object.assign(app.served, { long: "full manifest", again });
      expect(await app.withoutMemory()).toEqual(
        fails("recv", "error: OutOfMemory downloading package manifest bar-linux-musl"),
      );
    });

    it.each([300, 404, 503, "nothing"])("manifest, if the next attempt gets %s", async again => {
      using app = project();
      Object.assign(app.served, { long: "manifest", again });
      expect(await app.withoutMemory()).toEqual(withoutManifest);
    });

    it("manifest, for `bun outdated`, if the next attempt gets 503", async () => {
      using app = project();
      await app.prepare("install");
      Object.assign(app.served, { long: "manifest", again: 503 });
      expect(await app.withoutMemory(["outdated", "--no-cache"])).toEqual(withoutManifest);
    });

    it("manifest in the cache, with --offline", async () => {
      using app = project();
      app.served.long = "old version";
      await app.prepare("install", "--no-save");
      expect(await app.withoutMemory(["install", "--offline"])).toEqual(fails("read"));
    });

    it.each([
      ["hoisted", "without", "error: OutOfMemory downloading tarball bar@1.0.0"],
      ["hoisted", "with", "error: OutOfMemory downloading tarball bar@1.0.0"],
      ["isolated", "without", "error: OutOfMemory downloading tarball bar@1.0.0"],
      ["isolated", "with", "error: failed to download bar@1.0.0: OutOfMemory"],
    ])("tarball, %s, %s a lockfile", async (linker, lockfile, error) => {
      using app = project({}, "^1.0.0", linker);
      if (lockfile === "with") await app.prepare("install", "--lockfile-only");
      rmSync(app.path(".bun-cache"), { recursive: true, force: true });
      app.served.long = "tarball";
      expect(await app.withoutMemory()).toEqual(fails("recv", error));
    });

    describe.each(["hoisted", "isolated"])("tarball of what is installed, %s", linker => {
      it.each([404, 503, "nothing"])("if the next attempt gets %s", async again => {
        using app = project({}, "^1.0.0", linker);
        await app.prepare("install");
        rmSync(app.path(".bun-cache"), { recursive: true });
        Object.assign(app.served, { long: "tarball", again });
        const { said, ...result } = await app.withoutMemory(["install", "--force"]);
        expect({ ...result, said: said.slice(-1) }).toEqual(fails("recv"));
        expect(existsSync(app.path("node_modules", "bar", "package.json"))).toBeTrue();
      });
    });

    it.each([
      ["1.0.0", "the same", fails("recv", "error: OutOfMemory downloading tarball bar@1.0.0")],
      ["1.0.0", 503, fails("recv", "error: OutOfMemory downloading tarball bar@1.0.0")],
      ["file:./bar.tgz", "the same", fails("read", "error: ENOMEM extracting tarball from bar")],
    ])("tarball, without waiting for the other downloads: %s, then %s", async (bar, again, expected) => {
      using app = project({
        "package.json": root({ optionalDependencies: { bar, never: "1.0.0" } }),
        "bar.tgz": await longTarball(),
      });
      Object.assign(app.served, { long: "tarball", again });
      expect(await app.withoutMemory()).toEqual(expected);
    });

    it.skipIf(!isLinux)("list of the files of a commit", async () => {
      const folder = Buffer.alloc(201 * 15, Buffer.alloc(200, "a") + "/").toString();
      using app = await fromGit(["package.json", ...Array.from({ length: CAP * 400 }, (_, i) => folder + i)]);
      const { said, ...result } = await app.withoutMemory();
      // Debug builds have a warning in front.
      expect({ ...result, said: said.slice(-2) }).toEqual(
        fails("read", "error: ENOMEM checking out repository for bar"),
      );
    });

    it("packages of a migrated lockfile", async () => {
      const packages = Object.fromEntries(Array.from({ length: CAP * 5000 }, (_, i) => ["node_modules/" + i, {}]));
      using app = project({
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } }),
      });
      expect(await app.withoutMemory()).toEqual(fails("mmap"));
    });

    it.each(["bun.lock", "yarn.lock", ".env"])("%s", async name => {
      using app = project({ [name]: long() });
      expect(await app.withoutMemory()).toEqual(fails("read"));
    });
  });

  describe.skipIf(!isASAN).each([
    ["manifest", "bar"],
    ["tarball", "bar-1.0.0.tgz"],
  ])("%s", (long, path) => {
    it("is installed if there is at the next attempt", async () => {
      using app = project();
      Object.assign(app.served, { long, again: 200 });
      expect(await app.withoutMemory()).toEqual({ said: [], exitCode: 0, saved: "something" });
      expect(existsSync(app.path("node_modules", "bar", "package.json"))).toBeTrue();
    });

    it.each([404, 503])("is left out if it is a refusal with %d that is long", async status => {
      using app = project();
      Object.assign(app.served, { long, status });
      expect(await app.withoutMemory()).toMatchObject({
        said: [`warn: GET http://localhost:PORT/${path} - ${status}`],
        exitCode: 0,
      });
    });
  });

  it.skipIf(!isASAN)("is installed if the next attempt finds that the cache has the manifest", async () => {
    using app = project();
    await app.prepare("install", "--no-save");
    Object.assign(app.served, { long: "manifest", again: 304 });
    expect(await app.withoutMemory(["install", "--force"])).toEqual({ said: [], exitCode: 0, saved: "something" });
  });

  it.skipIf(!isASAN).each(["hoisted", "isolated"])(
    "is left out if the next attempt gets what is not a tarball, %s",
    async linker => {
      using app = project({}, "^1.0.0", linker);
      Object.assign(app.served, { long: "tarball", again: "a page" });
      const { said, exitCode } = await app.withoutMemory();
      expect({ said: said.at(-1), exitCode }).toEqual({ said: "warn: Fail extracting tarball from bar", exitCode: 0 });
    },
  );

  it.skipIf(!isASAN)("is installed if it is bun.lockb that asks for too much", async () => {
    const lockfile = readFileSync(join(import.meta.dir, "fixtures", "invalid-optional-peer.lockb"));
    // The number of packages.
    lockfile.writeUInt32LE(0xffffff, lockfile.indexOf("-v0\n") + 4 + 4 + 32 + 8);
    using app = project({ "bun.lockb": lockfile });
    expect(await app.withoutMemory()).toMatchObject({ exitCode: 0 });
    expect(existsSync(app.path("node_modules", "bar", "package.json"))).toBeTrue();
  });

  describe.skipIf(isWindows)("in another program", () => {
    const withGit = (protocol: string, script: string, command = "clone") => {
      const git = `#!/bin/sh\ncase " $* " in *" ${command} "*) ${script};; esac\nexec ${Bun.which("git")} "$@"\n`;
      const app = project({ "bin/git": git }, `git+${protocol}://bar.invalid/bar`);
      chmodSync(app.path("bin", "git"), 0o755);
      return { ...app, install: () => app.withoutMemory(["install"], { PATH: app.path("bin") }) };
    };
    const byServer = [
      "remote: fatal: Out of memory, malloc failed",
      "fatal: remote error: out of memory",
      "error: pack-objects died of signal 9",
      "error: git-pack-objects died of signal 9",
      "fatal: cannot exec 'pack-objects': Cannot allocate memory",
      "remote: fatal: fetch-pack: invalid index-pack output",
    ];
    const withoutClone = (how: string) =>
      fails(
        "waitpid",
        "warn: git failed with " + how,
        'warn: "git clone" for "bar" failed',
        "warn: InstallFailed cloning repository for bar",
      );

    it.skipIf(!isLinux).each([
      ["clone", withoutClone("signal 9")],
      ["config", fails("waitpid", "warn: git failed with signal 9", "warn: ENOMEM cloning repository for bar")],
    ])("fails the install: git %s, killed", async (command, expected) => {
      using app = withGit("ssh", "kill -9 $$", command);
      expect(await app.install()).toEqual(expected);
    });

    const byGit = [
      ["ssh", "error: index-pack died of signal 9"],
      ["ssh", "error: unpack-objects died of signal 9"],
      ["ssh", "fatal: fetch-pack: invalid index-pack output"],
      ["ssh", "fatal: Out of memory, malloc failed"],
      ["ssh", "fatal: unable to write to remote: Cannot allocate memory"],
      ["ssh", "fatal: mmap failed: Not enough space"],
      ["ssh", "fatal: unable to access 'https://remote:1/pack-objects/': Out of memory"],
      ...byServer.map(message => ["file", message]),
    ].filter(([, message]) => isLinux || /memory|space/.test(message));
    it.each(byGit)("fails the install: git over %s, %s", async (protocol, message) => {
      using app = withGit(protocol, `[ "$LANGUAGE" = C ] && echo "${message}" >&2; exit 128`);
      const { said, ...result } = await app.install();
      expect({ ...result, said: said.filter(line => line !== message) }).toEqual(withoutClone("exit code 128"));
    });

    it.each([
      ...byServer,
      "banner.remote: fatal: Out of memory, malloc failed",
      "remote: 50%\rfatal: Out of memory, malloc failed",
      "usage.c:1 error remote error: out of memory",
    ])("is left out if that is the server: %j", async message => {
      using app = withGit("ssh", `echo "${message}" >&2; exit 128`);
      expect(await app.install()).toMatchObject({ exitCode: 0 });
    });

    it.each([
      ["fatal: early EOF\\n", 0],
      ["error: inflate: data stream error\\n", 0],
      ["BUG: index-pack.c:1: reason\\n", 0],
      ["fetch-pack: unexpected disconnect while reading sideband packet\\n", 0],
      ["remote: 50%%        \\rfatal: early EOF\\n", 0],
      ["remote: 50%%        \\r", isMacOS ? 0 : 1],
      ["DEBUG: connected\\n", isMacOS ? 0 : 1],
    ])("takes into account what is said before index-pack ends: %s", async (before, exitCode) => {
      using app = withGit("ssh", `printf '${before}fatal: fetch-pack: invalid index-pack output\\n' >&2; exit 128`);
      expect(await app.install()).toMatchObject({ exitCode });
    });

    it("is installed if there is for another protocol", async () => {
      using from = await fromGit(["package.json"]);
      using app = withGit("ssh", `case "$*" in *https:*) kill -9 $$;; esac`);
      const result = await app.withoutMemory(["install"], {
        PATH: app.path("bin"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.${pathToFileURL(from.path("repo"))}.insteadOf`,
        GIT_CONFIG_VALUE_0: "ssh://bar.invalid/bar",
      });
      expect(result).toEqual({ said: [], exitCode: 0, saved: "something" });
      expect(existsSync(app.path("node_modules", "bar", "package.json"))).toBeTrue();
    });

    /** `parent` waits for the script of `bar`. */
    async function withScript(script: string, linker: string, group = "optionalDependencies") {
      const peer = { peerDependencies: { bar: "*" }, peerDependenciesMeta: { bar: { optional: true } } };
      const files = {
        "package.json": root({
          devDependencies: { parent: "file:./parent.tgz" },
          [group]: { bar: "file:./bar.tgz" },
          trustedDependencies: ["bar"],
        }),
        "bar.tgz": await shortTarball({ scripts: { postinstall: `[ -n "$AGAIN" ] || ${script}` } }),
        "parent.tgz": await tarball({ "package/package.json": manifestOf("parent", peer) }, 1),
      };
      return project(files, undefined, linker);
    }

    it.skipIf(!isLinux).each([
      ["hoisted", "sh -c 'kill -9 $$' || exit $?", "exited with 137"],
      ["isolated", "sh -c 'kill -9 $$' || exit $?", "exited with 137"],
      ["isolated", "kill -9 $$", "terminated by SIGKILL (Forced quit)"],
    ])("fails the install: a script, %s, %s", async (linker, script, how) => {
      using app = await withScript(script, linker);
      expect(await app.withoutMemory(["install"], {})).toEqual({
        said: ['error: postinstall script from "bar" ' + how],
        exitCode: 137,
        saved: "nothing",
      });
      expect(await app.run(["install"], { AGAIN: "1" })).toEqual({ said: [], exitCode: 0 });
      expect(existsSync(app.path("node_modules") + "/parent/../.bin/bar")).toBeTrue();
    });

    it("leaves the others in place if a script has another reason", async () => {
      using app = await withScript("exit 3", "isolated", "dependencies");
      expect(await app.withoutMemory(["install"], {})).toMatchObject({ exitCode: 3 });
      expect(existsSync(app.path("node_modules", "parent", "package.json"))).toBeTrue();
    });
  });

  function launcher() {
    const dir = tempDir("fail-syscall", {});
    afterAll(() => dir[Symbol.dispose]());
    const path = join(String(dir), "fail-syscall");
    const source = join(import.meta.dir, "fail-syscall-fixture.c");
    const { exitCode, stderr } = Bun.spawnSync({ cmd: ["cc", "-o", path, source], env });
    if (exitCode !== 0) {
      if (/linux\/\w+\.h|SECCOMP_/.test(stderr.toString())) return;
      throw new Error(stderr.toString());
    }
    const args = [String(constants.errno.ENOMEM), "open", import.meta.path, "0", "cat", import.meta.path];
    if (Bun.spawnSync({ cmd: [path, ...args], env }).exitCode === 1) return path;
  }
  const failSyscall = isLinux && Bun.which("cc") ? launcher() : undefined;

  type App = ReturnType<typeof project> & {
    args?: string[];
    env?: Record<string, string>;
    /** What is there after the failure, and what is not. */
    keeps?: string[];
    lacks?: string[];
    /** What is there once the command has run again. */
    next?: string[];
  };
  const withoutCall = (app: App, failure: string) => {
    const [errno, call, pattern, spared = "0"] = failure.split(" ");
    return app.withoutMemory(app.args ?? ["install"], app.env ?? {}, [
      failSyscall!,
      String(constants.errno[errno]),
      call,
      pattern.replace("ROOT", app.path()),
      spared,
    ]);
  };
  async function after<T extends App>(app: T, args: string[], ...removed: string[]) {
    await app.prepare(...args);
    for (const path of removed) rmSync(app.path(path), { recursive: true });
    return app;
  }
  const offline = async (app: App) => ({
    ...(await after(app, ["install", "--no-save"], "node_modules")),
    args: ["install", "--offline"],
  });
  const member = (at: string) => ({
    [at + "/package.json"]: manifestOf("a", { optionalDependencies: { bar: "^1.0.0" } }),
  });
  const patch = "diff --git a/b b/b\nnew file mode 100644\n--- /dev/null\n+++ b/b\n@@ -0,0 +1 @@\n+b\n";
  const withPatchFor = (...names: string[]) =>
    project({
      "package.json": root({
        optionalDependencies: Object.fromEntries(names.map(name => [name, "1.0.0"])),
        patchedDependencies: Object.fromEntries(names.map(name => [name + "@1.0.0", "a\\b"])),
      }),
      "a\\b": patch,
    });
  /** The lockfile has `built`, which has a script, `patched`, which has a patch, and `bar`. */
  async function several(linker: string, ...args: string[]) {
    const manifest = manifestOf("built", { dependencies: { bar: "1.0.0", patched: "1.0.0" } });
    const files = {
      "package.json": root({
        dependencies: { built: "file:./built.tgz", patched: "1.0.0" },
        optionalDependencies: { bar: "1.0.0" },
        trustedDependencies: ["built"],
        patchedDependencies: { "patched@1.0.0": "patch" },
      }),
      "built.tgz": await tarball({ "package/package.json": manifest, "package/binding.gyp": "{}" }, 1),
      patch,
    };
    return {
      ...(await after(project(files, undefined, linker), ["install", "--lockfile-only"])),
      args: ["install", ...args],
      // `touch rebuild`
      env: { npm_config_node_gyp: "touch", PATH: "/usr/bin:/bin" },
      next: ["node_modules/built/rebuild", "node_modules/patched/b", "node_modules/.bin/bar"],
    };
  }
  async function withoutLinks(...names: string[]) {
    const app = await after(await several("isolated"), ["install", "--ignore-scripts"]);
    const beside = join(realpathSync(app.path("node_modules", "built")), "..");
    for (const removed of [...names, ".bin"]) rmSync(join(beside, removed), { recursive: true });
    writeFileSync(join(beside, "built", "edited"), "");
    const kept = ["built/edited", "bar", "patched"].filter(name => !names.includes(name));
    return {
      ...app,
      keeps: kept.map(name => "node_modules/built/../" + name),
      next: ["node_modules/built/../.bin/bar"],
    };
  }
  async function behindWorkspace(bar: string, ...removed: string[]) {
    const files = {
      "package.json": root({ workspaces: ["a"], optionalDependencies: { bar } }),
      "a/package.json": manifestOf("a", { scripts: { postinstall: "touch built" } }),
      "bar.tgz": await shortTarball(),
    };
    return { ...(await after(project(files), ["install", "--lockfile-only"], ...removed)), next: ["a/built"] };
  }
  /** By a name that is looked for before the first script runs. */
  async function besideLink() {
    const files = {
      "package.json": root({
        dependencies: { bash: "link:./a" },
        optionalDependencies: { bar: "1.0.0" },
        trustedDependencies: ["a", "bash"],
      }),
      "a/package.json": manifestOf("a", { scripts: { preinstall: "exit 0", postinstall: "touch built" } }),
    };
    const app = await after(project(files, undefined, "isolated"), ["install", "--ignore-scripts"], "node_modules");
    return { ...app, next: ["a/built"] };
  }
  const globally = (app: App) => ({ BUN_INSTALL: app.path("global") });
  const bundling = manifestOf("bar", { bundleDependencies: true });
  const from = {
    "a registry": () => project(),
    "a registry that stops": () => {
      const app = project();
      app.served.stops = true;
      return app;
    },
    "a registry that refuses full manifests": () => {
      const app = project({ "package.json": root({ optionalDependencies: { "bar-linux-musl": "1.0.0" } }) });
      app.served.refusesFullManifests = true;
      return app;
    },
    "a registry that refuses full manifests, for `bun outdated`": async () => ({
      ...(await after(from["a registry that refuses full manifests"](), ["install"])),
      args: ["outdated"],
    }),
    "a registry that does not have it": () => {
      const app = project();
      app.served.refuses = 404;
      return app;
    },
    "a registry, for `bun info`": () => ({ ...project(), args: ["info", "bar"] }),
    "a registry, installed": async () => ({
      ...(await after(project(), ["install"])),
      keeps: ["node_modules/bar/cli.js"],
    }),
    "a registry, installed, isolated": async () => ({
      ...(await after(project({}, undefined, "isolated"), ["install"])),
      keeps: ["node_modules/bar/cli.js"],
    }),
    "a registry, into a folder that has to stay": () => ({
      ...project({ "node_modules/bar/mine": "" }),
      keeps: ["node_modules/bar/mine"],
      next: ["node_modules/bar/package.json"],
    }),
    "a registry, installed and copied, isolated": async () => {
      const app = await after(project({}, undefined, "isolated"), ["install"], "node_modules/bar");
      mkdirSync(app.path("node_modules", "bar"));
      for (const name of ["package.json", "edited"]) writeFileSync(app.path("node_modules", "bar", name), "");
      return { ...app, keeps: ["node_modules/bar/edited"] };
    },
    "a registry, for `bun pm scan`": async () => {
      const files = { "package.json": root({ devDependencies: { scanner: "1.0.0" } }) };
      const app = await after(project(files), ["install", "--lockfile-only"]);
      appendFileSync(app.path("bunfig.toml"), `\n[install.security]\nscanner = "scanner"\n`);
      return { ...app, args: ["pm", "scan"] };
    },
    "a registry, for `bun prune`": async () => {
      const files = { "package.json": root({ dependencies: { b: "1.0.0" }, devDependencies: { a: "1.0.0" } }) };
      const app = await after(project(files), ["install"], "node_modules/.bin/bar");
      symlinkSync("../a/cli.js", app.path("node_modules", ".bin", "bar"));
      return { ...app, args: ["prune", "--production"] };
    },
    "files, for `bun remove --global`": async () => {
      const withBin = (name: string) => shortTarball({ name, bin: { bar: "cli.js" } });
      const app = project({ "a.tgz": await withBin("a"), "b.tgz": await withBin("b") });
      await app.run(["add", "--global", "a@" + app.path("a.tgz"), "b@" + app.path("b.tgz")], globally(app));
      return { ...app, args: ["remove", "--global", "a"], env: globally(app) };
    },
    "a registry, into the global store": () => ({
      ...project({}, undefined, "isolated"),
      env: { BUN_INSTALL_GLOBAL_STORE: "1" },
      next: ["node_modules/.bun/bar@1.0.0/node_modules/.bin/bar"],
    }),
    "a registry, over what another linker installed": async () => {
      const app = await after(project({}, undefined, "isolated"), ["install"], "node_modules");
      mkdirSync(app.path("node_modules", "bar"), { recursive: true });
      writeFileSync(app.path("node_modules", "bar", "package.json"), "");
      return { ...app, next: ["node_modules/bar/cli.js"] };
    },
    "a registry, out of the global store": async () => {
      const app = project({}, undefined, "isolated");
      await app.run(["install"], { BUN_INSTALL_GLOBAL_STORE: "1" });
      rmSync(app.path("node_modules", "bar", "lib", "a"));
      return { ...app, keeps: ["node_modules/bar/package.json"], lacks: ["node_modules/bar/lib/a"] };
    },
    "a registry, as a copy, isolated": () => ({
      ...project({}, undefined, "isolated"),
      args: ["install", "--backend=copyfile"],
    }),
    "a registry, with a patch": () => ({ ...withPatchFor("bar"), next: ["node_modules/bar/b"] }),
    "a registry, for `bun pm hash`": async () => {
      const files = { "package.json": root({ workspaces: ["*"] }), ...member("a\\b") };
      return { ...(await after(project(files), ["install", "--lockfile-only"])), args: ["pm", "hash"] };
    },
    "the cache": () => offline(project()),
    "the cache, in place": async () => ({ ...(await offline(project())), next: ["node_modules/bar/lib/a"] }),
    "several": () => several("hoisted"),
    "several, isolated": () => several("isolated"),
    "several, for `bun add`": async () => {
      const app = await several("hoisted");
      return { ...app, args: ["add", "patched@1.0.0"] };
    },
    "several, with --production": () => several("hoisted", "--production"),
    "several, with --production, isolated": () => several("isolated", "--production"),
    "several, without a cache, isolated": async () => {
      const app = await several("isolated");
      rmSync(app.path(".bun-cache"), { recursive: true });
      return app;
    },
    "several, into a store, isolated": async () => {
      const app = await several("isolated");
      mkdirSync(app.path("node_modules", ".bun"), { recursive: true });
      return app;
    },
    "several, without a link, isolated": () => withoutLinks("patched"),
    "several, without an optional link, isolated": () => withoutLinks("bar"),
    "several, without an optional link and what follows, isolated": async () => {
      const app = await withoutLinks("bar");
      rmSync(app.path("node_modules", ".bun", "patched@1.0.0", "node_modules", "patched", "package.json"));
      return { ...app, keeps: [] };
    },
    "pnpm": () =>
      project({
        "package.json": root({}),
        "pnpm-workspace.yaml": "packages: [members/*]\n",
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  members/a: {}\n",
        "members/a/package.json": manifestOf("a"),
      }),
    "a folder, with --force, isolated": async () => ({
      ...(await after(project({ "bar/package.json": manifestOf("bar") }, "file:./bar", "isolated"), ["install"])),
      args: ["install", "--force"],
      keeps: ["node_modules/bar/package.json"],
    }),
    "a folder, into a store, isolated": () => {
      const files = {
        "bar/package.json": manifestOf("bar", { bin: "cli.js" }),
        "bar/cli.js": "",
        "node_modules/.bun/a": "",
      };
      return { ...project(files, "file:./bar", "isolated"), next: ["node_modules/bar/../.bin/bar"] };
    },
    "a folder below the project": () => {
      const app = project({ "below/a": "" });
      return { ...app, args: ["add", "--cwd", app.path("below"), "baz"], next: ["node_modules/baz"] };
    },
    "a workspace that is a link": async () => {
      const app = project({ "package.json": root({ workspaces: ["members/*"] }), "members/b": "", ...member("a") });
      symlinkSync("../a", app.path("members", "a"));
      return { ...(await after(app, ["install", "--lockfile-only"])), args: ["install", "--frozen-lockfile"] };
    },
    "a registry, behind a workspace": () => behindWorkspace("1.0.0", ".bun-cache"),
    "a file, behind a workspace": () => behindWorkspace("file:./bar.tgz", ".bun-cache"),
    "the cache, behind a workspace": () => behindWorkspace("file:./bar.tgz"),
    "a file, below a workspace": async () => {
      const scripts = { postinstall: "touch built" };
      const files = {
        "package.json": root({
          workspaces: ["a"],
          dependencies: { bar: "1.0.0", baz: "1.0.0" },
          trustedDependencies: ["bar"],
        }),
        "a/package.json": manifestOf("a", {
          scripts,
          dependencies: { bar: "file:../bar.tgz" },
          optionalDependencies: { baz: "file:../baz.tgz" },
        }),
        "bar.tgz": await shortTarball({ scripts }),
        "baz.tgz": await tarball({ "package/package.json": manifestOf("baz"), "package/baz": "" }, 1),
      };
      const app = await after(project(files), ["install", "--ignore-scripts"], "node_modules", "a/node_modules");
      const [inCache] = new Bun.Glob("@T@*/baz").scanSync(app.path(".bun-cache"));
      rmSync(app.path(".bun-cache", inCache, ".."), { recursive: true });
      return { ...app, next: ["a/built", "a/node_modules/bar/built"] };
    },
    "a link, behind a workspace": async () => {
      const app = project({
        "package.json": root({ workspaces: ["a"], dependencies: { bar: "link:bar" } }),
        "a/package.json": manifestOf("a", { scripts: { postinstall: "touch built" } }),
        "global/install/global/node_modules/bar/package.json": manifestOf("bar"),
      });
      await app.run(["install", "--lockfile-only"], globally(app));
      return { ...app, env: globally(app), next: ["a/built"] };
    },
    "the cache, beside a link, isolated": besideLink,
    "an address": () => project({}, "http://127.0.0.1:PORT/bar.tgz"),
    "two addresses": () => ({
      ...project({}, "http://localhost:PORT/bar.tgz"),
      env: { BUN_CONFIG_HTTP_RETRY_COUNT: "0" },
    }),
    "a name": () => project({}, "http://bar.invalid/bar.tgz"),
    "a file that is in the cache": async () => {
      const app = await after(await fromFile(), ["install", "--no-save"], "node_modules");
      const entry = readdirSync(app.path(".bun-cache")).find(name => name.startsWith("@T@"));
      return { ...app, keeps: [`.bun-cache/${entry}/package.json`] };
    },
    "a file, with a script that needs a bin whose name is taken": async () => ({
      ...(await fromFile(
        { bin: undefined, scripts: { postinstall: "touch built" }, dependencies: { b: "1.0.0" } },
        {
          "package.json": root({
            dependencies: { a: "1.0.0" },
            optionalDependencies: { bar: "file:./bar.tgz" },
            trustedDependencies: ["bar"],
          }),
        },
      )),
      next: ["node_modules/bar/node_modules/.bin/bar"],
    }),
    "a file, with a script, into a folder that has to stay": async () => ({
      ...(await fromFile({ scripts: { postinstall: "touch built" } }, { "node_modules/bar/mine": "" })),
      keeps: ["node_modules/bar/mine"],
      next: ["node_modules/bar/built"],
    }),
    "a file, for `bun pm trust`": async () => {
      const files = { "bar.tgz": await shortTarball({ scripts: { postinstall: "exit 0" } }) };
      return { ...(await after(project(files, "file:./bar.tgz"), ["install"])), args: ["pm", "trust", "bar"] };
    },
    "git": () => fromGit(["package.json"]),
    "git, isolated": () => fromGit(["package.json"], undefined, "isolated"),
    "git, with what it bundles": async () => ({
      ...(await fromGit(["package.json", "node_modules/a/package.json"], bundling)),
      next: ["node_modules/bar/node_modules/a"],
    }),
    "git, with what it bundles, for `bun prune`": async () => ({
      ...(await after(await fromGit(["package.json", "node_modules/a/package.json"], bundling), ["install"])),
      args: ["prune"],
      keeps: ["node_modules/bar/node_modules/a"],
    }),
  };
  const failures: [from: keyof typeof from, failure: string, call: string, saidBefore?: string[]][] = [
    ["a registry", "ENOMEM getcwd * 2", "getcwd"],
    ["a registry", "ENOMEM socket *", "recv", ["error: ENOMEM downloading package manifest bar"]],
    ["a registry", "ENOBUFS socket *", "recv", ["error: ENOBUFS downloading package manifest bar"]],
    ["a registry", "ENOMEM watch socket:*", "recv", ["error: ENOMEM downloading package manifest bar"]],
    ["a registry", "ENOBUFS recv *", "recv", ["error: ENOBUFS downloading package manifest bar"]],
    ["a registry", "ENOMEM write */lib/a", "pwrite"],
    ["a registry", "ENOMEM stat ROOT/node_modules/bar/cli.js", "stat"],
    ["a registry that stops", "ENOBUFS recv * 2", "recv"],
    ["a registry that refuses full manifests", "ENOBUFS recv * 4", "recv"],
    ["a registry that refuses full manifests, for `bun outdated`", "ENOMEM open *.npm", "open"],
    ["a registry that does not have it", "ENOMEM open *.npm", "open", ["warn: GET http://localhost:PORT/bar - 404"]],
    ["a registry, for `bun info`", "ENOMEM open ROOT/.npmrc", "open"],
    ["a registry, installed", "ENOMEM open bar/package.json", "open"],
    ["a registry, installed, isolated", "ENOMEM stat node_modules/.bun 1", "fstatat"],
    ["a registry, installed, isolated", "ENOMEM access */bar/package.json", "access"],
    ["a registry, installed, isolated", "ENOMEM readlink */.bun/node_modules/bar", "readlink"],
    ["a registry, into a folder that has to stay", "ENOMEM rename bar", "rename"],
    ["a file, with a script, into a folder that has to stay", "ENOMEM rename,stat bar", "rename"],
    ["a registry, installed and copied, isolated", "ENOMEM access ROOT/node_modules/bar/package.json", "access"],
    ["a registry, for `bun pm scan`", "ENOMEM write */lib/a", "pwrite"],
    ["a registry, for `bun prune`", "ENOMEM symlink */.bin/bar", "symlink"],
    ["files, for `bun remove --global`", "ENOMEM symlink */global/bin/bar", "symlink"],
    ["a registry, into the global store", "ENOMEM stat */bar/cli.js", "stat"],
    ["a registry, over what another linker installed", "ENOMEM rename *bar", "rename"],
    ["a registry, out of the global store", "ENOMEM stat */.bun/bar@1.0.0", "lstat"],
    ["a registry, as a copy, isolated", "ENOMEM chmod */cli.js", "fchmod"],
    ["a registry, with a patch", "ENOMEM access ROOT/a?b", "access", []],
    ["a registry, for `bun pm hash`", "ENOMEM access a?b", "access"],
    ["the cache", "ENOMEM access *@@@1/package.json", "access"],
    ["the cache, in place", "ENOMEM mkdir [.l]*", "mkdir"],
    ["several", "ENOMEM socket *", "recv"],
    ["several", "ENOMEM access */built/binding.gyp", "access"],
    ["several", "ENOMEM stat */bar/cli.js", "stat"],
    ["several", "ENOMEM stat *_patch_hash=* 1", "fstatat"],
    ["several", "ENOMEM open b", "open"],
    ["several", "ENOMEM mkdir *.node-gyp", "mkdir"],
    ["several", "ENOMEM open node-gyp", "open"],
    ["several", "ENOMEM write */node-gyp", "write"],
    ["several, for `bun add`", "ENOMEM recv * 1", "recv"],
    ["several, isolated", "ENOMEM socket *", "recv"],
    ["several, isolated", "ENOMEM access */built/binding.gyp", "access"],
    ["several, isolated", "ENOMEM stat */bar/cli.js", "stat"],
    ["several, isolated", "ENOMEM open b", "open"],
    ["several, with --production", "ENOMEM symlink */.bin/bar", "symlink"],
    ["several, with --production, isolated", "ENOMEM symlink */.bin/bar", "symlink"],
    ["several, without a cache, isolated", "ENOMEM symlink built/*", "symlinkat"],
    ["several, into a store, isolated", "ENOMEM stat */.bun/b*[0-9a-f] 1", "lstat"],
    ["several, without a link, isolated", "ENOMEM stat */built@*/cli.js", "stat"],
    ["several, without an optional link, isolated", "ENOMEM stat */built@*/cli.js", "stat"],
    ["several, without an optional link and what follows, isolated", "ENOMEM readlink */built@*/patched", "readlink"],
    ["pnpm", "ENOMEM symlink a", "symlinkat"],
    ["a folder, with --force, isolated", "ENOMEM stat node_modules/.bun 2", "stat"],
    ["a folder, into a store, isolated", "ENOMEM stat */.bun/bar@* 4", "stat"],
    ["a folder below the project", "ENOMEM stat ROOT", "stat"],
    ["a workspace that is a link", "ENOMEM open members/a", "open", []],
    ["a registry, behind a workspace", "ENOMEM open *.hm", "open"],
    ["a file, behind a workspace", "ENOMEM open *.hm", "open"],
    ["the cache, behind a workspace", "ENOMEM open *.hm", "open"],
    ["the cache, behind a workspace", "ENOMEM open *cache", "open"],
    ["the cache, behind a workspace", "ENOMEM open ROOT/node_modules* 1", "open"],
    ["the cache, behind a workspace", "ENOMEM rename [a.]*", "rename"],
    ["a file, below a workspace", "ENOMEM open */baz.tgz", "open"],
    ["a link, behind a workspace", "ENOMEM open */install/global", "open"],
    ["the cache, beside a link, isolated", "ENOMEM open *cache", "open"],
    ["the cache, beside a link, isolated", "ENOMEM stat */bash 1", "access"],
    ["an address", "ENOMEM socket *", "recv", ["error: ENOMEM downloading tarball bar@http://127.0.0.1:PORT/bar.tgz"]],
    [
      "two addresses",
      "ENOMEM socket * 1",
      "recv",
      ["error: ENOMEM downloading tarball bar@http://localhost:PORT/bar.tgz"],
    ],
    [
      "a name",
      "ENOMEM open /etc/resolv.conf",
      "recv",
      ["error: OutOfMemory downloading tarball bar@http://bar.invalid/bar.tgz"],
    ],
    ["a file that is in the cache", "ENOMEM access @T@*/package.json", "access"],
    ["a file, with a script that needs a bin whose name is taken", "ENOMEM stat */b/cli.js 1", "stat"],
    ["a file, for `bun pm trust`", "ENOMEM memfd *", "memfd_create"],
    ["git", "ENOMEM stat */git", "access", ["warn: ENOMEM cloning repository for bar"]],
    ["git", "ENOMEM vfork * 1", "posix_spawn"],
    ["git", "ENOMEM vfork * 2", "posix_spawn", []],
    ["git", "ENOMEM wait *", "waitpid", ["warn: ENOMEM cloning repository for bar"]],
    ["git, isolated", "ENOMEM access @G@*/.bun-tag", "access"],
    ["git, with what it bundles", "ENOMEM open package.json", "open"],
    ["git, with what it bundles, for `bun prune`", "ENOMEM open package.json", "open"],
  ];

  it.skipIf(!failSyscall).each(
    // What `getaddrinfo` makes of it is up to the library.
    failures.filter(([source]) => source !== "a name" || isGlibcVersionAtLeast("2.39")),
  )("from %s fails the install: %s", async (...[source, failure, call, saidBefore]) => {
    using app: App = await from[source]();
    const missing = (paths: string[] = []) => paths.filter(path => !existsSync(app.path() + "/" + path));
    const result = await withoutCall(app, failure);
    expect(result).toEqual(fails(call, ...(saidBefore ?? result.said.slice(0, -1))));
    expect(missing(app.keeps)).toEqual([]);
    expect(missing(app.lacks)).toEqual(app.lacks ?? []);
    if (!app.next) return;
    expect(await app.run(app.args ?? ["install"], app.env)).toEqual({ said: [], exitCode: 0 });
    expect(missing(app.next)).toEqual([]);
  });

  it.skipIf(!failSyscall)("fails the install between two files of a tarball", async () => {
    const tar = await new Bun.Archive({ "package/package.json": manifestOf("bar"), "package/b": "" }).bytes();
    using server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        async data(socket) {
          const head = `HTTP/1.1 200 OK\r\nContent-Length: ${tar.length}\r\n\r\n`;
          socket.write(Buffer.concat([Buffer.from(head), tar.subarray(0, 1024)]));
          const isRead = () => [...new Bun.Glob("*/package.json").scanSync({ cwd: app.path("tmp"), dot: true })].length;
          while (socket.readyState > 0 && !isRead()) await Bun.sleep(1);
          socket.end(tar.subarray(1024));
        },
      },
    });
    using app = project({ "tmp/a": "" }, `http://127.0.0.1:${server.port}/bar.tar`);
    const env = {
      BUN_TMPDIR: app.path("tmp"),
      BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL: "0",
      BUN_INSTALL_STREAMING_MIN_SIZE: "1",
      BUN_INSTALL_STREAMING_DRAIN_THRESHOLD: "1",
      BUN_CONFIG_HTTP_RETRY_COUNT: "0",
    };
    const { said, ...result } = await withoutCall({ ...app, env }, "ENOBUFS recv * 1");
    expect({ ...result, said: said.slice(-1) }).toEqual(fails("recv"));
  });

  it.skipIf(!failSyscall).each([
    ["^1.0.0", 404, 0],
    ["^1.0.0", 503, 1],
    ["http://127.0.0.1:PORT/bar.tgz", 404, 0],
    ["http://127.0.0.1:PORT/bar.tgz", 503, 1],
  ])("to read the first answer for %s, if the next one is %d, exits with %d", async (spec, refuses, exitCode) => {
    using app = project({}, spec);
    app.served.refuses = refuses;
    expect(await withoutCall(app, "ENOBUFS recv * -1")).toMatchObject({ exitCode });
  });

  it.skipIf(!failSyscall)("fails `bun pm migrate`", async () => {
    using app = from.pnpm();
    expect(await withoutCall({ ...app, args: ["pm", "migrate"] }, "ENOMEM open pnpm-workspace.yaml")).toEqual({
      ...fails("open"),
      said: ["error: failed to migrate lockfile: ENOMEM"],
    });
  });

  it.skipIf(!failSyscall)("fails `bun link`", async () => {
    using app = project({ "package.json": root({ bin: "cli.js" }), "cli.js": "" });
    expect(await withoutCall({ ...app, args: ["link"], env: globally(app) }, "ENOMEM stat */cli.js")).toEqual({
      ...fails("stat"),
      said: ["error: failed to link bin due to error ENOMEM"],
    });
  });

  it.skipIf(!failSyscall)("fails `bun patch --commit`, and keeps the patch of another package", async () => {
    using app = await after(
      await after(withPatchFor("bar", "baz"), ["install"]),
      ["patch", "bar"],
      "node_modules/bar/b",
    );
    const args = ["patch", "--commit", "node_modules/bar"];
    expect(await withoutCall({ ...app, args }, "ENOMEM access a?b 2")).toEqual({
      ...fails("access"),
      saved: "something",
    });
    expect(existsSync(app.path("a\\b"))).toBeTrue();
  });

  it.skipIf(!failSyscall).each([
    ["bar", "ENOBUFS socket *"],
    ["bar@http://127.0.0.1:PORT/bar.tgz", "ENOBUFS socket *"],
    ["bar-linux-musl", "ENOMEM open *.npm"],
  ])("tells bunx that the copy that it has is untouched: %s", async (request, failure) => {
    using app = project({ "package.json": "{}" });
    app.served.refusesFullManifests = true;
    const env = { BUN_INTERNAL_BUNX_INSTALL: app.path(), BUN_INTERNAL_BUNX_HAS_COPY: "true" };
    expect(await withoutCall({ ...app, args: ["add", request], env }, failure)).toMatchObject({ exitCode: 75 });
  });

  it.skipIf(!failSyscall).each([{}, { postinstall: "exit 0" }])(
    "fails the install after the lockfile is saved, with the scripts %j",
    async scripts => {
      using app = await after(project({ "package.json": root({ scripts }) }), ["add", "bar", "baz"]);
      expect(await withoutCall({ ...app, args: ["remove", "baz"] }, "ENOMEM open .bin")).toEqual({
        ...fails("open"),
        saved: "something",
      });
    },
  );

  describe.skipIf(!failSyscall)("in a script", () => {
    const script = (first = "") => ({
      ...project({
        "index.js": `${first}; try { require("bar/cli.js") } catch { console.error("error: caught") }`,
      }),
      args: ["--install=force", "index.js"],
    });
    const goesOn = (...said: string[]) => ({ said, exitCode: 0, saved: "nothing" });

    it("keeps it from starting without its configuration", async () => {
      using app = script();
      expect(await withoutCall(app, "ENOMEM open ROOT/bunfig.toml")).toMatchObject({ exitCode: 1 });
    });

    it.each(["open ROOT/.npmrc", "open ROOT/bunfig.toml 1", "open bun.lock", "socket *"])(
      "can be caught: %s",
      async failure => {
        using app = await after(script(), ["install", "--lockfile-only"]);
        expect(await withoutCall(app, "ENOMEM " + failure)).toEqual(goesOn("error: caught"));
      },
    );

    it("is installed if there is at the next import", async () => {
      const importer = `require("bar/cli.js")`;
      const files = {
        "index.js": `try { require("./a") } catch { console.error("error: caught") } require("./b")`,
        "a/index.js": importer,
        "b/index.js": importer,
      };
      using app = { ...project(files), args: ["--install=force", "index.js"] };
      expect(await withoutCall(app, "ENOMEM open ROOT/a/.npmrc")).toEqual(goesOn("error: caught"));
    });

    it("is installed if there is for another working directory", async () => {
      using app = script(`process.chdir("bin"); try { require("bar/cli.js") } catch {} process.chdir("..")`);
      mkdirSync(app.path("bin"));
      expect(await withoutCall(app, "ENOMEM open ROOT/bin*")).toEqual(goesOn());
    });

    it("is installed after an error of the script's own", async () => {
      using app = script(`try { require("fs").readFileSync("a") } catch {}`);
      expect(await withoutCall(app, "ENOMEM open a")).toEqual(goesOn());
    });

    it("is installed during errors of another thread", async () => {
      const worker = `for (let i = 0; ; i++) try { require("fs").readFileSync("a") } catch { i || postMessage("") }`;
      const first = `
        const worker = new Worker("data:text/javascript," + ${JSON.stringify(worker)});
        await new Promise(resolve => (worker.onmessage = resolve));
        setImmediate(() => process.exit());
      `;
      using app = await after(script(first), ["install", "--lockfile-only"]);
      expect(await withoutCall(app, "ENOMEM open a")).toEqual(goesOn());
    });

    it("leaves what is in the cache alone", async () => {
      using app = await after(script(), ["install", "--no-save"], "node_modules");
      const entry = readdirSync(app.path(".bun-cache")).find(name => name.startsWith("bar@"))!;
      writeFileSync(app.path(".bun-cache", entry, "kept"), "");
      expect(await withoutCall(app, "ENOMEM access *package.json")).toMatchObject({ exitCode: 0 });
      expect(existsSync(app.path(".bun-cache", entry, "kept"))).toBeTrue();
    });

    it("is installed if the cache can be done without", async () => {
      using app = script();
      expect(await withoutCall(app, "ENOMEM open *.npm")).toEqual(goesOn());
    });
  });
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

// A dependency on a git repository, a GitHub repository or a tarball has no manifest. `bun update` reads its source
// again, and so does `bun install --force` for a tarball. An optional one keeps the package that bun.lock has for it
// until the source gives another, so a source that cannot be read leaves that package in bun.lock.
describe.concurrent("a locked optional dependency whose source cannot be read again", () => {
  const kinds = ["tarball URL", "GitHub", "git", "file: tarball"] as const;
  type Kind = (typeof kinds)[number];
  // A package that is not in the project cannot name a path in it.
  const fetched = ["tarball URL", "GitHub", "git"] as const;
  const tarballs = ["tarball URL", "file: tarball"] as const;
  const names: Record<Kind, string> = {
    "tarball URL": "url-dep",
    "GitHub": "github-dep",
    "git": "git-dep",
    "file: tarball": "file-dep",
  };
  const gitEnv = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const tarball = (root: string, manifest: object) =>
    new Bun.Archive(
      { [`${root}/`]: "", [`${root}/package.json`]: JSON.stringify(manifest) },
      { compress: "gzip" },
    ).bytes();
  async function git(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: ["git", ...args],
      cwd,
      env: { ...env, ...gitEnv },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [out, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(exitCode).toBe(0);
    return out.trim();
  }

  type Options = {
    /** Who declares the dependency: the root, the workspace `packages/member`, or the GitHub package `parent`. */
    in?: "root" | "member" | "package";
    group?: "optionalDependencies" | "dependencies";
    linker?: "hoisted" | "isolated";
    /** The key of the entry, if it is not the name of the package. */
    key?: string;
    /** The root has the entry too. */
    alsoInRoot?: boolean;
    /** More fields for the package.json of the dependency. */
    package?: object;
    /** More fields for the package.json of the root and of the workspace. */
    root?: Record<string, object>;
    member?: Record<string, object>;
  };

  async function project(kind: Kind, options: Options = {}) {
    const { in: declaredIn = "root", group = "optionalDependencies", linker = "hoisted" } = options;
    const name = names[kind];
    const key = options.key ?? name;
    const manifest = (version: string, as = name) => ({ name: as, version, ...options.package });
    // The registry: each version of each package, in the order of publication.
    const registry: Record<string, Record<string, { manifest: object; bytes: Uint8Array }>> = {};
    // The packages of the registry whose tarball cannot be downloaded.
    const withoutTarball = new Set<string>();
    async function register(manifest: { name: string; version: string; dependencies?: object }) {
      (registry[manifest.name] ??= {})[manifest.version] = { manifest, bytes: await tarball("package", manifest) };
    }
    await register({ name: "good", version: "1.0.0" });
    let packed = await tarball("package", manifest("1.0.0"));
    // GitHub names the directory in its archive after the commit.
    let archive = await tarball("owner-repo-abc1234", manifest("1.0.0"));
    let parent: Uint8Array | undefined;
    // The answer to a request for the dependency whose path ends with `suffix`.
    let lost: { status: number; suffix: string } | undefined;
    let asked: string[] = [];
    // Set while the manifest of `good` waits for a request for the dependency.
    let held: PromiseWithResolvers<void> | undefined;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { origin, pathname } = new URL(request.url);
        const published = registry[pathname.slice(1)];
        if (published) {
          if (pathname === "/good") await held?.promise;
          const versions = Object.entries(published).map(([version, { manifest }]) => [
            version,
            { ...manifest, dist: { tarball: `${origin}${pathname}-${version}.tgz` } },
          ]);
          return Response.json({
            name: pathname.slice(1),
            "dist-tags": { latest: versions.at(-1)![0] },
            versions: Object.fromEntries(versions),
          });
        }
        const [, tarballOf, version] = /^\/(.+)-(\d+\.\d+\.\d+)\.tgz$/.exec(pathname) ?? [];
        if (withoutTarball.has(tarballOf)) return new Response("refused", { status: 503 });
        if (registry[tarballOf]?.[version]) return new Response(registry[tarballOf][version].bytes);
        if (parent && pathname.startsWith("/repos/owner/parent/tarball/")) return new Response(parent);
        asked.push(pathname);
        held?.resolve();
        if (lost && pathname.endsWith(lost.suffix)) return new Response("refused", { status: lost.status });
        if (pathname.startsWith("/t/")) return new Response(packed);
        if (pathname.startsWith("/repos/owner/repo/tarball/")) return new Response(archive);
        return new Response("unexpected", { status: 404 });
      },
    });
    const origin = server.url.origin;

    const dir = tempDir("optional-unread", {
      "bunfig.toml": Bun.TOML.stringify({
        install: { cache: "./.bun-cache", registry: `${origin}/`, saveTextLockfile: true, linker },
      }),
      "packages/member/package.json": "{}",
    });
    const path = (...parts: string[]) => join(String(dir), ...parts);
    const owner = declaredIn === "member" ? "packages/member" : ".";

    // What the entry asks for, another source of the same kind, and the file or directory that `lose` takes away.
    let spec: string;
    let other: string;
    let source: string | undefined;
    switch (kind) {
      case "tarball URL":
        spec = `${origin}/t/url-dep-1.0.0.tgz`;
        other = `${origin}/t/url-dep-2.0.0.tgz`;
        break;
      case "GitHub":
        spec = "owner/repo#v1";
        other = "owner/repo#v2";
        break;
      case "git":
        source = path("repo");
        mkdirSync(source);
        writeFileSync(join(source, "package.json"), JSON.stringify(manifest("1.0.0")));
        await git(source, "init", "-q");
        await git(source, "add", ".");
        // The machine's config can ask for signed commits.
        await git(source, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "first");
        spec = `git+${pathToFileURL(source)}`;
        other = `${spec}#other`;
        break;
      case "file: tarball":
        source = path(owner, "vendor", "file-dep-1.0.0.tgz");
        mkdirSync(path(owner, "vendor"), { recursive: true });
        writeFileSync(source, packed);
        spec = "file:./vendor/file-dep-1.0.0.tgz";
        other = "file:./vendor/file-dep-2.0.0.tgz";
        break;
    }

    async function declare(entry: string) {
      const root: Record<string, any> = {
        name: "foo",
        workspaces: ["packages/*"],
        ...options.root,
        dependencies: { good: "^1.0.0", ...options.root?.dependencies },
      };
      const member: Record<string, any> = { name: "member", version: "1.0.0", ...options.member };
      if (declaredIn === "package") {
        parent = await tarball("owner-parent-def5678", { name: "parent", version: "1.0.0", [group]: { [key]: entry } });
        root.dependencies.parent = "owner/parent#v1";
      } else {
        const declarer = declaredIn === "member" ? member : root;
        declarer[group] = { ...declarer[group], [key]: entry };
      }
      if (options.alsoInRoot) root[group] = { ...root[group], [key]: entry };
      await writeFile(path("package.json"), JSON.stringify(root, null, 2));
      await writeFile(path("packages/member/package.json"), JSON.stringify(member, null, 2));
    }
    await declare(spec);

    async function runIn(cwd: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: path(cwd),
        env: {
          ...env,
          ...gitEnv,
          BUN_INSTALL_CACHE_DIR: undefined,
          BUN_CONFIG_HTTP_RETRY_COUNT: "0",
          GITHUB_API_URL: origin,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Each line once: bun clones the failing git repository of a workspace once or twice.
      const lines = (prefix: string) => [...new Set(err.split(/\r?\n/).filter(line => line.startsWith(prefix)))];
      return {
        warnings: lines("warn:"),
        errors: lines("error:"),
        /** How often bun said that it kept a package. */
        unchecked: err.split("was not checked for updates").length - 1,
        saved: err.includes("Saved lockfile"),
        out,
        err,
        exitCode,
      };
    }
    const run = (...args: string[]) => runIn(".", ...args);

    /** The packages that bun.lock has under the name of the dependency, as `name@resolution`. */
    async function locked() {
      const { packages } = Bun.JSONC.parse(await file(path("bun.lock")).text()) as {
        packages: Record<string, [string]>;
      };
      return [...new Set(Object.values(packages).map(([id]) => id))].filter(id => id.startsWith(`${name}@`));
    }
    /** The version of `of` that is installed, if any. */
    async function installed(of = key) {
      for (const modules of ["node_modules", "packages/member/node_modules", "node_modules/parent/node_modules"]) {
        if (existsSync(path(modules, of, "package.json"))) {
          return (await file(path(modules, of, "package.json")).json()).version as string;
        }
      }
    }
    /** bun.lock and every package.json. */
    const written = () =>
      Promise.all(["bun.lock", "package.json", "packages/member/package.json"].map(f => file(path(f)).text()));
    /** What a command prints about a source that it could not read. */
    function unread(answer = 503, ref = "v1") {
      const lines: Record<Kind, string[]> = {
        "tarball URL": [`warn: GET ${spec} - ${answer}`],
        "GitHub": [`warn: GET ${origin}/repos/owner/repo/tarball/${ref} - ${answer}`],
        "git": [
          "warn: git failed with exit code 128",
          `warn: "git fetch" for "${key}" failed`,
          `warn: InstallFailed cloning repository for ${key}`,
        ],
        "file: tarball": [`warn: ENOENT extracting tarball from ${key}`],
      };
      return lines[kind];
    }
    let id = "";

    return {
      name,
      key,
      origin,
      path,
      /** Publishes a version of a package to the registry. */
      register,
      runIn,
      run,
      declare,
      locked,
      installed,
      written,
      unread,
      /** What the entry asks for. */
      spec,
      /** Another URL, ref or path for the entry. Nothing is there. */
      other,
      /** `name@resolution` of the package that the first install wrote to bun.lock. */
      get id() {
        return id;
      },
      /** Installs, and returns what was written. */
      async install() {
        expect(await run("install")).toMatchObject({ warnings: [], errors: [], exitCode: 0 });
        const ids = await locked();
        expect([ids.length, await installed()]).toEqual([1, "1.0.0"]);
        id = ids[0];
        return written();
      },
      /**
       * From now on the source cannot be read: the server answers `answer` to each request whose path ends with
       * `suffix`, and the repository or the file is gone.
       */
      lose(answer = 503, suffix = "") {
        lost = { status: answer, suffix };
        if (source) renameSync(source, `${source}.gone`);
      },
      restore() {
        lost = undefined;
        if (source) renameSync(`${source}.gone`, source);
      },
      /**
       * The source has version `version` from now on, under the name `as`. A GitHub ref and a git branch point to
       * another commit.
       */
      async publish(version: string, as = name) {
        packed = await tarball("package", manifest(version, as));
        archive = await tarball("owner-repo-def5678", manifest(version, as));
        if (kind === "file: tarball") writeFileSync(source!, packed);
        if (kind === "git") {
          writeFileSync(join(source!, "package.json"), JSON.stringify(manifest(version, as)));
          await git(source!, "-c", "commit.gpgsign=false", "commit", "-q", "-a", "-m", version);
        }
      },
      /** From now on the registry answers 503 for the tarballs of `of`. */
      loseTarballOf(of: string) {
        withoutTarball.add(of);
      },
      /** The manifest of `good` is not sent before the dependency is asked for. */
      holdGood() {
        held = Promise.withResolvers<void>();
      },
      /** What `bun update` prints when it could not read the source, and what it leaves: bun.lock as it is. */
      kept(answer = 503, ref = "v1") {
        const warnings = [...unread(answer, ref), `warn: ${id} was not checked for updates`];
        return { warnings, unchecked: 1, errors: [], saved: false, exitCode: 0 };
      },
      /** What `bun update` prints and leaves when the command line selects the entry: it fails, and writes nothing. */
      failed() {
        return { warnings: unread(), unchecked: 0, errors: [], saved: false, exitCode: 1 };
      },
      /** The requests for the dependency since the last call. */
      asked() {
        const paths = asked;
        asked = [];
        return paths;
      },
      removeInstalled() {
        rmSync(path("node_modules"), { recursive: true, force: true });
        rmSync(path("packages/member/node_modules"), { recursive: true, force: true });
      },
      [Symbol.dispose]() {
        server.stop(true);
        dir[Symbol.dispose]();
      },
    };
  }

  /** The source is back: what bun.lock has is what a frozen install puts in node_modules. */
  async function expectInstallable(p: Awaited<ReturnType<typeof project>>) {
    p.restore();
    p.removeInstalled();
    expect(await p.run("install", "--frozen-lockfile")).toMatchObject({ errors: [], exitCode: 0 });
    expect(await p.installed()).toBe("1.0.0");
  }

  describe.each(["root", "member", "package"] as const)("declared by the %s", declaredIn => {
    const declarable: readonly Kind[] = declaredIn === "package" ? fetched : kinds;

    it.each(declarable)("%s: `bun update` keeps the package", async kind => {
      using p = await project(kind, { in: declaredIn });
      const before = await p.install();
      // With a source that is as it was, there is nothing to write.
      expect(await p.run("update")).toMatchObject({ warnings: [], errors: [], saved: false, exitCode: 0 });
      expect(await p.written()).toEqual(before);

      p.lose();
      expect(await p.run("update")).toMatchObject(p.kept());
      expect(await p.written()).toEqual(before);
      if (declaredIn === "root") {
        for (const flag of ["--latest", "--lockfile-only"]) {
          expect(await p.run("update", flag)).toMatchObject(p.kept());
          expect(await p.written()).toEqual(before);
        }
        // A command that does not save bun.lock does not read a tarball again.
        const unread = kind === "tarball URL" || kind === "file: tarball";
        const frozen = unread ? { ...p.kept(), warnings: [], unchecked: 0 } : p.kept();
        expect(await p.run("update", "--frozen-lockfile")).toMatchObject(frozen);
        expect(await p.written()).toEqual(before);
      }
      if (declaredIn === "member") {
        expect(await p.runIn("packages/member", "update")).toMatchObject(p.kept());
        expect(await p.run("update", "--filter", "member")).toMatchObject(p.kept());
        expect(await p.written()).toEqual(before);
      }

      // Another dependency moves in the same run: bun.lock is written, and the package is still in it.
      await p.register({ name: "good", version: "1.1.0" });
      expect(await p.run("update")).toMatchObject({ ...p.kept(), saved: true });
      expect([await p.locked(), await p.installed("good")]).toEqual([[p.id], "1.1.0"]);
      await expectInstallable(p);
    });

    it.each(declarable)("%s: `bun update` takes what the source has now", async kind => {
      using p = await project(kind, { in: declaredIn });
      const before = await p.install();
      await p.publish("1.1.0");
      // A tarball that has other bytes than bun.lock recorded is a warning.
      expect(await p.run("update")).toMatchObject({ errors: [], saved: true, exitCode: 0 });
      expect(await p.installed()).toBe("1.1.0");
      expect((await p.written())[0]).not.toBe(before[0]);
      expect(await p.locked()).toHaveLength(1);
    });
  });

  it.each(tarballs)("%s: `bun install --force` keeps the package", async kind => {
    using p = await project(kind);
    const before = await p.install();
    p.lose();
    expect(await p.run("install", "--force")).toMatchObject({ ...p.kept(), warnings: p.unread(), unchecked: 0 });
    expect(await p.written()).toEqual(before);
    await expectInstallable(p);
  });

  // The linker asks for the package too, and nothing has it. It must not wait for the read that failed.
  describe.each(["root", "member"] as const)("declared by the %s", declaredIn => {
    it.each(tarballs)("%s: `bun update` with the isolated linker and an empty cache keeps the package", async kind => {
      using p = await project(kind, { in: declaredIn, linker: "isolated" });
      const before = await p.install();
      p.lose();
      p.removeInstalled();
      rmSync(p.path(".bun-cache"), { recursive: true, force: true });
      expect(await p.run("update")).toMatchObject(p.kept());
      expect(await p.written()).toEqual(before);
      expect(await p.installed()).toBeUndefined();
      await expectInstallable(p);
    });
  });

  // The workspace gets its turn after the read of the file has failed for the root.
  it("file: tarball: `bun update` ends when a workspace gets the same entry and the cache is empty", async () => {
    using p = await project("file: tarball", { linker: "isolated" });
    const root = {
      name: "foo",
      workspaces: ["packages/*"],
      devDependencies: { good: "^1.0.0" },
      optionalDependencies: { "file-dep": "file:./vendor/file-dep-1.0.0.tgz" },
    };
    await writeFile(p.path("package.json"), JSON.stringify(root, null, 2));
    await p.install();
    const member = { name: "member", version: "1.0.0", optionalDependencies: root.optionalDependencies };
    await writeFile(p.path("packages/member/package.json"), JSON.stringify(member, null, 2));
    p.lose();
    p.removeInstalled();
    rmSync(p.path(".bun-cache"), { recursive: true, force: true });
    expect(await p.run("update")).toMatchObject({ ...p.kept(), saved: true });
    expect(await p.locked()).toEqual([p.id]);
  });

  // Both entries name `./vendor/file-dep-1.0.0.tgz`, so one read serves both. The workspace gets its turn after the
  // manifest of its new dependency, when that read has failed.
  it("file: tarball: `bun install --force` ends when the root and a workspace have the entry and the cache is empty", async () => {
    const entry = { "file-dep": "file:./vendor/file-dep-1.0.0.tgz" };
    using p = await project("file: tarball", { linker: "isolated", member: { optionalDependencies: entry } });
    mkdirSync(p.path("packages/member/vendor"));
    copyFileSync(p.path("vendor/file-dep-1.0.0.tgz"), p.path("packages/member/vendor/file-dep-1.0.0.tgz"));
    await p.install();
    await p.register({ name: "aaa-new", version: "1.0.0" });
    const member = {
      name: "member",
      version: "1.0.0",
      devDependencies: { "aaa-new": "^1.0.0" },
      optionalDependencies: entry,
    };
    await writeFile(p.path("packages/member/package.json"), JSON.stringify(member, null, 2));
    p.lose();
    rmSync(p.path("packages/member/vendor"), { recursive: true });
    p.removeInstalled();
    rmSync(p.path(".bun-cache"), { recursive: true, force: true });
    expect(await p.run("install", "--force")).toMatchObject({ warnings: p.unread(), errors: [], exitCode: 0 });
    expect(await p.locked()).toEqual([p.id]);
  });

  // The second entry waits for the download of the first one, or finds it done.
  it.each(["member", "package"] as const)(
    "GitHub: `bun update` takes what the source has now for the root and the %s",
    async declaredIn => {
      using p = await project("GitHub", { in: declaredIn, alsoInRoot: true });
      await p.install();
      await p.publish("1.1.0");
      expect(await p.run("update")).toMatchObject({ warnings: [], errors: [], saved: true, exitCode: 0 });
      expect([await p.locked(), await p.installed()]).toEqual([["github-dep@github:owner/repo#def5678"], "1.1.0"]);
    },
  );

  it("GitHub: `bun update` says once that the package of two entries was not checked", async () => {
    using p = await project("GitHub", { in: "member", alsoInRoot: true });
    const before = await p.install();
    p.lose();
    expect(await p.run("update")).toMatchObject(p.kept());
    expect(await p.written()).toEqual(before);
  });

  it.each([
    ["tarball URL", 404],
    ["tarball URL", 500],
    ["GitHub", 404],
    ["GitHub", 500],
  ] as const)("%s: `bun update` keeps the package after a %d", async (kind, status) => {
    using p = await project(kind);
    const before = await p.install();
    p.lose(status);
    expect(await p.run("update")).toMatchObject(p.kept(status));
    expect(await p.written()).toEqual(before);
  });

  // The parent is read again, and so are its dependencies. Only its own name is asked for.
  it.each(fetched)("%s of a package: `bun update <the package>` keeps the package", async kind => {
    using p = await project(kind, { in: "package" });
    const before = await p.install();
    p.lose();
    // bun.lock has the tarball of this URL. A GitHub ref and a git branch are read again.
    const kept = kind === "tarball URL" ? { ...p.kept(), warnings: [], unchecked: 0 } : p.kept();
    expect(await p.run("update", "parent")).toMatchObject(kept);
    expect(await p.written()).toEqual(before);
  });

  // While the dependency has no package, a peer dependency on its name asks the registry for one.
  it("tarball URL: a peer dependency of a workspace on its name asks the registry nothing", async () => {
    using p = await project("tarball URL", { member: { peerDependencies: { "url-dep": "*" } } });
    const before = await p.install();
    p.lose();
    p.asked();
    expect(await p.run("update")).toMatchObject(p.kept());
    expect(p.asked()).toEqual(["/t/url-dep-1.0.0.tgz"]);
    expect(await p.written()).toEqual(before);
  });

  // Its turn comes after the one of `good`, and its download does not wait for that turn.
  it.each(["tarball URL", "GitHub"] as const)("%s: `bun update` asks for it before its turn", async kind => {
    using p = await project(kind, { in: "member", member: { dependencies: { good: "^1.0.0" } } });
    const before = await p.install();
    p.holdGood();
    expect(await p.run("update")).toMatchObject({ warnings: [], errors: [], saved: false, exitCode: 0 });
    expect(await p.written()).toEqual(before);
  });

  // A tarball is not read again by a command that does not save.
  it.each(["GitHub", "git"] as const)("%s: `bun update --no-save` leaves it installed", async kind => {
    using p = await project(kind);
    const before = await p.install();
    p.lose();
    expect(await p.run("update", "--no-save")).toMatchObject(p.kept());
    expect([await p.written(), await p.installed()]).toEqual([before, "1.0.0"]);
  });

  // The cache has the archive of a commit, and only GitHub knows the commit of a ref.
  it("GitHub: `bun update --offline` keeps the package", async () => {
    using p = await project("GitHub");
    const before = await p.install();
    expect(await p.run("update", "--offline")).toMatchObject({ ...p.kept(), warnings: p.kept().warnings.slice(-1) });
    expect(await p.written()).toEqual(before);
  });

  it("GitHub: `bun update --silent` prints nothing", async () => {
    using p = await project("GitHub");
    const before = await p.install();
    p.lose();
    expect(await p.run("update", "--silent")).toMatchObject({ err: "", out: "", exitCode: 0 });
    expect(await p.written()).toEqual(before);
  });

  describe("a command that selects the entry fails, and leaves bun.lock as it is", () => {
    it.each(kinds)("%s: `bun update <name>`", async kind => {
      using p = await project(kind);
      const before = await p.install();
      p.lose();
      expect(await p.run("update", p.name)).toMatchObject(p.failed());
      expect(await p.written()).toEqual(before);
    });

    it.each(["--production", "--depth 0", "*-dep"])("GitHub: `bun update %s`", async selector => {
      using p = await project("GitHub");
      const before = await p.install();
      p.lose();
      expect(await p.run("update", ...selector.split(" "))).toMatchObject(p.failed());
      expect(await p.written()).toEqual(before);
    });
  });

  // The entry is `alias-dep`, and the package that bun.lock has for it is `github-dep`. That name makes `bun update`
  // resolve the entry again, and does not make the command fail for it.
  it("GitHub: `bun update <the name of the package>` keeps the package of an entry with another key", async () => {
    using p = await project("GitHub", { key: "alias-dep" });
    const before = await p.install();
    p.lose();
    expect(await p.run("update", "github-dep")).toMatchObject(p.kept());
    expect(await p.written()).toEqual(before);
  });

  // `github-dep` and `alias-dep` are two refs of one commit, so bun.lock has one package for both. The name selects
  // both entries, and only the ref of `alias-dep` cannot be read.
  it("GitHub: `bun update <name>` does not fail for another entry on the same package", async () => {
    using p = await project("GitHub", {
      key: "alias-dep",
      root: { optionalDependencies: { "github-dep": "owner/repo#v1" } },
    });
    await p.declare("owner/repo#stable");
    const before = await p.install();
    p.lose(503, "/stable");
    expect(await p.run("update", "github-dep")).toMatchObject(p.kept(503, "stable"));
    expect(await p.written()).toEqual(before);
  });

  it.each(kinds)("%s: a required one has no package while it is read again, and fails `bun update`", async kind => {
    using p = await project(kind, { group: "dependencies" });
    const before = await p.install();
    p.lose();
    const errors = [
      ...p.unread().map(line => line.replace("warn:", "error:")),
      `error: ${p.key}@${p.spec} failed to resolve`,
    ];
    expect(await p.run("update")).toMatchObject({ errors, unchecked: 0, saved: false, exitCode: 1 });
    expect(await p.written()).toEqual(before);
  });

  it.each(kinds)("%s: an entry that asks for another source does not keep the package", async kind => {
    using p = await project(kind);
    await p.install();
    await p.declare(p.other);
    p.lose();
    expect(await p.run("update", "--lockfile-only")).toMatchObject({ errors: [], saved: true, exitCode: 0 });
    expect(await p.locked()).toEqual([]);
  });

  // A rule can give the entry another source, so an entry with a rule has no package while it is read again.
  it.each([
    ["its key", "github-dep", "github-dep"],
    ["the name of its package", "alias-dep", "github-dep"],
  ])("GitHub: an entry with an `overrides` rule for %s does not keep the package", async (_, key, rule) => {
    using p = await project("GitHub", { key, root: { overrides: { [rule]: "owner/repo#v1" } } });
    await p.install();
    p.lose();
    expect(await p.run("update")).toMatchObject({ unchecked: 0, errors: [], saved: true, exitCode: 0 });
    expect(await p.locked()).toEqual([]);
  });

  it("GitHub: an entry whose `overrides` rule is only in bun.lock does not keep the package", async () => {
    using p = await project("GitHub", { root: { overrides: { "github-dep": "owner/repo#v1" } } });
    await p.install();
    const { overrides, ...root } = await file(p.path("package.json")).json();
    await writeFile(p.path("package.json"), JSON.stringify(root, null, 2));
    p.lose();
    expect(await p.run("update")).toMatchObject({ unchecked: 0, errors: [], saved: true, exitCode: 0 });
    expect(await p.locked()).toEqual([]);
  });

  // The name in the package.json of a repository is only known when it is read.
  it("GitHub: an `overrides` rule for the name that the source has now replaces the package", async () => {
    using p = await project("GitHub", { root: { overrides: { "renamed-dep": "1.0.0" } } });
    await p.register({ name: "renamed-dep", version: "1.0.0" });
    await p.install();
    await p.publish("1.1.0", "renamed-dep");
    expect(await p.run("update")).toMatchObject({ warnings: [], errors: [], saved: true, exitCode: 0 });
    const { packages } = Bun.JSONC.parse(await file(p.path("bun.lock")).text()) as {
      packages: Record<string, [string]>;
    };
    expect(packages["github-dep"][0]).toBe("renamed-dep@1.0.0");
  });

  // What bun.lock has is what gets installed. A required dependency of the kept package is an error there.
  it("GitHub: with an empty cache, `bun update` fails like `bun install` for a dependency of the kept package", async () => {
    using p = await project("GitHub", { package: { dependencies: { child: "^1.0.0" } } });
    await p.register({ name: "child", version: "1.0.0" });
    const before = await p.install();
    p.lose();
    p.loseTarballOf("child");
    p.removeInstalled();
    rmSync(p.path(".bun-cache"), { recursive: true, force: true });
    for (const command of ["update", "install"]) {
      const errors = [`error: GET ${p.origin}/child-1.0.0.tgz - 503`];
      expect(await p.run(command)).toMatchObject({ errors, saved: false, exitCode: 1 });
      expect(await p.written()).toEqual(before);
    }
  });

  // Up to Bun 1.4.3, bun.lock does not say which entries have no package. Reading one binds such an entry to any
  // package of its name.
  it("GitHub: an entry that an older bun.lock binds to a registry package of its name does not keep that package", async () => {
    using p = await project("GitHub", { root: { dependencies: { parent: "^1.0.0" } } });
    await p.register({ name: "parent", version: "1.0.0", dependencies: { "github-dep": "^1.0.0" } });
    await p.register({ name: "github-dep", version: "1.0.0" });
    const tarballOf = (name: string) => `${p.origin}/${name}-1.0.0.tgz`;
    await writeFile(
      p.path("bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: {
          "": {
            name: "foo",
            dependencies: { good: "^1.0.0", parent: "^1.0.0" },
            optionalDependencies: { "github-dep": "owner/repo#v1" },
          },
          "packages/member": { name: "member", version: "1.0.0" },
        },
        packages: {
          "github-dep": ["github-dep@1.0.0", tarballOf("github-dep"), {}, ""],
          good: ["good@1.0.0", tarballOf("good"), {}, ""],
          member: ["member@workspace:packages/member"],
          parent: ["parent@1.0.0", tarballOf("parent"), { dependencies: { "github-dep": "^1.0.0" } }, ""],
        },
      }),
    );
    const [, ...manifests] = await p.written();
    p.lose();
    expect(await p.run("update", "--latest")).toMatchObject({
      warnings: p.unread(),
      errors: [],
      saved: true,
      exitCode: 0,
    });
    // The entry has no package now, and its specifier is not the range of that package.
    const [lock, ...after] = await p.written();
    expect(after).toEqual(manifests);
    expect(Bun.JSONC.parse(lock)).toMatchObject({ workspaces: { "": { unresolved: ["github-dep"] } } });
  });

  // Only a package.json of the project may name a tarball in the project. Up to Bun 1.4.3 any package could, and
  // its bun.lock has the package.
  it("file: tarball of a GitHub package, which an older bun.lock has, does not keep the package", async () => {
    using p = await project("file: tarball", { in: "package" });
    const entry = { "file-dep": "file:./vendor/file-dep-1.0.0.tgz" };
    await writeFile(
      p.path("bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: {
          "": { name: "foo", dependencies: { good: "^1.0.0", parent: "owner/parent#v1" } },
          "packages/member": { name: "member", version: "1.0.0" },
        },
        packages: {
          "file-dep": ["file-dep@./vendor/file-dep-1.0.0.tgz", {}],
          good: ["good@1.0.0", `${p.origin}/good-1.0.0.tgz`, {}, ""],
          member: ["member@workspace:packages/member"],
          parent: ["parent@github:owner/parent#def5678", { optionalDependencies: entry }, "owner-parent-def5678"],
        },
      }),
    );
    expect(await p.run("update", "parent")).toMatchObject({ warnings: [], errors: [], saved: true, exitCode: 0 });
    expect([await p.locked(), await p.installed()]).toEqual([[], undefined]);
  });

  // The repository was read, and it answered that the branch is gone.
  it("git: a ref that the repository no longer has does not keep the package", async () => {
    using p = await project("git");
    await git(p.path("repo"), "branch", "next");
    await p.declare(`git+${pathToFileURL(p.path("repo"))}#next`);
    await p.install();
    await git(p.path("repo"), "branch", "-D", "next");
    expect(await p.run("update")).toMatchObject({
      warnings: [
        "warn: git failed with exit code 128",
        'warn: no commit matching "next" found for "git-dep" (but repository exists)',
      ],
      errors: [],
      saved: true,
      exitCode: 0,
    });
    expect([await p.locked(), await p.installed()]).toEqual([[], undefined]);
  });
});
