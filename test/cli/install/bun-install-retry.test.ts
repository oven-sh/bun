import { file, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { access, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDir, tmpdirSync, toBeValidBin, toBeWorkspaceLink, toHaveBins } from "harness";
import * as net from "node:net";
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

// A cross-origin redirect strips Authorization from the request (per the fetch
// spec). The install retry restarts from the original registry URL and must
// carry the original headers, including Authorization, again.
it("retries an authorized manifest whose cross-origin redirect target 500s once", async () => {
  const token = "test-registry-token";
  const registryUrls: string[] = [];
  const cdnAuth: (string | null)[] = [];
  let cdnHits = 0;
  // A second server on its own port stands in for the CDN the registry
  // redirects to; a different port makes the redirect cross-origin.
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
        headers: { Location: `http://localhost:${cdn.port}/cdn/BaR` },
      });
    }
    if (pathname === "/BaR-0.0.2.tgz") {
      return new Response(file(join(import.meta.dir, "bar-0.0.2.tgz")));
    }
    return new Response("unexpected", { status: 404 });
  });
  await writeFile(
    join(package_dir, "bunfig.toml"),
    `[install]\ncache = false\nregistry = { url = "${root_url}/", token = "${token}" }\nsaveTextLockfile = false\n`,
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
  // Both registry hits carried the token (the handler 401s otherwise); the
  // cross-origin CDN hops must NOT have (the spec strips it for that hop).
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
      `[install]\ncache = false\nregistry = "${root_url}/"\nlinker = "${linker}"\n`,
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
      `[install]\ncache = false\nregistry = "${root_url}/"\nlinker = "${linker}"\n`,
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

// A response that promises `Content-Length` bytes but closes the connection
// early must be retried as a failed download instead of feeding the truncated
// body to the extractor ("Fail extracting tarball", #34821) or manifest
// parser. The buffered and streaming extraction paths fail differently, so
// both are covered; `BUN_INSTALL_STREAMING_MIN_SIZE=1` forces streaming.
describe.concurrent("truncated download", () => {
  async function startRegistry(truncate: {
    tarball?: (requestNumber: number) => boolean;
    manifest?: (requestNumber: number) => boolean;
  }) {
    const tgz = Buffer.from(await file(join(import.meta.dir, "bar-0.0.2.tgz")).arrayBuffer());
    let tarballRequests = 0;
    let manifestRequests = 0;
    // Writes a response with the full Content-Length header, but hard-closes
    // the socket halfway through the body when `truncated` is set.
    function respond(socket: net.Socket, contentType: string, body: Buffer, truncated: boolean) {
      socket.write(
        `HTTP/1.1 200 OK\r\nContent-Type: ${contentType}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
      );
      if (truncated) {
        socket.write(body.subarray(0, body.length >> 1), () => socket.destroy());
      } else {
        socket.write(body, () => socket.end());
      }
    }
    const server = net.createServer(socket => {
      let buf = "";
      socket.on("data", data => {
        buf += data.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        const pathname = buf.split(" ")[1];
        buf = "";
        if (pathname === "/bar-0.0.2.tgz") {
          tarballRequests++;
          respond(socket, "application/octet-stream", tgz, truncate.tarball?.(tarballRequests) ?? false);
        } else {
          manifestRequests++;
          const { port } = server.address() as net.AddressInfo;
          const body = Buffer.from(
            JSON.stringify({
              name: "bar",
              versions: {
                "0.0.2": {
                  name: "bar",
                  version: "0.0.2",
                  dist: { tarball: `http://127.0.0.1:${port}/bar-0.0.2.tgz` },
                },
              },
              "dist-tags": { latest: "0.0.2" },
            }),
          );
          respond(socket, "application/json", body, truncate.manifest?.(manifestRequests) ?? false);
        }
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return {
      port: (server.address() as net.AddressInfo).port,
      tarballRequests: () => tarballRequests,
      manifestRequests: () => manifestRequests,
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  async function runInstall(port: number, extraEnv: Record<string, string> = {}) {
    using dir = tempDir("truncated-tarball", {
      "package.json": JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "0.0.2" } }),
      "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${port}/"\n`,
    });
    await using proc = spawn({
      cmd: [bunExe(), "install", "--no-progress"],
      cwd: String(dir),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: { ...env, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"), ...extraEnv },
    });
    const [err, out, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    const barJson = file(join(String(dir), "node_modules", "bar", "package.json"));
    const installedBar = (await barJson.exists()) ? await barJson.json() : null;
    return { err, out, exitCode, installedBar };
  }

  it("retries a truncated tarball once and succeeds (buffered path)", async () => {
    using registry = await startRegistry({ tarball: n => n === 1 });
    const { err, exitCode, installedBar } = await runInstall(registry.port);
    expect(err).not.toContain("error:");
    expect(installedBar).toMatchObject({ name: "bar", version: "0.0.2" });
    expect(registry.tarballRequests()).toBe(2);
    expect(exitCode).toBe(0);
  });

  it("retries a truncated tarball once and succeeds (streaming path)", async () => {
    using registry = await startRegistry({ tarball: n => n === 1 });
    const { err, exitCode, installedBar } = await runInstall(registry.port, {
      BUN_INSTALL_STREAMING_MIN_SIZE: "1",
    });
    expect(err).not.toContain("error:");
    expect(installedBar).toMatchObject({ name: "bar", version: "0.0.2" });
    expect(registry.tarballRequests()).toBe(2);
    expect(exitCode).toBe(0);
  });

  it("fails as a download error once tarball retries are exhausted", async () => {
    using registry = await startRegistry({ tarball: () => true });
    const { err, exitCode, installedBar } = await runInstall(registry.port, {
      BUN_INSTALL_STREAMING_MIN_SIZE: "1",
      BUN_CONFIG_HTTP_RETRY_COUNT: "2",
    });
    expect(err).toContain("downloading tarball");
    expect(err).not.toContain("extracting tarball");
    expect(installedBar).toBeNull();
    expect(registry.tarballRequests()).toBe(3);
    expect(exitCode).not.toBe(0);
  });

  it("retries a truncated manifest once and succeeds", async () => {
    using registry = await startRegistry({ manifest: n => n === 1 });
    const { err, exitCode, installedBar } = await runInstall(registry.port);
    expect(err).not.toContain("error:");
    expect(installedBar).toMatchObject({ name: "bar", version: "0.0.2" });
    expect(registry.manifestRequests()).toBe(2);
    expect(exitCode).toBe(0);
  });
});
