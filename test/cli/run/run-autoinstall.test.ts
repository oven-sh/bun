import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir, tls, tmpdirSync } from "harness";
import { join } from "path";
import { createAdversarialProxy, proxyFreeEnv } from "../../js/bun/http/proxy-stress-helpers";

//   --install=<val>                 Configure auto-install behavior. One of "auto" (default, auto-installs when no node_modules), "fallback" (missing packages only), "force" (always).
//   -i                              Auto-install dependencies during execution. Equivalent to --install=fallback.

describe("basic autoinstall", () => {
  for (const install of ["", "-i", "--install=auto", "--install=fallback", "--install=force"]) {
    for (const has_node_modules of [true, false]) {
      let should_install = false;
      if (has_node_modules) {
        if (install === "" || install === "--install=auto") {
          should_install = false;
        } else {
          should_install = true;
        }
      } else {
        should_install = true;
      }

      test(`${install || "<no flag>"} ${has_node_modules ? "with" : "without"} node_modules ${should_install ? "should" : "should not"} autoinstall`, async () => {
        const dir = tmpdirSync();
        mkdirSync(dir, { recursive: true });
        await Bun.write(join(dir, "index.js"), "import isEven from 'is-even'; console.log(isEven(2));");
        const env = bunEnv;
        env.BUN_INSTALL = install;
        if (has_node_modules) {
          mkdirSync(join(dir, "node_modules/abc"), { recursive: true });
        }
        const { stdout, stderr } = Bun.spawnSync({
          cmd: [bunExe(), ...(install === "" ? [] : [install]), join(dir, "index.js")],
          cwd: dir,
          env,
          stdout: "pipe",
          stderr: "pipe",
        });

        if (should_install) {
          expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-even'");
          expect(stdout?.toString("utf8")).toBe("true\n");
        } else {
          expect(stderr?.toString("utf8")).toContain("error: Cannot find package 'is-even'");
        }
      });
    }
  }
});

