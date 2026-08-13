import { beforeAll, describe, expect, it } from "bun:test";
import { exec } from "child_process";
import { rm } from "fs/promises";
import { bunEnv, bunExe, dockerExe, isDockerEnabled, tempDir, tempDirWithFiles } from "harness";
import { join } from "path";
import { promisify } from "util";
const execAsync = promisify(exec);
const dockerCLI = dockerExe() as string;
const SQUID_URL = "http://127.0.0.1:3128";
if (isDockerEnabled()) {
  describe("squid", () => {
    beforeAll(async () => {
      async function isSquidRunning() {
        const text = await fetch(SQUID_URL)
          .then(res => res.text())
          .catch(() => {});
        return text?.includes("squid") ?? false;
      }
      if (!(await isSquidRunning())) {
        // try to create or error if is already created
        await execAsync(
          `${dockerCLI} run -d --name squid-container -e TZ=UTC -p 3128:3128 ubuntu/squid:5.2-22.04_beta`,
        ).catch(() => {});

        async function waitForSquid(max_wait = 60_000) {
          const start = Date.now();
          while (true) {
            if (await isSquidRunning()) {
              return;
            }
            if (Date.now() - start > max_wait) {
              throw new Error("Squid did not start in time");
            }

            await Bun.sleep(1000);
          }
        }
        // wait for squid to start
        await waitForSquid();
      }
    });

    it("bun install with proxy with big packages", async () => {
      const files = {
        "package.json": JSON.stringify({
          "name": "test-install",
          "module": "index.ts",
          "type": "module",
          "private": true,
          "dependencies": {
            "gastby": "1.0.1",
            "mitata": "1.0.34",
            "next.js": "1.0.3",
            "react": "19.1.0",
            "react-dom": "19.1.0",
            "@types/react": "18.3.3",
            "esbuild": "0.21.4",
            "peechy": "0.4.34",
            "prettier": "3.5.3",
            "prettier-plugin-organize-imports": "4.0.0",
            "source-map-js": "1.2.0",
            "typescript": "5.7.2",
          },
        }),
      };
      const promises = new Array(5);
      // this repro a hang when using a proxy, we run multiple times to make sure it's not a flaky test
      for (let i = 0; i < 5; i++) {
        const package_dir = tempDirWithFiles("codex-" + i, files);

        const { exited } = Bun.spawn([bunExe(), "install", "--ignore-scripts"], {
          cwd: package_dir,
          // @ts-ignore
          env: {
            ...bunEnv,
            BUN_INSTALL_CACHE_DIR: join(package_dir, ".bun-install-cache"),
            TMPDIR: join(package_dir, ".tmp"),
            BUN_TMPDIR: join(package_dir, ".tmp"),
            HTTPS_PROXY: SQUID_URL,
            HTTP_PROXY: SQUID_URL,
          },
          stdio: ["inherit", "inherit", "inherit"],
          timeout: 20_000,
        });
        promises[i] = exited
          .then(r => {
            if (r !== 0) {
              throw new Error("failed to install with exit code " + r);
            }
          })
          .finally(() => {
            return rm(package_dir, { recursive: true, force: true });
          });
      }

      await Promise.all(promises);
    }, 60_000);
  });
}

