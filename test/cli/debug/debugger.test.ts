import * as os from "os";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { expect, it } from "bun:test";

it.each([
  ["", "ws://localhost:6499/random"],
  ["9898", "ws://localhost:9898/random"],
  ["/prefix", "ws://localhost:6499/prefix"],
  ["localhost", "ws://localhost:6499/random"],
  ["localhost:9898", "ws://localhost:9898/random"],
  ["localhost:9898/prefix", "ws://localhost:9898/prefix"],
  ["localhost:9898/", "ws://localhost:9898/random"],
  ["0.0.0.0", "ws://0.0.0.0:6499/random"],
  ["127.0.0.1:9898", "ws://127.0.0.1:9898/random"],
  ["127.0.0.1:9898/prefix", "ws://127.0.0.1:9898/prefix"],
  ["127.0.0.1:9898/", "ws://127.0.0.1:9898/random"],
  ["[::1]", "ws://[::1]:6499/random"],
  ["[::1]:9898", "ws://[::1]:9898/random"],
  ["[::1]:9898/prefix", "ws://[::1]:9898/prefix"],
  ["[::1]:9898/", "ws://[::1]:9898/random"],
])("test inspect=%s", async (url, expected) => {
  const testDir = join(tmpdir(), "bun-debugger-test-" + Math.random().toString(36).slice(2));
  await mkdir(testDir);
  await writeFile(join(testDir, "index.ts"), "setTimeout(() => {}, 200)");

  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", `--inspect=${url}`, "index.ts"],
    cwd: testDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  try {
    expect(exitCode).toBe(0);
    expect(stderr).toBeDefined();
    expect(stdout).toBeDefined();
    expect(stderr.toString("utf-8")).toBe("");

    const line = stdout
      .toString("utf-8")
      .split(os.EOL)
      .map(line => line.trim())
      .find(line => line.startsWith("ws://"));
    expect(line).toBeDefined();
    if (expected.endsWith("random")) {
      const realURL = new URL(line!);
      const expectedURL = new URL(expected);
      expect(realURL.hostname).toStrictEqual(expectedURL.hostname);
      expect(realURL.port).toStrictEqual(expectedURL.port);
      expect(realURL.pathname.length).not.toBe(0);
    } else {
      expect(line).toStrictEqual(expected);
    }
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
});
