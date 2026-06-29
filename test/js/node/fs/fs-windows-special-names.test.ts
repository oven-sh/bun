// NTFS allows file names that end in a dot or a space, but the Win32 path
// normalizer (everything reached through CreateFileW and friends) silently
// strips those characters from the final component unless the path carries
// the `\\?\` prefix. Bun's `writeFile` opens through NtCreateFile, which does
// no such normalization, so `writeFile(" a.txt ")` created the literal name
// while `readFile(" a.txt ")`, `stat`, `unlink`, `rename`, and `existsSync`
// looked up the stripped one and failed with ENOENT.
//
// Absolute drive paths were already resolved to `\\?\C:\...` internally;
// these tests pin the same treatment for relative paths (resolved against
// the cwd first), which is what Node does by passing every fs path through
// `path.toNamespacedPath()`.
//
// https://github.com/oven-sh/bun/issues/8836

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Runs the fixture in a child whose cwd is a fresh temp dir (relative paths
// need one) and returns its parsed JSON, or the raw { stdout, stderr,
// exitCode } on any failure so the caller's toEqual shows what went wrong.
async function runInChild(cwd: string, fixture: string): Promise<unknown> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    return { stdout, stderr, exitCode };
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return { stdout, stderr, exitCode };
  }
}

for (const name of [" spaces.txt ", ".dots.txt."]) {
  test.concurrent.skipIf(!isWindows)(`fs round-trips the relative name ${JSON.stringify(name)}`, async () => {
    using dir = tempDir("fs-win-names", {});
    const fixture = `
      const fs = require("node:fs");
      const name = ${JSON.stringify(name)};
      const data = 'data:"' + name + '"';
      fs.writeFileSync(name, data);
      const out = {
        listed: fs.readdirSync(".").includes(name),
        exists: fs.existsSync(name),
        read: fs.readFileSync(name, "utf8"),
        size: fs.statSync(name).size,
        opened: (() => { const fd = fs.openSync(name, "r"); fs.closeSync(fd); return true; })(),
      };
      fs.appendFileSync(name, "+more");
      out.appended = fs.readFileSync(name, "utf8");
      fs.unlinkSync(name);
      out.existsAfterUnlink = fs.existsSync(name);
      out.listedAfterUnlink = fs.readdirSync(".").includes(name);
      process.stdout.write(JSON.stringify(out));
    `;
    expect(await runInChild(String(dir), fixture)).toEqual({
      listed: true,
      exists: true,
      read: `data:"${name}"`,
      size: `data:"${name}"`.length,
      opened: true,
      appended: `data:"${name}"+more`,
      existsAfterUnlink: false,
      listedAfterUnlink: false,
    });
  });
}

test.concurrent.skipIf(!isWindows)("fs.rename and fs.copyFile see the literal relative name", async () => {
  using dir = tempDir("fs-win-names", {});
  const fixture = `
    const fs = require("node:fs");
    fs.writeFileSync(".from.txt.", "payload");
    fs.copyFileSync(".from.txt.", " copy.txt ");
    fs.renameSync(".from.txt.", "renamed.txt");
    process.stdout.write(JSON.stringify({
      copied: fs.readFileSync(" copy.txt ", "utf8"),
      renamed: fs.readFileSync("renamed.txt", "utf8"),
      listing: fs.readdirSync(".").sort(),
    }));
  `;
  expect(await runInChild(String(dir), fixture)).toEqual({
    copied: "payload",
    renamed: "payload",
    listing: [" copy.txt ", "renamed.txt"],
  });
});

test.concurrent.skipIf(!isWindows)("fs.mkdir keeps a trailing dot in relative directory names", async () => {
  using dir = tempDir("fs-win-names", {});
  const fixture = `
    const fs = require("node:fs");
    fs.mkdirSync("single.dir.");
    fs.mkdirSync("rec.a./rec.b.", { recursive: true });
    fs.writeFileSync("single.dir./inner.txt.", "nested");
    process.stdout.write(JSON.stringify({
      top: fs.readdirSync(".").sort(),
      inner: fs.readdirSync("single.dir."),
      innerRead: fs.readFileSync("single.dir./inner.txt.", "utf8"),
      nested: fs.readdirSync("rec.a."),
      statIsDir: fs.statSync("rec.a./rec.b.").isDirectory(),
    }));
  `;
  expect(await runInChild(String(dir), fixture)).toEqual({
    top: ["rec.a.", "single.dir."],
    inner: ["inner.txt."],
    innerRead: "nested",
    nested: ["rec.b."],
    statIsDir: true,
  });
});

test.concurrent.skipIf(!isWindows)("Dirent.parentPath reports the relative path as given", async () => {
  using dir = tempDir("fs-win-names", { "sub/a.txt": "a", "sub/b/c.txt": "c" });
  const fixture = `
    const fs = require("node:fs");
    const flat = fs.readdirSync("sub", { withFileTypes: true }).map(d => d.parentPath).sort();
    const deep = fs.readdirSync("./sub", { withFileTypes: true, recursive: true })
      .map(d => d.parentPath).sort();
    process.stdout.write(JSON.stringify({ flat, deep }));
  `;
  expect(await runInChild(String(dir), fixture)).toEqual({
    flat: ["sub", "sub"],
    // Recursive parentPath is derived by joining the argument with each
    // entry's subdirectory, which normalizes the leading "./".
    deep: ["sub", "sub", "sub\\b"],
  });
});

test.concurrent.skipIf(!isWindows)("alternate data streams and explicit \\\\?\\ paths keep working", async () => {
  // Guards the relative-path rewrite: ADS names contain a colon and must not
  // be mistaken for drive-relative paths, and already-namespaced absolute
  // paths must not be prefixed twice.
  using dir = tempDir("fs-win-names", {});
  const fixture = `
    const fs = require("node:fs");
    const path = require("node:path");
    fs.writeFileSync("ads.txt", "base");
    fs.writeFileSync("ads.txt:meta", "stream");
    const namespaced = "\\\\\\\\?\\\\" + path.resolve("namespaced.txt");
    fs.writeFileSync(namespaced, "via nt namespace");
    process.stdout.write(JSON.stringify({
      base: fs.readFileSync("ads.txt", "utf8"),
      stream: fs.readFileSync("ads.txt:meta", "utf8"),
      streamSize: fs.statSync("ads.txt:meta").size,
      namespaced: fs.readFileSync(namespaced, "utf8"),
      namespacedRelative: fs.readFileSync("namespaced.txt", "utf8"),
      listing: fs.readdirSync(".").sort(),
    }));
  `;
  expect(await runInChild(String(dir), fixture)).toEqual({
    base: "base",
    stream: "stream",
    streamSize: "stream".length,
    namespaced: "via nt namespace",
    namespacedRelative: "via nt namespace",
    listing: ["ads.txt", "namespaced.txt"],
  });
});

test.concurrent.skipIf(!isWindows)("issue 8836 reproduction", async () => {
  // Verbatim shape of the original report: write, read, stat, unlink each
  // name without any of them throwing.
  using dir = tempDir("fs-win-names", {});
  const fixture = `
    const fs = require("node:fs/promises");
    const out = [];
    for (const filename of [" spaces.txt ", ".dots.txt."]) {
      await fs.writeFile(filename, 'data:"' + filename + '"');
      out.push((await fs.readFile(filename)).toString());
      out.push((await fs.stat(filename)).size);
      await fs.unlink(filename);
    }
    process.stdout.write(JSON.stringify(out));
  `;
  expect(await runInChild(String(dir), fixture)).toEqual(['data:" spaces.txt "', 19, 'data:".dots.txt."', 17]);
});
