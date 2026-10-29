/**
 * fs.cpSync, fs.cp and fs.promises.cp with `preserveTimestamps: true` give a
 * directory the times of its source, as they do for a file. Node does this
 * since v26.9.0 (nodejs/node#65540), for a directory that the copy creates and
 * for one that exists in the destination:
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/cp/cp.js#L306-L327
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/cp/cp-sync.js#L188-L197
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason, so it manages its own temporary
 * directories. Only mtime is compared: reading a directory moves its atime.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";

const isPosix = process.platform !== "win32";

type Copy = (src: string, dest: string, options: fs.CopyOptions) => Promise<void>;
const copyForms: [string, Copy][] = [
  ["cpSync", async (src, dest, options) => fs.cpSync(src, dest, options as fs.CopySyncOptions)],
  ["promises.cp", (src, dest, options) => fs.promises.cp(src, dest, options)],
  [
    "cp",
    (src, dest, options) => {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      fs.cp(src, dest, options, err => (err ? reject(err) : resolve()));
      return promise;
    },
  ],
];

type Tree = Record<string, string | Record<string, never>>;

async function withTree(tree: Tree, run: (dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), "cp-times-"));
  try {
    for (const [name, content] of Object.entries(tree)) {
      const path = join(dir, name);
      if (typeof content === "string") {
        fs.mkdirSync(dirname(path), { recursive: true });
        fs.writeFileSync(path, content);
      } else {
        fs.mkdirSync(path, { recursive: true });
      }
    }
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const past = new Date("2001-02-03T04:05:06Z");
const older = new Date("1999-09-09T09:09:09Z");
const tree: Tree = { "from/a/b/f.txt": "f", "from/top.txt": "top", "from/empty": {} };
// Children come before their parents: a new entry moves the time of its directory.
const entries = ["a/b/f.txt", "a/b", "a", "top.txt", "empty", ""];

function setTimes(root: string, paths: string[], time: Date) {
  for (const path of paths) fs.utimesSync(join(root, path), time, time);
}
function mtimes(root: string, paths: string[]) {
  return Object.fromEntries(paths.map(path => [path || ".", fs.statSync(join(root, path)).mtime.toISOString()]));
}
function all(paths: string[], time: Date) {
  return Object.fromEntries(paths.map(path => [path || ".", time.toISOString()]));
}

const variants: [string, fs.CopyOptions][] = [
  ["", {}],
  [" and a filter", { filter: () => true }],
  [" and dereference", { dereference: true }],
  [" and force: false", { force: false }],
];

// A directory that everyone may write to and that another user owns: the one above the temporary directory, if it is
// sticky. A copy into it can add an entry, and cannot set its times.
const shared = dirname(fs.realpathSync(os.tmpdir()));
const sharedStat = fs.statSync(shared);
const sharedIsNotOurs = isPosix && sharedStat.uid !== process.getuid!() && (sharedStat.mode & 0o1002) === 0o1002;
// What utimes gives for a directory of another user: EPERM on Linux, EACCES on macOS.
const notTheOwner = process.platform === "darwin" ? "EACCES" : "EPERM";

for (const [name, copy] of copyForms) {
  describe(`fs.${name} with preserveTimestamps`, () => {
    for (const [label, extra] of variants) {
      test(`a new destination has the times of the source directories${label}`, () =>
        withTree(tree, async dir => {
          const from = join(dir, "from");
          setTimes(from, entries, past);

          await copy(from, join(dir, "to"), { recursive: true, preserveTimestamps: true, ...extra });

          assert.deepStrictEqual(mtimes(join(dir, "to"), entries), all(entries, past));
        }));

      test(`an existing destination directory gets the times of its source${label}`, () =>
        withTree({ ...tree, "to/a/kept.txt": "kept", "to/a/b/f.txt": "old", "to/empty": {} }, async dir => {
          const from = join(dir, "from");
          const to = join(dir, "to");
          setTimes(from, entries, past);
          setTimes(to, ["a/kept.txt", "a/b/f.txt", "a/b", "a", "empty", ""], older);
          if (isPosix) fs.chmodSync(join(to, "a"), 0o700);

          await copy(from, to, { recursive: true, preserveTimestamps: true, ...extra });

          assert.deepStrictEqual(mtimes(to, ["", "a", "a/b", "empty", "top.txt", "a/kept.txt", "a/b/f.txt"]), {
            ".": past.toISOString(),
            "a": past.toISOString(),
            "a/b": past.toISOString(),
            "empty": past.toISOString(),
            "top.txt": past.toISOString(),
            // The source has no such entry.
            "a/kept.txt": older.toISOString(),
            // With force: false the copy leaves a file that exists alone.
            "a/b/f.txt": ("force" in extra ? older : past).toISOString(),
          });
          if (isPosix) assert.strictEqual(fs.statSync(join(to, "a")).mode & 0o777, 0o700);
        }));
    }

    test("a directory copied through a link gets the times of the directory, not of the link", () =>
      withTree({ ...tree, "target/g.txt": "g" }, async dir => {
        const from = join(dir, "from");
        setTimes(dir, ["target/g.txt", "target"], past);
        fs.symlinkSync(join(dir, "target"), join(from, "link"), "junction");
        setTimes(from, entries, past);
        assert.notStrictEqual(fs.lstatSync(join(from, "link")).mtime.toISOString(), past.toISOString());

        await copy(from, join(dir, "to"), { recursive: true, preserveTimestamps: true, dereference: true });

        assert.strictEqual(fs.lstatSync(join(dir, "to", "link")).isDirectory(), true);
        assert.deepStrictEqual(mtimes(join(dir, "to"), ["link", "link/g.txt"]), all(["link", "link/g.txt"], past));
      }));

    test("a directory that the filter rejects is left out and its parent has the source's times", () =>
      withTree(tree, async dir => {
        const from = join(dir, "from");
        setTimes(from, entries, past);

        await copy(from, join(dir, "to"), {
          recursive: true,
          preserveTimestamps: true,
          filter: (_src: string, dest: string) => dest !== join(dir, "to", "a"),
        });

        assert.deepStrictEqual(fs.readdirSync(join(dir, "to")).sort(), ["empty", "top.txt"]);
        assert.deepStrictEqual(mtimes(join(dir, "to"), ["", "empty", "top.txt"]), all(["", "empty", "top.txt"], past));
      }));

    test("directories created above the destination keep the time of the copy", () =>
      withTree(tree, async dir => {
        const from = join(dir, "from");
        setTimes(from, entries, past);

        await copy(from, join(dir, "above", "parent", "to"), { recursive: true, preserveTimestamps: true });

        assert.deepStrictEqual(mtimes(join(dir, "above", "parent", "to"), entries), all(entries, past));
        assert.ok(!Object.values(mtimes(dir, ["above", "above/parent"])).includes(past.toISOString()));
      }));

    test("without the option a copied directory has the time of the copy", () =>
      withTree({ ...tree, "existing/a": {} }, async dir => {
        const from = join(dir, "from");
        setTimes(from, entries, past);

        // With no filter, Bun on macOS clones a new destination (clonefile(2)), and a clone keeps every time.
        await copy(from, join(dir, "to"), { recursive: true, filter: () => true });
        await copy(from, join(dir, "existing"), { recursive: true });

        const directories = ["to", "to/a", "to/a/b", "to/empty", "existing", "existing/a", "existing/a/b"];
        assert.ok(!Object.values(mtimes(dir, directories)).includes(past.toISOString()));
      }));

    test(
      "a copy into a directory whose times it cannot set copies the entries, then fails at that directory",
      { skip: !sharedIsNotOurs && `needs a sticky directory of another user above ${os.tmpdir()}` },
      () =>
        withTree({}, async dir => {
          const entry = `cp-times-${process.pid}-${name}.txt`;
          fs.mkdirSync(join(dir, "from"));
          fs.writeFileSync(join(dir, "from", entry), "x");
          try {
            await assert.rejects(copy(join(dir, "from"), shared, { recursive: true, preserveTimestamps: true }), {
              code: notTheOwner,
              syscall: "utime",
              path: shared,
            });
            assert.strictEqual(fs.readFileSync(join(shared, entry), "utf8"), "x");
          } finally {
            fs.rmSync(join(shared, entry), { force: true });
          }
        }),
    );
  });
}

test("fs.cpSync with preserveTimestamps throws the error of a filter that throws", () =>
  withTree(tree, async dir => {
    const from = join(dir, "from");
    setTimes(from, entries, past);

    assert.throws(
      () =>
        fs.cpSync(from, join(dir, "to"), {
          recursive: true,
          preserveTimestamps: true,
          filter: src => {
            if (src === join(from, "top.txt")) throw new RangeError("from the filter");
            return true;
          },
        }),
      { name: "RangeError", message: "from the filter" },
    );
  }));
