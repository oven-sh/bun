/**
 * fs.rmdir(path, { recursive: true }) is DEP0147. Node 25 removed the option.
 * Bun keeps it for published packages. This table is what Node 24 does, and
 * Node has done the same since 18.13 and 19.2:
 * https://github.com/nodejs/node/blob/v24.0.0/lib/fs.js#L1124-L1185 (rmdir, rmdirSync)
 * https://github.com/nodejs/node/blob/v24.0.0/lib/internal/fs/promises.js#L807-L824
 * https://github.com/nodejs/node/blob/v24.0.0/lib/internal/fs/utils.js#L882-L895
 *
 * Only a directory is removed, and `force` is never read. The three forms
 * differ: rmdirSync and the callback rmdir use lstat and spread the options
 * before they check them. promises.rmdir uses stat and checks the options
 * object itself.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot
 * import from "harness" for the same reason, so it manages its own temporary
 * directory.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";

const isWindows = process.platform === "win32";
// rmdir(2) on a file. libuv reports ENOENT for it on Windows.
const notDir = isWindows ? "ENOENT" : "ENOTDIR";

type Input = { target: any; options: any; left: () => string };
type Flags = { posixOnly?: boolean; noCallback?: boolean };
// [name, input, what rmdirSync, rmdir and promises.rmdir do with it, flags]
type Case = [string, (dir: string) => Input, [string, string, string], Flags?];

const state = (p: string) => {
  try {
    fs.lstatSync(p);
    return "kept";
  } catch {
    return "gone";
  }
};
const file = (dir: string) => {
  const p = path.join(dir, "file");
  fs.writeFileSync(p, "x");
  return p;
};
const tree = (dir: string) => {
  const p = path.join(dir, "tree");
  fs.mkdirSync(path.join(p, "a", "b"), { recursive: true });
  fs.writeFileSync(path.join(p, "a", "b", "c"), "c");
  return p;
};
const empty = (dir: string) => {
  const p = path.join(dir, "empty");
  fs.mkdirSync(p);
  return p;
};
const on = (p: string, options: any, target: any = p): Input => ({ target, options, left: () => state(p) });
const inherited = () => Object.create({ recursive: true });

const cases: Case[] = [
  [
    "a file",
    dir => on(file(dir), { recursive: true }),
    [`${notDir} rmdir thrown, kept`, `${notDir} rmdir delivered, kept`, `${notDir} rmdir delivered, kept`],
  ],
  [
    "a file as a Buffer path",
    dir => {
      const p = file(dir);
      return on(p, { recursive: true }, Buffer.from(p));
    },
    [`${notDir} rmdir thrown, kept`, `${notDir} rmdir delivered, kept`, `${notDir} rmdir delivered, kept`],
  ],
  [
    "a missing path",
    dir => on(path.join(dir, "missing"), { recursive: true }),
    ["ENOENT lstat thrown, gone", "ENOENT lstat delivered, gone", "ENOENT stat delivered, gone"],
  ],
  [
    "a missing path with force: true",
    dir => on(path.join(dir, "missing"), { recursive: true, force: true }),
    ["ENOENT lstat thrown, gone", "ENOENT lstat delivered, gone", "ENOENT stat delivered, gone"],
  ],
  ["a tree", dir => on(tree(dir), { recursive: true }), ["ok, gone", "ok, gone", "ok, gone"]],
  ["an empty directory", dir => on(empty(dir), { recursive: true }), ["ok, gone", "ok, gone", "ok, gone"]],
  [
    "a tree as a file URL",
    dir => {
      const p = tree(dir);
      return on(p, { recursive: true }, pathToFileURL(p));
    },
    ["ok, gone", "ok, gone", "ok, gone"],
  ],
  [
    "a tree as a Buffer path",
    dir => {
      const p = tree(dir);
      return on(p, { recursive: true }, Buffer.from(p));
    },
    ["ok, gone", "ok, gone", "ok, gone"],
  ],
  [
    "a tree with maxRetries: 1 and retryDelay: 0",
    dir => on(tree(dir), { recursive: true, maxRetries: 1, retryDelay: 0 }),
    ["ok, gone", "ok, gone", "ok, gone"],
  ],
  [
    // Node 24's rmdirSync fails for a maxRetries of 2 ** 31 and above, so the row stops below it.
    "a tree with maxRetries and retryDelay of 2 ** 31 - 1",
    dir => on(tree(dir), { recursive: true, maxRetries: 2 ** 31 - 1, retryDelay: 2 ** 31 - 1 }),
    ["ok, gone", "ok, gone", "ok, gone"],
  ],
  [
    "a tree with force: 'x'",
    dir => on(tree(dir), { recursive: true, force: "x" }),
    ["ok, gone", "ok, gone", "ok, gone"],
  ],
  [
    "a tree with force: undefined",
    dir => on(tree(dir), { recursive: true, force: undefined }),
    ["ok, gone", "ok, gone", "ok, gone"],
  ],
  [
    "a symlink to a directory",
    dir => {
      const target = tree(dir);
      const link = path.join(dir, "link");
      fs.symlinkSync(target, link);
      return { target: link, options: { recursive: true }, left: () => `link ${state(link)}, target ${state(target)}` };
    },
    [
      "ENOTDIR rmdir thrown, link kept, target kept",
      "ENOTDIR rmdir delivered, link kept, target kept",
      "ok, link gone, target kept",
    ],
    { posixOnly: true },
  ],
  [
    "a symlink to a file",
    dir => {
      const link = path.join(dir, "link");
      fs.symlinkSync(file(dir), link);
      return on(link, { recursive: true });
    },
    ["ENOTDIR rmdir thrown, kept", "ENOTDIR rmdir delivered, kept", "ENOTDIR rmdir delivered, kept"],
    { posixOnly: true },
  ],
  [
    "a dangling symlink",
    dir => {
      const link = path.join(dir, "link");
      fs.symlinkSync(path.join(dir, "nowhere"), link);
      return on(link, { recursive: true });
    },
    ["ENOTDIR rmdir thrown, kept", "ENOTDIR rmdir delivered, kept", "ENOENT stat delivered, kept"],
    { posixOnly: true },
  ],
  [
    "options that are an array",
    dir => on(tree(dir), Object.assign([], { recursive: true })),
    ["ok, gone", "ok, gone", "ERR_INVALID_ARG_TYPE delivered, kept"],
  ],
  [
    // The callback form takes a function in this position as the callback.
    "options that are a function",
    dir =>
      on(
        tree(dir),
        Object.assign(() => {}, { recursive: true }),
      ),
    ["ok, gone", "", "ERR_INVALID_ARG_TYPE delivered, kept"],
    { noCallback: true },
  ],
  [
    "recursive: 1",
    dir => on(tree(dir), { recursive: 1 }),
    ["ERR_INVALID_ARG_TYPE thrown, kept", "ERR_INVALID_ARG_TYPE thrown, kept", "ERR_INVALID_ARG_TYPE delivered, kept"],
  ],
  [
    "maxRetries: -1",
    dir => on(tree(dir), { recursive: true, maxRetries: -1 }),
    ["ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE delivered, kept"],
  ],
  [
    "maxRetries: 2 ** 32",
    dir => on(tree(dir), { recursive: true, maxRetries: 2 ** 32 }),
    ["ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE delivered, kept"],
  ],
  [
    "retryDelay: -1",
    dir => on(tree(dir), { recursive: true, retryDelay: -1 }),
    ["ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE delivered, kept"],
  ],
  [
    "retryDelay: 2 ** 31",
    dir => on(tree(dir), { recursive: true, retryDelay: 2 ** 31 }),
    ["ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE thrown, kept", "ERR_OUT_OF_RANGE delivered, kept"],
  ],
  [
    "retryDelay: '1'",
    dir => on(tree(dir), { recursive: true, retryDelay: "1" }),
    ["ERR_INVALID_ARG_TYPE thrown, kept", "ERR_INVALID_ARG_TYPE thrown, kept", "ERR_INVALID_ARG_TYPE delivered, kept"],
  ],
  [
    "a bad option on a missing path",
    dir => on(path.join(dir, "missing"), { recursive: true, maxRetries: -1 }),
    ["ERR_OUT_OF_RANGE thrown, gone", "ERR_OUT_OF_RANGE thrown, gone", "ERR_OUT_OF_RANGE delivered, gone"],
  ],
  [
    // The merge of the options copies own keys only, so `recursive` is false after it.
    "an inherited recursive on a tree",
    dir => on(tree(dir), inherited()),
    ["ERR_FS_EISDIR rm thrown, kept", "ERR_FS_EISDIR rm delivered, kept", "ENOTEMPTY rmdir delivered, kept"],
  ],
  [
    "an inherited recursive on an empty directory",
    dir => on(empty(dir), inherited()),
    ["ERR_FS_EISDIR rm thrown, kept", "ERR_FS_EISDIR rm delivered, kept", "ok, gone"],
  ],
  [
    "an inherited recursive on a file",
    dir => on(file(dir), inherited()),
    [`${notDir} rmdir thrown, kept`, `${notDir} rmdir delivered, kept`, `${notDir} rmdir delivered, kept`],
  ],
];

const failure = (e: any, how: string) => `${e.code}${e.syscall ? " " + e.syscall : ""} ${how}`;

const forms: [string, (target: any, options: any) => Promise<string>][] = [
  [
    "rmdirSync",
    async (target, options) => {
      try {
        (fs.rmdirSync as any)(target, options);
        return "ok";
      } catch (e) {
        return failure(e, "thrown");
      }
    },
  ],
  [
    "rmdir",
    (target, options) =>
      new Promise(resolve => {
        try {
          (fs.rmdir as any)(target, options, (...args: any[]) => {
            // A successful callback gets `null` alone. Nothing throws in here: the outcome carries any other arguments to the assertion.
            if (args[0]) resolve(failure(args[0], "delivered"));
            else if (args.length === 1 && args[0] === null) resolve("ok");
            else resolve(`ok with the callback arguments ${inspect(args)}`);
          });
        } catch (e) {
          resolve(failure(e, "thrown"));
        }
      }),
  ],
  [
    "promises.rmdir",
    async (target, options) => {
      let promise;
      try {
        promise = (fs.promises.rmdir as any)(target, options);
      } catch (e) {
        return failure(e, "thrown");
      }
      return promise.then(
        () => "ok",
        e => failure(e, "delivered"),
      );
    },
  ],
];

describe("rmdir with recursive: true does what Node 24 does", () => {
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fs-rmdir-recursive-"));
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  for (const [name, make, expected, flags] of cases) {
    if (flags?.posixOnly && isWindows) continue;
    forms.forEach(([form, run], i) => {
      if (flags?.noCallback && form === "rmdir") return;
      test(`${form}: ${name}`, async () => {
        const { target, options, left } = make(fs.mkdtempSync(path.join(root, "case-")));
        const outcome = await run(target, options);
        assert.strictEqual(`${outcome}, ${left()}`, expected[i]);
      });
    });
  }
});
