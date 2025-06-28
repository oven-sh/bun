import { spawnSync } from "bun";
import { expect, it } from "bun:test";
import * as fs from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join, resolve } from "path";

it("should not log .env when quiet", async () => {
  writeDirectoryTree("/tmp/log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": `logLevel = "error"`,
    "index.ts": "export default console.log('Here');",
  });
  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: "/tmp/log-test-silent",
    env: bunEnv,
  });

  expect(stderr!.toString()).toBe("");
});

it("should log .env by default", async () => {
  writeDirectoryTree("/tmp/log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": ``,
    "index.ts": "export default console.log('Here');",
  });

  const { stderr } = spawnSync({
    cmd: [bunExe(), "index.ts"],
    cwd: "/tmp/log-test-silent",
    env: bunEnv,
  });

  expect(stderr?.toString().includes(".env")).toBe(false);
});

function writeDirectoryTree(base: string, paths: Record<string, any>) {
  base = resolve(base);
  for (const path of Object.keys(paths)) {
    const content = paths[path];
    const joined = join(base, path);

    try {
      fs.mkdirSync(join(base, dirname(path)), { recursive: true });
    } catch (e) {}

    try {
      fs.unlinkSync(joined);
    } catch (e) {}

    fs.writeFileSync(joined, content);
  }
}