// Each command builds its registry requests separately, and `bun audit`
// (#20295), `bun publish` and `bun pm whoami` have each shipped without the
// proxy, so every command that talks to the registry gets a case here.
describe("registry commands honor http_proxy", () => {
  type RegistryRequest = { via: "proxy" | "registry"; method: string; url: string; otp?: string };

  // The registry from bunfig.toml and the proxy from http_proxy both answer
  // with `respond`, and every request records which of the two received it.
  // A request sent through an HTTP proxy names the full registry URL as its
  // target, so `req.url` is the registry URL at either server.
  function registryBehindProxy(respond: (req: RegistryRequest) => Response) {
    const requests: RegistryRequest[] = [];
    const serve = (via: RegistryRequest["via"]) =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          await req.arrayBuffer();
          const request: RegistryRequest = { via, method: req.method, url: req.url };
          const otp = req.headers.get("npm-otp");
          if (otp !== null) request.otp = otp;
          requests.push(request);
          return respond(request);
        },
      });
    const registry = serve("registry");
    const proxy = serve("proxy");
    const registryUrl = `http://127.0.0.1:${registry.port}/`;
    return {
      registryUrl,
      requests,
      async run(args: string[], opts: { files?: Record<string, string>; env?: Record<string, string> } = {}) {
        using dir = tempDir("registry-behind-proxy", {
          "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
          ...opts.files,
          "bunfig.toml": Bun.TOML.stringify({
            install: { cache: false, registry: { url: registryUrl, token: "unused" } },
          }),
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), ...args],
          cwd: String(dir),
          env: {
            ...bunEnv,
            BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
            NO_PROXY: undefined,
            no_proxy: undefined,
            HTTPS_PROXY: undefined,
            https_proxy: undefined,
            HTTP_PROXY: undefined,
            http_proxy: `http://127.0.0.1:${proxy.port}`,
            ...opts.env,
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      },
      [Symbol.dispose]() {
        registry.stop(true);
        proxy.stop(true);
      },
    };
  }

  const manifest = (name: string) =>
    Response.json({
      name,
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball: `http://127.0.0.1:1/${name}-1.0.0.tgz` } } },
    });

  it.concurrent("bun pm whoami", async () => {
    using setup = registryBehindProxy(() => Response.json({ username: "user-behind-the-proxy" }));

    const { stdout, stderr, exitCode } = await setup.run(["pm", "whoami"]);
    expect({ requests: setup.requests, stdout, stderr, exitCode }).toEqual({
      requests: [{ via: "proxy", method: "GET", url: `${setup.registryUrl}-/whoami` }],
      stdout: "user-behind-the-proxy\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("bun publish", async () => {
    using setup = registryBehindProxy(() => Response.json({ ok: true }));

    const { stdout, stderr, exitCode } = await setup.run(["publish"]);
    expect({ requests: setup.requests, stderr, exitCode }).toEqual({
      requests: [{ via: "proxy", method: "PUT", url: `${setup.registryUrl}app` }],
      stderr: "",
      exitCode: 0,
    });
    expect(stdout).toContain(" + app@1.0.0");
  });

  it.concurrent("bun publish --tolerate-republish version lookup", async () => {
    using setup = registryBehindProxy(({ method }) =>
      method === "GET" ? manifest("app") : new Response(null, { status: 500 }),
    );

    const { stderr, exitCode } = await setup.run(["publish", "--tolerate-republish"]);
    expect({ requests: setup.requests, stderr, exitCode }).toEqual({
      requests: [{ via: "proxy", method: "GET", url: `${setup.registryUrl}app` }],
      stderr: "warn: Registry already knows about version 1.0.0; skipping.\n",
      exitCode: 0,
    });
  });

  it.concurrent("bun publish web login poll and OTP retry", async () => {
    using setup = registryBehindProxy(({ url, otp }) => {
      if (url.endsWith("/-/done")) return Response.json({ token: "otp-from-web-login" });
      if (otp === "otp-from-web-login") return Response.json({ ok: true });
      return Response.json(
        { authUrl: new URL("/-/auth", url).href, doneUrl: new URL("/-/done", url).href },
        { status: 401, headers: { "www-authenticate": "OTP" } },
      );
    });

    const { stdout, stderr, exitCode } = await setup.run(["publish"]);
    expect({ requests: setup.requests, stderr, exitCode }).toEqual({
      requests: [
        { via: "proxy", method: "PUT", url: `${setup.registryUrl}app` },
        { via: "proxy", method: "GET", url: `${setup.registryUrl}-/done` },
        { via: "proxy", method: "PUT", url: `${setup.registryUrl}app`, otp: "otp-from-web-login" },
      ],
      stderr: "",
      exitCode: 0,
    });
    expect(stdout).toContain(" + app@1.0.0");
  });

  it.concurrent("bun publish to a registry listed in no_proxy goes direct", async () => {
    using setup = registryBehindProxy(() => Response.json({ ok: true }));

    const { stdout, stderr, exitCode } = await setup.run(["publish"], { env: { no_proxy: "127.0.0.1" } });
    expect({ requests: setup.requests, stderr, exitCode }).toEqual({
      requests: [{ via: "registry", method: "PUT", url: `${setup.registryUrl}app` }],
      stderr: "",
      exitCode: 0,
    });
    expect(stdout).toContain(" + app@1.0.0");
  });

  it.concurrent("bun info", async () => {
    using setup = registryBehindProxy(() => manifest("some-dep"));

    const { stdout, stderr, exitCode } = await setup.run(["info", "some-dep", "name"]);
    expect({ requests: setup.requests, stdout, stderr, exitCode }).toEqual({
      requests: [{ via: "proxy", method: "GET", url: `${setup.registryUrl}some-dep` }],
      stdout: "some-dep\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("bun audit", async () => {
    using setup = registryBehindProxy(() => Response.json({}));

    const { stdout, stderr, exitCode } = await setup.run(["audit"], {
      files: {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "some-dep": "1.0.0" } }),
        "bun.lock": JSON.stringify({
          lockfileVersion: 1,
          workspaces: { "": { name: "app", dependencies: { "some-dep": "1.0.0" } } },
          packages: { "some-dep": ["some-dep@1.0.0", "", {}, "sha512-AAAA"] },
        }),
      },
    });
    expect({ requests: setup.requests, stdout, stderr, exitCode }).toEqual({
      requests: [{ via: "proxy", method: "POST", url: `${setup.registryUrl}-/npm/v1/security/advisories/bulk` }],
      stdout: "No vulnerabilities found\n",
      stderr: expect.stringMatching(/^bun audit v.*\n$/),
      exitCode: 0,
    });
  });

  it.concurrent("bun install", async () => {
    using setup = registryBehindProxy(() => new Response(null, { status: 404 }));

    const { stderr, exitCode } = await setup.run(["install"], {
      files: {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "some-dep": "1.0.0" } }),
      },
    });
    expect({ requests: setup.requests, stderr, exitCode }).toEqual({
      requests: [{ via: "proxy", method: "GET", url: `${setup.registryUrl}some-dep` }],
      stderr: expect.stringContaining(`error: GET ${setup.registryUrl}some-dep - 404`),
      exitCode: 1,
    });
  });
});
