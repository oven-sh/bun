import { constants, readdir, watch } from "node:fs";

constants.O_APPEND;

import * as fs from "fs";
import { exists } from "fs/promises";
import * as tsd from "./utilities";

tsd.expectType<Promise<boolean>>(exists("/etc/passwd"));
tsd.expectType<Promise<boolean>>(fs.promises.exists("/etc/passwd"));

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

const statSignal = new AbortController().signal;
tsd.expectType<fs.Stats>(await fs.promises.stat(".", { signal: statSignal }));
tsd.expectType<fs.BigIntStats>(await fs.promises.lstat(".", { signal: statSignal, bigint: true }));
fs.stat(".", { signal: statSignal }, (err, stats) => {});
fs.lstat(".", { signal: statSignal }, (err, stats) => {});
fs.fstat(0, { signal: statSignal }, (err, stats) => {});
// @ts-expect-error - signal is an AbortSignal
await fs.promises.stat(".", { signal: "nope" });
