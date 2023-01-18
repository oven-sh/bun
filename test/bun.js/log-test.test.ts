import { it, expect } from "bun:test";
import { basename, dirname, join } from "path";
import * as fs from "fs";
import { readableStreamToText, spawnSync } from "bun";
import { bunExe } from "bunExe";
import { bunEnv } from "bunEnv";

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

  expect(stderr?.toString().includes(".env")).toBe(true);
});

function writeDirectoryTree(base, paths) {
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
