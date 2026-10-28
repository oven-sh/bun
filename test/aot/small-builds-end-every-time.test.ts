// The threads of a build hand each other the files of the program: they are read, parsed, and what they import is queued, and a
// file on a cycle of imports may be queued and parsed a second time when all others are done. Who gets the processor first at each
// step goes by the load of the machine, and one build sees one such order. This file builds small programs many times, several at
// once, so that it meets many orders: every build ends by itself, and the executable prints what `bun run` prints.
// On macOS and Windows the threads that read are not the threads that parse; elsewhere each thread does both. Every system builds
// both ways here. A build that does not end is killed at spawned()'s time limit and is listed with what it said.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const programs: Record<string, Record<string, string>> = {
  "one file": {
    "main.ts": `console.log("hello");`,
  },
  "a cycle of imports with a file that is parsed twice": {
    "main.mjs": `
import "./first.mjs";
var isBun = typeof Bun === "object";
export function which() { return isBun ? "bun" : "not yet"; }
console.log(which());`,
    "first.mjs": `
import { which } from "./main.mjs";
console.log(which());`,
  },
  "two cycles of imports, each with files that are parsed twice, and files on none": {
    "main.mjs": `
import { left } from "./left-a.mjs";
import { right } from "./right-a.mjs";
import { alone } from "./alone.mjs";
console.log(left(), right(), alone());`,
    "left-a.mjs": `
import { leftB } from "./left-b.mjs";
var isBun = typeof Bun === "object";
export function left() { return (isBun ? "bun " : "not yet ") + leftB(); }`,
    "left-b.mjs": `
import { left } from "./left-a.mjs";
var alsoBun = typeof Bun !== "undefined";
export function leftB() { return alsoBun ? typeof left : "not yet"; }`,
    "right-a.mjs": `
import { rightB } from "./right-b.mjs";
var isBun = "Bun" in globalThis;
export function right() { return (isBun ? "bun " : "not yet ") + rightB(); }`,
    "right-b.mjs": `
import { right } from "./right-a.mjs";
import { alone } from "./alone.mjs";
console.log(right(), alone());
export function rightB() { return typeof right; }`,
    "alone.mjs": `
var isBun = typeof Bun === "object";
export function alone() { return isBun ? "bun" : "not yet"; }`,
  },
  "a cycle of CommonJS files with a file that is parsed twice": {
    "main.cjs": `
exports.which = which;
require("./first.cjs");
var isBun = typeof Bun === "object";
function which() { return isBun ? "bun" : "not yet"; }
console.log(which());`,
    "first.cjs": `console.log(require("./main.cjs").which());`,
  },
};

const threads: Record<string, Record<string, string>> = {
  "some threads only read": { BUN_FEATURE_FLAG_FORCE_IO_POOL: "1" },
  "every thread reads and parses": { BUN_FEATURE_FLAG_DISABLE_IO_POOL: "1" },
};

const builds = isASAN || isDebug ? 12 : 40;
const atOnce = 12;

describe.each(Object.keys(threads))("%s", way => {
  test.each(Object.keys(programs))(
    `%s: ${builds} builds, ${atOnce} at once`,
    async name => {
      using dir = tempDir("aot-small-builds", programs[name]);
      const folder = String(dir);
      const entryPoint = Object.keys(programs[name])[0];
      const carrier = withoutDebugInformation();
      // Fewer than four threads all read and parse.
      const env = { ...bunEnv, ...threads[way], UV_THREADPOOL_SIZE: undefined, GOMAXPROCS: "6" };
      const plain = await spawned([bunExe(), "--no-install", entryPoint], folder, bunEnv);
      expect({ exitCode: plain.exitCode, prints: /\S/.test(plain.stdout) }).toEqual({ exitCode: 0, prints: true });
      const everyBuild = JSON.stringify({ exitCode: 0, signal: null, said: "", stdout: plain.stdout });

      const endings: Record<string, number> = {};
      let started = 0;
      await Promise.all(
        Array.from({ length: atOnce }, async (_, lane) => {
          const executable = join(folder, `lane-${lane}${isWindows ? ".exe" : ""}`);
          while (started++ < builds) {
            const build = await spawned(
              [bunExe(), "build", "--compile", "--aot", ...carrier, entryPoint, "--outfile", executable],
              folder,
              env,
            );
            const hasEnded = build.exitCode === 0;
            const { stdout } = hasEnded ? await spawned([executable], folder, bunEnv) : { stdout: "" };
            const said = hasEnded ? "" : build.stdout + build.stderr;
            const ending = JSON.stringify({ exitCode: build.exitCode, signal: build.signal, said, stdout });
            endings[ending] = (endings[ending] ?? 0) + 1;
          }
        }),
      );
      expect(endings).toEqual({ [everyBuild]: builds });
    },
    900_000,
  );
});
