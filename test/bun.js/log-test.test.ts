import { it, expect } from "bun:test";
import { basename, dirname, join } from "path";
import * as fs from "fs";
import { readableStreamToText, spawn } from "bun";

it("should not log .env when quiet", async () => {
  writeDirectoryTree("/tmp/log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": `logLevel = "error"`,
    "index.ts": "export default console.log('Here');",
  });
  const out = spawn({
    cmd: ["bun", "index.ts"],
    stdout: "pipe",
    stderr: "pipe",
    cwd: "/tmp/log-test-silent",
  });

  out.ref();
  await out.exited;
  const text = await readableStreamToText(out.stderr);
  expect(text).toBe("");
});

it("should log .env by default", async () => {
  writeDirectoryTree("/tmp/log-test-silent", {
    ".env": "FOO=bar",
    "bunfig.toml": ``,
    "index.ts": "export default console.log('Here');",
  });

  const out = spawn({
    cmd: ["bun", "index.ts"],
    stdout: "pipe",
    stderr: "pipe",
    cwd: "/tmp/log-test-silent",
  });

  out.ref();
  await out.exited;
  const text = await readableStreamToText(out.stderr);
  expect(text.includes(".env")).toBe(true);
});

function writeDirectoryTree(base, paths) {
  for (const path of Object.keys(paths)) {
    const content = paths[path];
    const joined = join(base, path);

    try {
      fs.unlinkSync(joined);
    } catch (e) {}

    try {
      fs.mkdirSync(join(base, dirname(path)), { recursive: true });
    } catch (e) {}

    fs.writeFileSync(joined, content);
  }
}
