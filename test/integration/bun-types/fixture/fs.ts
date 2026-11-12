import { constants, readdir, watch } from "node:fs";

constants.O_APPEND;

import * as fs from "fs";
import { exists } from "fs/promises";
import * as tsd from "./utilities";

tsd.expectType<Promise<boolean>>(exists("/etc/passwd"));
tsd.expectType<Promise<boolean>>(fs.promises.exists("/etc/passwd"));

// `maxDepth` of fs.glob (Node.js v26.9)
tsd.expectType<string[]>(fs.globSync("**/*.ts", { maxDepth: 1 }));
tsd.expectType<fs.Dirent[]>(fs.globSync("**/*.ts", { maxDepth: 1, withFileTypes: true }));
fs.glob("**/*.ts", { cwd: ".", maxDepth: 0 }, (err, matches) => {
  tsd.expectType<string[]>(matches);
});
tsd.expectType<NodeJS.AsyncIterator<string>>(fs.promises.glob("**/*.ts", { maxDepth: 2 }));
// @ts-expect-error
fs.globSync("**/*.ts", { maxDepth: "1" });
// The overload for a `withFileTypes` that is not a literal, and the base interface
declare const withFileTypes: boolean;
tsd.expectType<string[] | fs.Dirent[]>(fs.globSync("**/*.ts", { withFileTypes, maxDepth: 1, followSymlinks: true }));
const globOptions: fs.GlobOptions = { maxDepth: 1, followSymlinks: true };
tsd.expectType<string[] | fs.Dirent[]>(fs.globSync("**/*.ts", globOptions));

// file path
watch(".", (eventType, filename) => {
  console.log(`event type = ${eventType}`);
  if (filename) {
    console.log(`filename = ${filename}`);
  }
});

await Bun.file("sdf").exists();

readdir(".", { recursive: true }, (err, files) => {});

fs.createReadStream("", { windowsHandle: 0n });
fs.createWriteStream("", { windowsHandle: 0n, autoClose: true });
// @ts-expect-error - windowsHandle is a bigint
fs.createReadStream("", { windowsHandle: 1 });
