// node:fs on filesystems whose readdir reports every entry as DT_UNKNOWN (FUSE,
// some NFS servers, XFS with ftype=0), simulated with the LD_PRELOAD shim from
// `dtUnknownReaddir` (harness). Anything that needs an entry's kind has to
// lstat it: a recursive fs.watch() used to take every entry for a file and
// never watch anything below the root; readdir() resolved the kinds already and
// is covered here because it now shares the implementation with the rest.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunExe, dtUnknownReaddir, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

let shimEnv: NodeJS.Dict<string>;

beforeAll(async () => {
  if (dtUnknownReaddir.available) shimEnv = await dtUnknownReaddir.env();
}, 30_000);

async function runFixture(dir: string): Promise<{ result: unknown; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    cwd: dir,
    env: shimEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let result: unknown = stdout;
  try {
    result = JSON.parse(stdout);
  } catch {}
  return { result, stderr, exitCode };
}

// inotify reports events in the order they happened, so once the event for a
// file written after sub/inner.txt has arrived, inner.txt's event either arrived
// before it or was never going to. The second round guards against the first
// event being delivered on its own.
const WATCH_FIXTURE = /* js */ `
import { watch, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "root");
const seen = new Set();
let waitingFor = null;
const watcher = watch(root, { recursive: true }, (_event, filename) => {
  seen.add(String(filename));
  waitingFor?.();
});
function write(name) {
  const { promise, resolve } = Promise.withResolvers();
  waitingFor = () => seen.has(name) && resolve();
  writeFileSync(join(root, name), "");
  return promise;
}

writeFileSync(join(root, "sub", "inner.txt"), "");
await write("first.txt");
await write("second.txt");
watcher.close();
console.log(JSON.stringify([...seen].sort()));
`;

const READDIR_FIXTURE = /* js */ `
import { readdirSync, promises } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "root");
const kind = d => (d.isDirectory() ? "dir" : d.isSymbolicLink() ? "symlink" : d.isFile() ? "file" : "unknown");
const describe = entries =>
  entries.map(d => relative(root, join(d.parentPath, d.name)) + ":" + kind(d)).sort();
const listings = async readdir => ({
  withFileTypes: describe(await readdir(root, { withFileTypes: true })),
  recursive: (await readdir(root, { recursive: true })).sort(),
  recursiveWithFileTypes: describe(await readdir(root, { recursive: true, withFileTypes: true })),
});
console.log(JSON.stringify({ sync: await listings(readdirSync), async: await listings(promises.readdir) }));
`;

const EXPECTED_LISTINGS = {
  withFileTypes: ["a.txt:file", "link:symlink", "sub:dir"],
  recursive: ["a.txt", "link", "sub", "sub/b.txt"],
  recursiveWithFileTypes: ["a.txt:file", "link:symlink", "sub/b.txt:file", "sub:dir"],
};

describe.skipIf(!dtUnknownReaddir.available)("node:fs on a filesystem whose readdir reports DT_UNKNOWN", () => {
  test.concurrent("recursive fs.watch watches the subdirectories", async () => {
    using dir = tempDir("fs-watch-dt-unknown", {
      "fixture.mjs": WATCH_FIXTURE,
      "root/sub/.keep": "",
    });

    expect(await runFixture(String(dir))).toEqual({
      result: ["first.txt", "second.txt", "sub/inner.txt"],
      stderr: `${dtUnknownReaddir.marker}\n`,
      exitCode: 0,
    });
  });

  test.concurrent("readdir reports the kinds and recurses", async () => {
    using dir = tempDir("fs-readdir-dt-unknown", {
      "fixture.mjs": READDIR_FIXTURE,
      "root/a.txt": "",
      "root/sub/b.txt": "",
    });
    symlinkSync("a.txt", join(String(dir), "root", "link"));

    expect(await runFixture(String(dir))).toEqual({
      result: { sync: EXPECTED_LISTINGS, async: EXPECTED_LISTINGS },
      stderr: `${dtUnknownReaddir.marker}\n`,
      exitCode: 0,
    });
  });
});
