import { beforeAll, it } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isDockerEnabled, tempDirWithFiles } from "harness";
import { join } from "path";
import { ensure } from "../../docker/index.ts";

let SQUID_URL: string;
if (isDockerEnabled()) {
  // The compose `squid` service is the same ubuntu/squid image this file used
  // to `docker run` itself on a fixed host port. Going through ensure() means
  // the shard's coordinator starts it (and waits for the docker daemon if the
  // job began before it was up) and it gets a free port like every other
  // test service.
  beforeAll(async () => {
    const squid = await ensure("squid");
    SQUID_URL = `http://${squid.host}:${squid.ports[3128]}`;
    // The container counts as healthy once the squid process exists. Like the
    // isSquidRunning() loop this replaces, wait until it answers HTTP (a plain
    // GET of the proxy itself gets squid's own error page) before installing
    // through it.
    const squidAnswers = async () => {
      const body = await fetch(SQUID_URL, { signal: AbortSignal.timeout(5_000) }).then(
        res => res.text(),
        () => "",
      );
      return body.includes("squid");
    };
    const deadline = Date.now() + 30_000;
    while (!(await squidAnswers())) {
      if (Date.now() > deadline) throw new Error(`squid at ${SQUID_URL} did not answer within 30s`);
      await Bun.sleep(250);
    }
    // Same hook budget as describeWithContainer(): a cold start is a `compose
    // build` plus `up --wait` with a 180s wait-timeout.
  }, 240_000);

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
