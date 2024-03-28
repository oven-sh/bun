import { isLinux, isDocker, dockerExe } from "harness";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname, extname } from "node:path";
import { spawn } from "bun";
import { describe, test, expect, beforeAll } from "bun:test";

const dockerPath = join(import.meta.dir, "..", "..", "..", "dockerhub");
const randomId = Math.random().toString(36).slice(2, 8);
const baseImage = `bun-test-${randomId}`;
const timeout = 5 * 60 * 1000; // 5 minutes

describe.if(isLinux && isDocker())("Dockerfile", async () => {
  describe.each(["debian", "debian-slim", "alpine"])("%s", tag => {
    beforeAll(async () => {
      await buildBaseImage(tag);
    });

    test(
      "bun --version",
      async () => {
        const { stderr } = await buildCustomImage("bun-version.dockerfile", tag);
        expect(stderr).toContain(Bun.version);
      },
      { timeout },
    );

    test(
      "bun --revision",
      async () => {
        const { stderr } = await buildCustomImage("bun-revision.dockerfile", tag);
        expect(stderr).toContain(Bun.revision.slice(0, 7));
      },
      { timeout },
    );

    test(
      "bun install -g cowsay",
      async () => {
        const { stderr } = await buildCustomImage("bun-install-g-cowsay.dockerfile", tag);
        expect(stderr).toContain("No such file or directory");
      },
      { timeout },
    );

    test(
      "bun uninstall -g cowsay",
      async () => {
        const { stderr } = await buildCustomImage("bun-uninstall-g-cowsay.dockerfile", tag);
        expect(stderr).toContain("PASS");
      },
      { timeout },
    );

    test(
      "bunx cowsay",
      async () => {
        const { stderr } = await buildCustomImage("bunx-cowsay.dockerfile", tag);
        expect(stderr).toContain('"Hello, World!"');
      },
      { timeout },
    );
  });
});

async function buildBaseImage(tag: string): Promise<void> {
  const image = `${baseImage}:${tag}`;
  // Build using the Dockerhub image as the base
  {
    const { exited, stderr } = spawn({
      cwd: join(dockerPath, tag),
      cmd: [dockerExe()!, "build", "--progress=plain", "-t", image, "."],
      stderr: "pipe",
      stdout: "pipe",
    });
    if ((await exited) !== 0) {
      throw new Error(`Failed to build base Docker image: '${image}'`, {
        cause: await Bun.readableStreamToText(stderr),
      });
    }
  }
  // Change the bun binary to use the current bun binary
  {
    const { execPath } = process;
    const tmp = mkdtempSync(join(tmpdir(), "bun-docker-"));
    const dockerfilePath = join(tmp, "Dockerfile");
    writeFileSync(
      dockerfilePath,
      `FROM bun:${tag}
       COPY ${basename(execPath)} /usr/local/bin/bun`,
    );
    const { exited, stderr } = spawn({
      cwd: dirname(execPath),
      cmd: [dockerExe()!, "build", "-f", dockerfilePath, "-t", image, "."],
      stderr: "pipe",
    });
    if ((await exited) !== 0) {
      throw new Error(`Failed to build base Docker image: '${image}'`, {
        cause: await Bun.readableStreamToText(stderr),
      });
    }
  }
}

async function buildCustomImage(
  file: string,
  tag: string,
): Promise<{
  stdout: string;
  stderr: string;
}> {
  const image = `${baseImage}:${basename(file, extname(file))}-${tag}`;
  const dockerfile = readFileSync(join(import.meta.dir, file), "utf8");
  const tmp = mkdtempSync(join(tmpdir(), "bun-docker-"));
  writeFileSync(join(tmp, "Dockerfile"), dockerfile.replace(/FROM oven\/bun/, `FROM ${baseImage}:${tag}`));
  const { exited, stdout, stderr } = spawn({
    cwd: tmp,
    cmd: [dockerExe()!, "build", "--progress=plain", "--no-cache", "-t", image, "."],
    stderr: "pipe",
    stdout: "pipe",
  });
  if ((await exited) !== 0) {
    throw new Error(`Failed to build custom Docker image: '${image}'`, {
      cause: Bun.readableStreamToText(stderr),
    });
  }
  return {
    stdout: await Bun.readableStreamToText(stdout),
    stderr: await Bun.readableStreamToText(stderr),
  };
}
