import { beforeAll, expect, it } from "bun:test";
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

// No squid needed: the proxy below only records what reaches it. `bun install`
// resolves the proxy through the same env lookup as fetch(), which since
// #16182 normalizes the value the way new URL() would, so this padded spelling
// has to reach the proxy instead of being parsed into a bogus host.
it("bun install routes registry requests through a non-normalized http_proxy value", async () => {
  let directRegistryHits = 0;
  using registry = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      directRegistryHits++;
      return new Response(null, { status: 500 });
    },
  });
  const proxyLog: string[] = [];
  using proxy = Bun.listen<{ head: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { head: "" };
      },
      data(socket, chunk) {
        const head = (socket.data.head += new TextDecoder("latin1").decode(chunk));
        if (!head.includes("\r\n\r\n")) return;
        proxyLog.push(head.slice(0, head.indexOf("\r\n")));
        socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      },
    },
  });
  using dir = tempDir("install-env-proxy", {
    "package.json": JSON.stringify({ name: "app", dependencies: { "only-behind-the-proxy": "1.0.0" } }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--registry", `http://127.0.0.1:${registry.port}/`],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
      NO_PROXY: undefined,
      no_proxy: undefined,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
      http_proxy: `  http:\\\\127.0.0.1:${proxy.port}  `,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const manifestUrl = `http://127.0.0.1:${registry.port}/only-behind-the-proxy`;
  expect({ proxyLog, directRegistryHits, stdout, stderr, exitCode }).toEqual({
    proxyLog: [`GET ${manifestUrl} HTTP/1.1`],
    directRegistryHits: 0,
    stdout: expect.stringContaining("bun install v"),
    // The proxy's 404 is what fails the install, not a failure to reach the proxy.
    stderr: expect.stringContaining(`error: GET ${manifestUrl} - 404`),
    exitCode: 1,
  });
});
