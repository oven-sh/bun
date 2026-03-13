import { beforeAll, it } from "bun:test";
import { exec } from "child_process";
import { rm } from "fs/promises";
import { bunEnv, bunExe, dockerExe, isDockerEnabled, tempDirWithFiles } from "harness";
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
