/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * fs.cpSync checks the two paths it is given in one native function,
 * CpSyncCheckPaths, before it writes anything:
 * https://github.com/nodejs/node/blob/v26.12.1/src/node_file.cc#L4515-L4652
 * What that function throws is an Error with a `code` and nothing else. The
 * errors that cpSync's walker, fs.cp and fs.promises.cp build in JavaScript
 * are SystemErrors: errno, syscall, path and info.
 */
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const isBun = typeof Bun !== "undefined";
const isRoot = !isWindows && process.getuid!() === 0;
const { EEXIST, EISDIR } = os.constants.errno;

async function inTempDir(run: (dir: string) => unknown) {
  // A short name: the socket's path has to fit in the 104 bytes that macOS gives a socket address.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cpsync-")));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function thrownBy(fn: () => void): any {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail("cpSync did not throw");
}

/** A path in a message of CpSyncCheckPaths: after ToNamespacedPath, which changes it on Windows only. */
const shown = (given: string) => path.toNamespacedPath(given);
/** The same for `src` where the message has one separator after it. */
const shownWithSeparator = (src: string) => (shown(src).endsWith(path.sep) ? shown(src) : shown(src) + path.sep);

/** An error of CpSyncCheckPaths: node's C++ makes an Error and gives it one property, `code`. */
function assertNativeError(err: any, code: string, message: string) {
  const enumerable: string[] = [];
  for (const key in err) enumerable.push(key);
  assert.deepStrictEqual(
    {
      string: String(err),
      prototypeIsErrors: Object.getPrototypeOf(err) === Error.prototype,
      code: err.code,
      keys: Object.keys(err),
      enumerable,
      errno: err.errno,
      syscall: err.syscall,
      path: err.path,
      info: err.info,
    },
    {
      string: `Error: ${message}`,
      prototypeIsErrors: true,
      code,
      keys: ["code"],
      enumerable: ["code"],
      errno: undefined,
      syscall: undefined,
      path: undefined,
      info: undefined,
    },
  );
}

/** An error that JavaScript builds: `new ERR_FS_*({ message, path, syscall, errno, code })` in node. */
function assertSystemError(
  err: any,
  code: string,
  prefix: string,
  errno: number,
  errnoName: string,
  detail: string,
  at: string,
) {
  assert.deepStrictEqual(
    {
      name: err.name,
      code: err.code,
      message: err.message,
      errno: err.errno,
      syscall: err.syscall,
      path: err.path,
      info: err.info,
    },
    {
      name: "SystemError",
      code,
      message: `${prefix}: cp returned ${errnoName} (${detail}) ${at}`,
      errno,
      syscall: "cp",
      path: at,
      info: { message: detail, path: at, syscall: "cp", errno, code: errnoName },
    },
  );
}

/** On Linux: a descriptor of this process that stat gives no file type for, such as the event loop's epoll. */
function fileOfNoKnownType() {
  if (process.platform !== "linux") return undefined;
  for (const fd of fs.readdirSync("/proc/self/fd")) {
    const link = `/proc/self/fd/${fd}`;
    try {
      if (fs.readlinkSync(link).startsWith("anon_inode:") && (fs.statSync(link).mode & fs.constants.S_IFMT) === 0) {
        return link;
      }
    } catch {
      // The descriptor that listed the folder is closed by now.
    }
  }
}

const optionSets: [label: string, options: fs.CopySyncOptions | undefined][] = [
  ["no options", undefined],
  ["filter", { filter: () => true }],
  ["dereference", { dereference: true }],
  ["force: false", { force: false }],
  ["preserveTimestamps", { preserveTimestamps: true }],
];

