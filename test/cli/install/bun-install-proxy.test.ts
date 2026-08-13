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
}

describe("registry commands honor http_proxy", () => {
  type ProxiedRequest = { method: string; url: string; otp: string | null };

  // The registry named in bunfig.toml only records the requests that reach it
  // directly; http_proxy points at `proxy`, which answers in the registry's
  // place. A request sent through an HTTP proxy names the full registry URL as
  // its target, which is what `req.url` holds at the proxy.
  function proxiedRegistry(respond: (req: ProxiedRequest, registryUrl: string) => Response) {
    const direct: string[] = [];
    const proxied: ProxiedRequest[] = [];
    const registry = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        direct.push(`${req.method} ${new URL(req.url).pathname}`);
        return new Response(null, { status: 500 });
      },
    });
    const registryUrl = `http://127.0.0.1:${registry.port}/`;
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        await req.arrayBuffer();
        const request = { method: req.method, url: req.url, otp: req.headers.get("npm-otp") };
        proxied.push(request);
        return respond(request, registryUrl);
      },
    });
    return {
      registryUrl,
      direct,
      proxied,
      async run(packageName: string, ...args: string[]) {
        using dir = tempDir(`proxy-${packageName}`, {
          "package.json": JSON.stringify({ name: packageName, version: "1.0.0" }),
          "bunfig.toml": Bun.TOML.stringify({
            install: { cache: false, registry: { url: registryUrl, token: "unused" } },
          }),
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), ...args],
          cwd: String(dir),
          env: {
            ...bunEnv,
            NO_PROXY: undefined,
            no_proxy: undefined,
            HTTPS_PROXY: undefined,
            https_proxy: undefined,
            HTTP_PROXY: undefined,
            http_proxy: `http://127.0.0.1:${proxy.port}`,
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

  it.concurrent("bun pm whoami", async () => {
    using setup = proxiedRegistry(() => Response.json({ username: "user-behind-the-proxy" }));

    const { stdout, stderr, exitCode } = await setup.run("whoami-pkg", "pm", "whoami");
    expect({ proxied: setup.proxied, direct: setup.direct, stdout, stderr, exitCode }).toEqual({
      proxied: [{ method: "GET", url: `${setup.registryUrl}-/whoami`, otp: null }],
      direct: [],
      stdout: "user-behind-the-proxy\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("bun publish", async () => {
    using setup = proxiedRegistry(() => Response.json({ ok: true }));

    const { stdout, stderr, exitCode } = await setup.run("publish-pkg", "publish");
    expect({ proxied: setup.proxied, direct: setup.direct, stderr, exitCode }).toEqual({
      proxied: [{ method: "PUT", url: `${setup.registryUrl}publish-pkg`, otp: null }],
      direct: [],
      stderr: "",
      exitCode: 0,
    });
    expect(stdout).toContain(" + publish-pkg@1.0.0");
  });

  it.concurrent("bun publish --tolerate-republish version lookup", async () => {
    using setup = proxiedRegistry(({ method }) =>
      method === "GET" ? Response.json({ versions: { "1.0.0": {} } }) : new Response(null, { status: 500 }),
    );

    const { stderr, exitCode } = await setup.run("republish-pkg", "publish", "--tolerate-republish");
    expect({ proxied: setup.proxied, direct: setup.direct, stderr, exitCode }).toEqual({
      proxied: [{ method: "GET", url: `${setup.registryUrl}republish-pkg`, otp: null }],
      direct: [],
      stderr: "warn: Registry already knows about version 1.0.0; skipping.\n",
      exitCode: 0,
    });
  });

  it.concurrent("bun publish web login poll and OTP retry", async () => {
    using setup = proxiedRegistry(({ url, otp }, registryUrl) => {
      if (url.endsWith("/-/done")) return Response.json({ token: "otp-from-web-login" });
      if (otp === "otp-from-web-login") return Response.json({ ok: true });
      return Response.json(
        { authUrl: `${registryUrl}-/auth`, doneUrl: `${registryUrl}-/done` },
        { status: 401, headers: { "www-authenticate": "OTP" } },
      );
    });

    const { stdout, stderr, exitCode } = await setup.run("otp-pkg", "publish");
    expect({ proxied: setup.proxied, direct: setup.direct, stderr, exitCode }).toEqual({
      proxied: [
        { method: "PUT", url: `${setup.registryUrl}otp-pkg`, otp: null },
        { method: "GET", url: `${setup.registryUrl}-/done`, otp: null },
        { method: "PUT", url: `${setup.registryUrl}otp-pkg`, otp: "otp-from-web-login" },
      ],
      direct: [],
      stderr: "",
      exitCode: 0,
    });
    expect(stdout).toContain(" + otp-pkg@1.0.0");
  });
});
