import { beforeAll, expect, it } from "bun:test";
import { exec, execSync } from "child_process";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isLinux, tempDirWithFiles } from "harness";
import { join } from "path";
import { promisify } from "util";
const execAsync = promisify(exec);
const dockerCLI = Bun.which("docker") as string;
const SQUID_URL = "http://127.0.0.1:3128";
function isDockerEnabled(): boolean {
  if (!dockerCLI) {
    return false;
  }

  // TODO: investigate why its not starting on Linux arm64
  if (isLinux && process.arch === "arm64") {
    return false;
  }

  try {
    const info = execSync(`${dockerCLI} info`, { stdio: ["ignore", "pipe", "inherit"] });
    return info.toString().indexOf("Server Version:") !== -1;
  } catch {
    return false;
  }
}
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
    const package_dir = tempDirWithFiles("codex", {
      "package.json": JSON.stringify({
        "name": "test-install",
        "module": "index.ts",
        "type": "module",
        "private": true,
        "devDependencies": {
          "@types/bun": "latest",
        },
        "peerDependencies": {
          "typescript": "^5.8.3",
        },
        "dependencies": {
          "gastby": "^1.0.1",
          "mitata": "^1.0.34",
          "next.js": "^1.0.3",
          "react": "^19.1.0",
          "react-dom": "^19.1.0",
          "@types/react": "^18.3.3",
          "esbuild": "^0.21.4",
          "peechy": "0.4.34",
          "prettier": "^3.5.3",
          "prettier-plugin-organize-imports": "^4.0.0",
          "source-map-js": "^1.2.0",
          "typescript": "^5.7.2",
        },
      }),
    });
    // this repro a hang when using a proxy, we run multiple times to make sure it's not a flaky test
    for (let i = 0; i < 5; i++) {
      // clear cache
      await Bun.$`${bunExe()} pm cache rm`.quiet();
      // clear node_modules if it exists
      await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
      const { promise, resolve, reject } = Promise.withResolvers();
      const timeout = setTimeout(() => {
        reject(new Error("failed to install in time"));
      }, 6_000); // should not take more than 6 seconds per install
      try {
        await Promise.race([
          Bun.$`${bunExe()} i --no-cache --ignore-scripts`
            // @ts-ignore
            .env({
              ...bunEnv,
              HTTPS_PROXY: SQUID_URL,
              HTTP_PROXY: SQUID_URL,
            })
            .cwd(package_dir)
            .quiet(),
          promise,
        ]);
      } finally {
        clearTimeout(timeout);
        resolve();
      }
    }
    expect().pass();
  }, 60_000);
}