// In auto-install mode the project's own package.json is the lockfile's root
// package (resolution tag `root`, not `npm`). With a name and an exact version
// present, resolving any missing bare specifier used to read that resolution
// through the npm union accessor: "assertion failed: self.tag == Tag::Npm".
test("auto-install in a project whose package.json has a name and version", async () => {
  const requests: string[] = [];
  using registry = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push(new URL(req.url).pathname);
      return new Response("not found", { status: 404 });
    },
  });

  using dir = tempDir("autoinstall-root-name-version", {
    "package.json": JSON.stringify({ name: "myapp", version: "1.0.0" }),
    "index.js": `import "pkg-that-does-not-exist-anywhere";\n`,
    "bunfig.toml": `[install]\nregistry = "http://127.0.0.1:${registry.port}/"\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The resolver must get as far as asking the (local) registry for the
  // missing package, then report it as missing instead of dying while
  // re-parsing the project's own package.json.
  expect(requests).toContain("/pkg-that-does-not-exist-anywhere");
  expect(stderr).toContain("Cannot find package 'pkg-that-does-not-exist-anywhere'");
  expect(exitCode).toBe(1);
});

test("--install=fallback to install missing packages", async () => {
  const dir = tmpdirSync();
  mkdirSync(dir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(dir, "index.js"),
      "import isEven from 'is-even'; import isOdd from 'is-odd'; console.log(isEven(2), isOdd(2));",
    ),
    Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: {
          "is-odd": "1.0.0",
        },
      }),
    ),
  ]);

  Bun.spawnSync({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "--install=fallback", join(dir, "index.js")],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(stderr?.toString("utf8")).not.toContain("error: Cannot find package 'is-odd'");
  expect(stdout?.toString("utf8")).toBe("true false\n");
});

// `[install] ca` / `cafile` in bunfig.toml name the CA of a private registry. The auto-install of a
// script reads them like `bun install` does, and only for its own requests.
describe("[install] ca / cafile", () => {
  const thing = "thing from the private registry";
  const unrelatedCa = readFileSync(join(import.meta.dir, "../../js/node/test/fixtures/keys/ca1-cert.pem"), "utf8");
  const pkg = (async () => {
    const tarball = await new Bun.Archive({
      "package/package.json": JSON.stringify({ name: "@corp/thing", version: "1.0.0", main: "index.js" }),
      "package/index.js": `module.exports = ${JSON.stringify(thing)};\n`,
    }).bytes("gzip");
    return { tarball, integrity: "sha512-" + new Bun.CryptoHasher("sha512").update(tarball).digest("base64") };
  })();
  const manifestPath = "/@corp%2fthing";
  const tarballPath = "/@corp/thing/-/thing-1.0.0.tgz";
  // Past PATH_MAX on Linux and macOS, and a name no file system accepts.
  const tooLong = Buffer.alloc(5000, "a").toString() + ".pem";

  /**
   * A registry that has `@corp/thing@1.0.0`, behind the harness certificate unless `tls` is `undefined`.
   * `requests` is each path it was asked for. `tarballOrigin` puts the tarball on another server.
   */
  async function serveRegistry(options: { tls?: typeof tls; tarballOrigin?: string } = { tls }) {
    const { tarball, integrity } = await pkg;
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: options.tls,
      fetch(req) {
        const { pathname } = new URL(req.url);
        requests.push(pathname);
        if (pathname === manifestPath) {
          const origin = options.tarballOrigin ?? server.url.origin;
          return Response.json({
            name: "@corp/thing",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "@corp/thing",
                version: "1.0.0",
                main: "index.js",
                dist: { tarball: origin + tarballPath, integrity },
              },
            },
          });
        }
        if (pathname === tarballPath) return new Response(tarball);
        return new Response("not found", { status: 404 });
      },
    });
    return { requests, origin: server.url.origin, [Symbol.dispose]: () => void server.stop(true) };
  }

  /**
   * Runs `bun index.js` in a new project that has no `node_modules`. `install` is the `[install]`
   * table of its bunfig.toml, given the project directory.
   */
  async function run(options: {
    install: (root: string) => Record<string, unknown>;
    files?: Record<string, string>;
    env?: Record<string, string>;
  }) {
    using dir = tempDir("autoinstall-ca", {
      "index.js": `import thing from "@corp/thing";\nconsole.log(thing);\n`,
      ...options.files,
      "bunfig.toml": ({ root }: { root: string }) => Bun.TOML.stringify({ install: options.install(root) }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: { ...bunEnv, ...proxyFreeEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"), ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each([
    ["an absolute cafile", (root: string) => ({ cafile: join(root, "registry.pem") })],
    ["a relative cafile", () => ({ cafile: "certs/registry.pem" })],
    ["a ca string", () => ({ ca: tls.cert })],
    ["a ca list", () => ({ ca: [unrelatedCa, tls.cert] })],
    // With both set, `bun install` reads the file only.
    ["a cafile next to a ca", (root: string) => ({ cafile: join(root, "registry.pem"), ca: unrelatedCa })],
  ])("installs with %s", async (_, ca) => {
    using registry = await serveRegistry();
    const { stdout, exitCode } = await run({
      install: root => ({ registry: registry.origin, ...ca(root) }),
      files: { "registry.pem": tls.cert, "certs/registry.pem": tls.cert },
    });
    expect({ stdout, requests: registry.requests }).toEqual({
      stdout: thing + "\n",
      requests: [manifestPath, tarballPath],
    });
    expect(exitCode).toBe(0);
  });

  // fetch() starts the HTTP client first here, and it never gets the install CA.
  test("installs for require() and import() after a fetch(), which still rejects the certificate", async () => {
    using registry = await serveRegistry();
    const { stdout, exitCode } = await run({
      install: () => ({ registry: registry.origin, ca: tls.cert }),
      files: {
        "index.js": `
          const fetched = () => fetch(${JSON.stringify(registry.origin)}).then(res => res.status, err => err.code);
          const before = await fetched();
          const required = require("@corp/thing");
          const imported = (await import("@corp/thing")).default;
          console.log(JSON.stringify({ before, required, imported, after: await fetched() }));
        `,
      },
    });
    expect(JSON.parse(stdout)).toEqual({
      before: "DEPTH_ZERO_SELF_SIGNED_CERT",
      required: thing,
      imported: thing,
      after: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    expect(registry.requests).toEqual([manifestPath, tarballPath]);
    expect(exitCode).toBe(0);
  });

  test("a relative cafile is relative to the directory the process started in", async () => {
    using registry = await serveRegistry();
    const { stdout, exitCode } = await run({
      install: () => ({ registry: registry.origin, cafile: "registry.pem" }),
      files: {
        "registry.pem": tls.cert,
        "elsewhere/registry.pem": unrelatedCa,
        "index.js": `
          process.chdir("elsewhere");
          console.log((await import("@corp/thing")).default);
        `,
      },
    });
    expect({ stdout, requests: registry.requests }).toEqual({
      stdout: thing + "\n",
      requests: [manifestPath, tarballPath],
    });
    expect(exitCode).toBe(0);
  });

  test("installs an https tarball of an http registry", async () => {
    using tarballs = await serveRegistry();
    using registry = await serveRegistry({ tls: undefined, tarballOrigin: tarballs.origin });
    const { stdout, exitCode } = await run({
      install: root => ({ registry: registry.origin, cafile: join(root, "registry.pem") }),
      files: { "registry.pem": tls.cert },
    });
    expect({ stdout, manifest: registry.requests, tarball: tarballs.requests }).toEqual({
      stdout: thing + "\n",
      manifest: [manifestPath],
      tarball: [tarballPath],
    });
    expect(exitCode).toBe(0);
  });

  // The registry's certificate is checked inside the CONNECT tunnel. A later fetch() to the same
  // host must open a tunnel of its own: the one the install left is verified with the install CA.
  test("installs through an HTTPS_PROXY tunnel that fetch() does not reuse", async () => {
    using registry = await serveRegistry();
    await using proxy = await createAdversarialProxy();
    const { stdout, exitCode } = await run({
      install: () => ({ registry: registry.origin, ca: tls.cert }),
      files: {
        "index.js": `
          const imported = (await import("@corp/thing")).default;
          const fetched = await fetch(${JSON.stringify(registry.origin)}).then(res => res.status, err => err.code);
          console.log(JSON.stringify({ imported, fetched }));
        `,
      },
      env: { HTTPS_PROXY: proxy.url },
    });
    expect(JSON.parse(stdout)).toEqual({ imported: thing, fetched: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    expect(registry.requests).toEqual([manifestPath, tarballPath]);
    expect(new Set(proxy.connections.map(c => `${c.method} ${c.target}`))).toEqual(
      new Set([`CONNECT ${new URL(registry.origin).host}`]),
    );
    expect(exitCode).toBe(0);
  });

  // As in `bun install`: the certificates that NODE_EXTRA_CA_CERTS adds to the default ones do not count.
  test("the CA replaces the default trust store", async () => {
    using registry = await serveRegistry();
    const { stdout, stderr, exitCode } = await run({
      install: root => ({ registry: registry.origin, cafile: join(root, "unrelated.pem") }),
      files: { "unrelated.pem": unrelatedCa, "registry.pem": tls.cert },
      env: { NODE_EXTRA_CA_CERTS: "registry.pem", BUN_CONFIG_HTTP_RETRY_COUNT: "0" },
    });
    expect(stderr).toContain("Cannot find module '@corp/thing'");
    expect({ stdout, requests: registry.requests }).toEqual({ stdout: "", requests: [] });
    expect(exitCode).toBe(1);
  });

  // Not a process exit as in `bun install`: the script can catch the failed import.
  test.each([
    [
      "a cafile that does not exist",
      () => ({ cafile: "missing.pem" }),
      (root: string) => `could not find CA file: '${join(root, "missing.pem")}'`,
    ],
    [
      "a cafile path that is too long to open",
      () => ({ cafile: tooLong }),
      (root: string) => `could not find CA file: '${join(root, tooLong)}'`,
    ],
    [
      "a cafile with no certificate",
      () => ({ cafile: "empty.pem" }),
      (root: string) => `invalid CA file: '${join(root, "empty.pem")}'`,
    ],
    ["a ca that is no certificate", () => ({ ca: "not a certificate" }), () => "the CA is invalid"],
  ])("reports %s once", async (_, ca, message) => {
    using registry = await serveRegistry();
    let root = "";
    const { stdout, stderr, exitCode } = await run({
      install: dir => ((root = dir), { registry: registry.origin, ...ca() }),
      files: {
        "empty.pem": "",
        "index.js": `
          const code = name => import(name).then(() => "imported", err => err.code);
          console.log(JSON.stringify([await code("@corp/thing"), await code("@corp/other")]));
        `,
      },
    });
    expect(stderr.split(/\r?\n/).filter(line => line.includes("HTTPThread"))).toEqual([`HTTPThread: ${message(root)}`]);
    expect(JSON.parse(stdout)).toEqual(["ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"]);
    expect(registry.requests).toEqual([]);
    expect(exitCode).toBe(0);
  });

  // The CA is read when a registry request needs it, so a wrong path costs nothing before that.
  test("a cafile that does not exist is not read for an http registry", async () => {
    using registry = await serveRegistry({ tls: undefined });
    const { stdout, stderr, exitCode } = await run({
      install: () => ({ registry: registry.origin, cafile: "missing.pem" }),
    });
    expect(stderr).not.toContain("HTTPThread");
    expect({ stdout, requests: registry.requests }).toEqual({
      stdout: thing + "\n",
      requests: [manifestPath, tarballPath],
    });
    expect(exitCode).toBe(0);
  });
});