describe("fs.cpSync checks its two paths in the order of node's CpSyncCheckPaths, with its errors", () => {
  for (const [label, options] of optionSets) {
    test(`a directory without recursive (${label})`, () =>
      inTempDir(dir => {
        const src = path.join(dir, "src");
        const dest = path.join(dir, "new", "sub", "dest");
        fs.mkdirSync(src);
        fs.writeFileSync(path.join(src, "file"), "a");

        assertNativeError(
          thrownBy(() => fs.cpSync(src, dest, options)),
          "ERR_FS_EISDIR",
          `Recursive option not enabled, cannot copy a directory: ${shownWithSeparator(src)}`,
        );
        // Nothing is written before the check: the folders above dest are made by the copy.
        assert.deepStrictEqual(fs.readdirSync(dir), ["src"]);
        fs.cpSync(src, dest, { ...options, recursive: true });
        assert.strictEqual(fs.readFileSync(path.join(dest, "file"), "utf8"), "a");
      }));
  }

  test("a directory without recursive: a relative path, and a path that ends with a separator", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      fs.mkdirSync(src);
      fs.mkdirSync(path.join(dir, "dest"));
      const relative = path.relative(process.cwd(), src);
      for (const given of [src + path.sep, relative]) {
        for (const dest of [path.join(dir, "dest"), path.join(dir, "missing")]) {
          assertNativeError(
            thrownBy(() => fs.cpSync(given, dest)),
            "ERR_FS_EISDIR",
            `Recursive option not enabled, cannot copy a directory: ${shownWithSeparator(given)}`,
          );
        }
      }
    }));

  test("a directory without recursive: fs.cp and fs.promises.cp throw a SystemError", () =>
    inTempDir(async dir => {
      const src = path.join(dir, "src");
      const dest = path.join(dir, "dest");
      fs.mkdirSync(src);
      const { promise, resolve } = Promise.withResolvers<unknown>();
      fs.cp(src, dest, resolve);
      const rejected = fs.promises.cp(src, dest).then(
        () => assert.fail("cp did not reject"),
        err => err,
      );
      for (const err of [await promise, await rejected]) {
        assertSystemError(
          err,
          "ERR_FS_EISDIR",
          "Path is a directory",
          EISDIR,
          "EISDIR",
          `${src} is a directory (not copied)`,
          src,
        );
      }
      assertNativeError(
        thrownBy(() => fs.cpSync(src, dest)),
        "ERR_FS_EISDIR",
        `Recursive option not enabled, cannot copy a directory: ${shownWithSeparator(src)}`,
      );
    }));

  test("src and dest are the same file", () =>
    inTempDir(dir => {
      const file = path.join(dir, "file");
      const link = path.join(dir, "hard-link");
      fs.writeFileSync(file, "a");
      fs.linkSync(file, link);
      for (const dest of [file, link]) {
        for (const options of [undefined, { filter: () => true }]) {
          assertNativeError(
            thrownBy(() => fs.cpSync(file, dest, options)),
            "ERR_FS_CP_EINVAL",
            `src and dest cannot be the same ${shown(dest)}`,
          );
        }
      }
      // The walker builds this one in JavaScript, in node too.
      const other = path.join(dir, "other");
      fs.writeFileSync(other, "b");
      assertSystemError(
        thrownBy(() => fs.cpSync(file, other, { force: false, errorOnExist: true })),
        "ERR_FS_CP_EEXIST",
        "Target already exists",
        EEXIST,
        "EEXIST",
        `${other} already exists`,
        other,
      );
    }));

  test("src and dest are the same directory, with and without recursive", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      fs.mkdirSync(src);
      for (const options of [undefined, { recursive: true }, { recursive: true, filter: () => true }]) {
        assertNativeError(
          thrownBy(() => fs.cpSync(src, src, options)),
          "ERR_FS_CP_EINVAL",
          `src and dest cannot be the same ${shown(src)}`,
        );
      }
    }));

  test("a directory onto a file, with and without recursive", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const dest = path.join(dir, "dest");
      fs.mkdirSync(src);
      fs.writeFileSync(dest, "a");
      for (const options of [undefined, { recursive: true }, { recursive: true, filter: () => true }]) {
        assertNativeError(
          thrownBy(() => fs.cpSync(src, dest, options)),
          "ERR_FS_CP_DIR_TO_NON_DIR",
          `Cannot overwrite non-directory ${shown(dest)} with directory ${shown(src)}`,
        );
      }
      assert.strictEqual(fs.readFileSync(dest, "utf8"), "a");
    }));

  test("a file onto a directory", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const dest = path.join(dir, "dest");
      fs.writeFileSync(src, "a");
      fs.mkdirSync(dest);
      for (const options of [undefined, { recursive: true }, { filter: () => true }]) {
        assertNativeError(
          thrownBy(() => fs.cpSync(src, dest, options)),
          "ERR_FS_CP_NON_DIR_TO_DIR",
          `Cannot overwrite directory ${shown(dest)} with non-directory ${shown(src)}`,
        );
      }
    }));

  test("a file onto a link to a directory, with dereference", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const dest = path.join(dir, "link");
      fs.writeFileSync(src, "a");
      fs.mkdirSync(path.join(dir, "directory"));
      fs.symlinkSync(path.join(dir, "directory"), dest, isWindows ? "junction" : "dir");
      assertNativeError(
        thrownBy(() => fs.cpSync(src, dest, { dereference: true })),
        "ERR_FS_CP_NON_DIR_TO_DIR",
        `Cannot overwrite directory ${shown(dest)} with non-directory ${shown(src)}`,
      );
    }));

  test("dest is inside src, with and without recursive", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const dest = path.join(src, "new", "dest");
      fs.mkdirSync(src);
      for (const options of [undefined, { recursive: true }, { recursive: true, filter: () => true }]) {
        assertNativeError(
          thrownBy(() => fs.cpSync(src, dest, options)),
          "ERR_FS_CP_EINVAL",
          `Cannot copy ${shownWithSeparator(src)} to a subdirectory of self ${shown(dest)}`,
        );
      }
      assert.deepStrictEqual(fs.readdirSync(src), []);
      // A name that only starts with src's is another directory.
      fs.cpSync(src, src + "-copy", { recursive: true });
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["src", "src-copy"]);
    }));

  test("what dest is comes before whether dest is inside src", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const inside = path.join(src, "file");
      const link = path.join(dir, "elsewhere", "link");
      fs.mkdirSync(src);
      fs.writeFileSync(inside, "a");
      fs.mkdirSync(path.join(dir, "elsewhere"));
      fs.symlinkSync(src, link, isWindows ? "junction" : "dir");
      for (const dest of [inside, path.join(link, "file")]) {
        for (const options of [undefined, { recursive: true }, { recursive: true, filter: () => true }]) {
          assertNativeError(
            thrownBy(() => fs.cpSync(src, dest, options)),
            "ERR_FS_CP_DIR_TO_NON_DIR",
            `Cannot overwrite non-directory ${shown(dest)} with directory ${shown(src)}`,
          );
        }
      }
      assert.strictEqual(fs.readFileSync(inside, "utf8"), "a");
    }));

  test("the folder above dest is a link to src", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const link = path.join(dir, "elsewhere", "link");
      const dest = path.join(link, "dest");
      fs.mkdirSync(path.join(src, "inside"), { recursive: true });
      fs.mkdirSync(path.join(dir, "elsewhere"));
      fs.symlinkSync(src, link, isWindows ? "junction" : "dir");
      for (const options of [{ recursive: true }, undefined]) {
        assertNativeError(
          thrownBy(() => fs.cpSync(src, dest, options)),
          "ERR_FS_CP_EINVAL",
          `Cannot copy ${shownWithSeparator(src)} to a subdirectory of self ${shown(dest)}`,
        );
      }
      assert.deepStrictEqual(fs.readdirSync(src), ["inside"]);
    }));

  test("a FIFO", { skip: isWindows }, () =>
    inTempDir(dir => {
      const src = path.join(dir, "fifo");
      const missing = path.join(dir, "new", "sub", "dest");
      const file = path.join(dir, "file");
      const directory = path.join(dir, "directory");
      execFileSync("mkfifo", [src]);
      fs.writeFileSync(file, "a");
      fs.mkdirSync(directory);
      for (const dest of [missing, file]) {
        for (const options of [undefined, { recursive: true }, { filter: () => true }]) {
          assertNativeError(
            thrownBy(() => fs.cpSync(src, dest, options)),
            "ERR_FS_CP_FIFO_PIPE",
            `Cannot copy a FIFO pipe: ${dest}`,
          );
        }
      }
      // What dest is comes before what src is.
      assertNativeError(
        thrownBy(() => fs.cpSync(src, directory)),
        "ERR_FS_CP_NON_DIR_TO_DIR",
        `Cannot overwrite directory ${directory} with non-directory ${src}`,
      );
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["directory", "fifo", "file"]);
    }),
  );

  test("a socket", { skip: isWindows }, () =>
    inTempDir(async dir => {
      const src = path.join(dir, "s");
      const dest = path.join(dir, "new", "sub", "dest");
      const server = createServer();
      try {
        server.listen(src);
        await once(server, "listening");
        for (const options of [undefined, { filter: () => true }]) {
          assertNativeError(
            thrownBy(() => fs.cpSync(src, dest, options)),
            "ERR_FS_CP_SOCKET",
            `Cannot copy a socket file: ${dest}`,
          );
        }
        assert.deepStrictEqual(fs.readdirSync(dir), ["s"]);
      } finally {
        server.close();
      }
    }),
  );

  const noKnownType = fileOfNoKnownType();
  test("a file of no known type", { skip: noKnownType ? false : "no such file on this system" }, () =>
    inTempDir(dir => {
      const dest = path.join(dir, "new", "sub", "dest");
      // The file is behind a link. Node's check follows a link at src unless `dereference` is set, and Bun's if it is set.
      const follow = isBun ? { dereference: true } : {};
      for (const options of [follow, { ...follow, filter: () => true }]) {
        assertNativeError(
          thrownBy(() => fs.cpSync(noKnownType!, dest, options)),
          "ERR_FS_CP_UNKNOWN",
          `Cannot copy an unknown file type: ${dest}`,
        );
      }
      assert.deepStrictEqual(fs.readdirSync(dir), []);
    }),
  );

  test("a dest that cannot be read does not come before what src is", { skip: isWindows }, () =>
    inTempDir(dir => {
      const directory = path.join(dir, "directory");
      const fifo = path.join(dir, "fifo");
      const file = path.join(dir, "file");
      const other = path.join(dir, "other");
      const loop = path.join(dir, "loop");
      const locked = path.join(dir, "locked");
      fs.mkdirSync(directory);
      execFileSync("mkfifo", [fifo]);
      fs.writeFileSync(file, "a");
      fs.writeFileSync(other, "b");
      fs.symlinkSync(loop, loop);
      fs.mkdirSync(locked, { mode: 0 });
      try {
        const unreadable: [dest: string, code: string][] = [
          [path.join(other, "dest"), "ENOTDIR"],
          [path.join(loop, "dest"), "ELOOP"],
          // Longer than PATH_MAX on every system.
          [path.join(dir, Buffer.alloc(5000, "a").toString()), "ENAMETOOLONG"],
        ];
        // Every folder can be searched by root.
        if (!isRoot) unreadable.push([path.join(locked, "dest"), "EACCES"]);
        for (const [dest, code] of unreadable) {
          for (const options of [undefined, { filter: () => true }]) {
            assertNativeError(
              thrownBy(() => fs.cpSync(directory, dest, options)),
              "ERR_FS_EISDIR",
              `Recursive option not enabled, cannot copy a directory: ${directory}${path.sep}`,
            );
            assertNativeError(
              thrownBy(() => fs.cpSync(fifo, dest, options)),
              "ERR_FS_CP_FIFO_PIPE",
              `Cannot copy a FIFO pipe: ${dest}`,
            );
            // Nothing refuses a file, so the stat of dest is what fails.
            const err = thrownBy(() => fs.cpSync(file, dest, options));
            assert.deepStrictEqual(
              { code: err.code, syscall: err.syscall, path: err.path },
              { code, syscall: "lstat", path: dest },
            );
          }
        }
      } finally {
        fs.chmodSync(locked, 0o700);
      }
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["directory", "fifo", "file", "locked", "loop", "other"]);
      assert.strictEqual(fs.readFileSync(other, "utf8"), "b");
    }),
  );

  test("a path in a Buffer is checked as a string is", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const file = path.join(dir, "file");
      const bytes = (given: string) => Buffer.from(given) as any;
      fs.mkdirSync(src);
      fs.writeFileSync(file, "a");
      assertNativeError(
        thrownBy(() => fs.cpSync(bytes(src), path.join(dir, "new", "dest"))),
        "ERR_FS_EISDIR",
        `Recursive option not enabled, cannot copy a directory: ${shownWithSeparator(src)}`,
      );
      assertNativeError(
        thrownBy(() => fs.cpSync(bytes(file), bytes(file))),
        "ERR_FS_CP_EINVAL",
        `src and dest cannot be the same ${shown(file)}`,
      );
      assertNativeError(
        thrownBy(() => fs.cpSync(bytes(src), bytes(file), { recursive: true })),
        "ERR_FS_CP_DIR_TO_NON_DIR",
        `Cannot overwrite non-directory ${shown(file)} with directory ${shown(src)}`,
      );
      assertNativeError(
        thrownBy(() => fs.cpSync(file, bytes(src))),
        "ERR_FS_CP_NON_DIR_TO_DIR",
        `Cannot overwrite directory ${shown(src)} with non-directory ${shown(file)}`,
      );
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["file", "src"]);
    }));

  test("the filter runs first, and the check reads the options after it", () =>
    inTempDir(dir => {
      const src = path.join(dir, "src");
      const dest = path.join(dir, "dest");
      const missing = path.join(dir, "missing");
      fs.mkdirSync(src);
      fs.writeFileSync(path.join(src, "file"), "a");

      assert.strictEqual(fs.cpSync(missing, dest, { filter: () => false }), undefined);
      assert.strictEqual(fs.cpSync(Buffer.from(missing) as any, dest, { filter: () => false }), undefined);
      assert.strictEqual(
        thrownBy(() => fs.cpSync(missing, dest, { filter: (() => Promise.resolve(true)) as any })).code,
        "ERR_INVALID_RETURN_VALUE",
      );
      // Node's C++ takes `recursive` to be set only if it is `true`.
      for (const notTrue of [false, 1]) {
        assertNativeError(
          thrownBy(() =>
            fs.cpSync(src, dest, {
              recursive: true,
              filter(this: any) {
                this.recursive = notTrue;
                return true;
              },
            }),
          ),
          "ERR_FS_EISDIR",
          `Recursive option not enabled, cannot copy a directory: ${shownWithSeparator(src)}`,
        );
      }
      fs.cpSync(src, dest, {
        filter(this: fs.CopySyncOptions) {
          this.recursive = true;
          return true;
        },
      } as fs.CopySyncOptions);
      assert.strictEqual(fs.readFileSync(path.join(dest, "file"), "utf8"), "a");
    }));

  test("a src that is not there, or too long a path, fails the stat", { skip: isWindows }, () =>
    inTempDir(dir => {
      const missing = path.join(dir, "missing");
      const dest = path.join(dir, "new", "dest");
      // Longer than PATH_MAX on every system.
      const tooLong = path.join(dir, Buffer.alloc(5000, "a").toString());
      for (const [src, options, code, syscall] of [
        [missing, undefined, "ENOENT", "lstat"],
        [missing, { dereference: true }, "ENOENT", "stat"],
        [Buffer.from(missing), undefined, "ENOENT", "lstat"],
        [tooLong, undefined, "ENAMETOOLONG", "lstat"],
        [tooLong, { dereference: true, filter: () => true }, "ENAMETOOLONG", "stat"],
      ] as const) {
        const err = thrownBy(() => fs.cpSync(src as any, dest, options));
        assert.deepStrictEqual(
          { code: err.code, syscall: err.syscall, path: err.path, keys: Object.keys(err).sort() },
          { code, syscall, path: String(src), keys: ["code", "errno", "path", "syscall"] },
        );
      }
      assert.deepStrictEqual(fs.readdirSync(dir), []);
    }),
  );

  test("a check that fails calls no function of the fs module", () =>
    inTempDir(dir => {
      fs.mkdirSync(path.join(dir, "src"));
      // In a process of its own: cpSync reads the functions of `fs` when it is first called.
      const script = `
        const fs = require("node:fs");
        const calls = [];
        for (const name of ["lstatSync", "statSync", "existsSync", "mkdirSync"]) {
          const original = fs[name];
          fs[name] = function (...args) {
            calls.push(name);
            return original.apply(this, args);
          };
        }
        let code;
        try {
          fs.cpSync("src", "new/sub/dest", { filter: () => true });
        } catch (err) {
          code = err.code;
        }
        console.log(JSON.stringify({ code, calls }));
      `;
      const child = spawnSync(process.execPath, ["-e", script], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" },
      });
      assert.deepStrictEqual(
        { stdout: child.stdout.trim(), status: child.status },
        { stdout: JSON.stringify({ code: "ERR_FS_EISDIR", calls: [] }), status: 0 },
      );
    }));
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const { bunEnv, nodeExeAtLeast } = await import("harness");

  // Node's C++ reads a link at src the other way round (https://github.com/nodejs/node/pull/60945), and ends the
  // process for some pairs. Bun decides these as node's JavaScript does, in cpSync's walker and in fs.cp.
  describe("fs.cpSync decides as node's JavaScript checkPaths does", () => {
    type Outcome = { code: string; message?: string } | { dest: string };
    const rows: [label: string, src: string, dest: string, options: fs.CopySyncOptions | undefined, Outcome][] = [
      ["a link to a directory onto nothing", "link-to-directory", "new", undefined, { dest: "link to directory" }],
      [
        "a link to a directory onto a directory",
        "link-to-directory",
        "directory2",
        { recursive: true },
        { code: "ERR_FS_CP_NON_DIR_TO_DIR", message: "Cannot overwrite directory <dest> with non-directory <src>" },
      ],
      ["a link to a directory onto a file", "link-to-directory", "file2", undefined, { code: "EEXIST" }],
      ["a link to a file onto nothing, with dereference", "link-to-file", "new", { dereference: true }, { dest: "a" }],
      ["a link to nothing onto nothing", "link-to-nothing", "new", undefined, { dest: "link to nothing" }],
      [
        "a link to nothing onto a directory",
        "link-to-nothing",
        "directory2",
        undefined,
        { code: "ERR_FS_CP_NON_DIR_TO_DIR", message: "Cannot overwrite directory <dest> with non-directory <src>" },
      ],
      ["a file onto a link to it", "file", "link-to-file", undefined, { dest: "a" }],
      ["a file onto a link to nothing", "file", "link-to-nothing", undefined, { dest: "a" }],
      [
        "a directory onto a link to nothing",
        "directory",
        "link-to-nothing",
        { recursive: true },
        { code: "ERR_FS_CP_DIR_TO_NON_DIR", message: "Cannot overwrite non-directory <dest> with directory <src>" },
      ],
      [
        "a FIFO onto a FIFO",
        "fifo",
        "fifo2",
        undefined,
        { code: "ERR_FS_CP_FIFO_PIPE", message: "Cannot copy a FIFO pipe: <dest>" },
      ],
      // Only a directory is looked for in the folders above dest. Node also looks for a file, and for a FIFO where
      // the C++ library that it was built with compares two of them.
      ["a file onto a path below it", "file", "file/below", undefined, { code: "ENOTDIR" }],
      [
        "a FIFO onto a path below it",
        "fifo",
        "fifo/below",
        undefined,
        { code: "ERR_FS_CP_FIFO_PIPE", message: "Cannot copy a FIFO pipe: <dest>" },
      ],
    ];
    for (const [label, srcName, destName, options, expected] of rows) {
      test(label, { skip: isWindows }, () =>
        inTempDir(dir => {
          const at = (name: string) => path.join(dir, name);
          const [src, dest] = [at(srcName), at(destName)];
          fs.mkdirSync(at("directory"));
          fs.mkdirSync(at("directory2"));
          fs.writeFileSync(at("file"), "a");
          fs.writeFileSync(at("file2"), "b");
          fs.symlinkSync(at("directory"), at("link-to-directory"));
          fs.symlinkSync(at("file"), at("link-to-file"));
          fs.symlinkSync(at("nothing"), at("link-to-nothing"));
          execFileSync("mkfifo", [at("fifo"), at("fifo2")]);

          if ("dest" in expected) {
            fs.cpSync(src, dest, options);
            const found = fs.lstatSync(dest).isSymbolicLink()
              ? `link to ${path.basename(fs.readlinkSync(dest))}`
              : fs.readFileSync(dest, "utf8");
            assert.deepStrictEqual(
              { dest: found, src: fs.readFileSync(at("file"), "utf8") },
              { ...expected, src: "a" },
            );
          } else if (expected.message) {
            const message = expected.message.replace("<src>", src).replace("<dest>", dest);
            assertNativeError(
              thrownBy(() => fs.cpSync(src, dest, options)),
              expected.code,
              message,
            );
          } else {
            assert.strictEqual(thrownBy(() => fs.cpSync(src, dest, options)).code, expected.code);
          }
        }),
      );
    }

    test("a Buffer path that the check lets through is refused before anything is written", () =>
      inTempDir(dir => {
        const src = path.join(dir, "src");
        const dest = path.join(dir, "new", "sub", "dest");
        fs.writeFileSync(src, "a");
        const given: [src: any, dest: any, name: string][] = [
          [Buffer.from(src), dest, "src"],
          [src, Buffer.from(dest), "dest"],
        ];
        for (const [givenSrc, givenDest, name] of given) {
          for (const options of [undefined, { filter: () => true }]) {
            const err = thrownBy(() => fs.cpSync(givenSrc, givenDest, options));
            assert.deepStrictEqual(
              { code: err.code, message: err.message },
              {
                code: "ERR_INVALID_ARG_TYPE",
                message: `The "${name}" argument must be of type string. Received an instance of Buffer`,
              },
            );
          }
        }
        assert.deepStrictEqual(fs.readdirSync(dir), ["src"]);
      }));
  });

  describe("Node.js compatibility", () => {
    // The text of the errors is that of v26.3.0 and later.
    const node = nodeExeAtLeast("26.3.0");
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [node!, fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
