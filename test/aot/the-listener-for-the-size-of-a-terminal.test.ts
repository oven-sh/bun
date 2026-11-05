// process.stdout and process.stderr over a terminal lay a listener for "SIGWINCH" on `process`, as node's do. In a compiled program
// that asks little of a stream native code lays it. A program can list the listener, remove it, be told of it and put a function
// of its own in the place of process.on, which gets `process` as `this`: each of these answers as `bun run` does.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

// The report of an error shows lines of the source and a stack, and an executable has other paths.
// Of a call in the text of its own library plain Bun quotes nothing: "5 is not a function". A compiled program quotes it: "process.on is not a function. (In 'process.on()', 'process.on' is 5)".
const withoutPlaces = (shown: string) =>
  shown
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter(line => line !== "" && !/^\s*\d+ \| |^\s*\^+$|^\s+at |^Bun v/.test(line))
    .map(line => line.replace(/^TypeError: .*$/, "TypeError"))
    .join("\n");

async function shownInTerminal(cmd: string[], cwd: string) {
  let shown = "";
  let isResized = false;
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    terminal: {
      cols: 80,
      rows: 24,
      data: (terminal: { resize(cols: number, rows: number): void }, data: Uint8Array) => {
        shown += new TextDecoder().decode(data);
        if (isResized || !shown.includes("ready")) return;
        isResized = true;
        terminal.resize(90, 20);
      },
    },
  } as never);
  const exitCode = await child.exited;
  return { shown: withoutPlaces(shown), exitCode, signal: child.signalCode };
}

const programs: Record<string, { source: string; shown: string; exitCode?: number }> = {
  "a function that the program has put under process.on is called": {
    source: `const notes: string[] = [];
const original = process.on;
process.on = function (this: unknown, event: string, listener: () => void) {
  notes.push(["on", event, typeof listener, this === process, arguments.length].join(" ")); // @ts-expect-error
  return original.call(this, event, listener);
} as never;
process.stdout.write("");
notes.push("count " + process.listenerCount("SIGWINCH"));
console.log(notes.join("\\n"));
`,
    shown: "on SIGWINCH function true 2\ncount 1",
  },
  "a function under process.on reads a member off `this` that nothing else in the program names": {
    source: `process.on = function (this: NodeJS.Process, event: string) {
  console.log(event, typeof this.allowedNodeEnvironmentFlags.has);
  return this;
} as never;
process.stdout.write("written\\n");
`,
    shown: "SIGWINCH function\nwritten",
  },
  "so does a function that is laid above `process`": {
    source: `(process as never as { __proto__: NodeJS.Process }).__proto__.on = function (this: NodeJS.Process, event: string) {
  console.log(event, typeof this.finalization.register);
  return this;
};
process.stderr.write("written\\n");
`,
    shown: "SIGWINCH function\nwritten",
  },
  "a getter that the program has put under process.on is read": {
    source: `const notes: string[] = [];
const original = process.on;
Object.defineProperty(process, "on", {
  get() {
    notes.push("read " + (this === process));
    return original;
  },
});
process.stdout.write("");
notes.push("count " + process.listenerCount("SIGWINCH"));
console.log(notes.join("\\n"));
`,
    shown: "read true\ncount 1",
  },
  "what is no function under process.on is reported as a TypeError, and the stream is undefined from then on": {
    source: `process.on = 5 as never;
const stream = process.stdout;
console.log(typeof stream, process.listenerCount("SIGWINCH"));
`,
    shown: "TypeError\nundefined 0",
    exitCode: 1,
  },
  "a listener for newListener is told, in front of the count": {
    source: `const notes: string[] = [];
const told: unknown[] = [];
process.on("newListener", function (this: unknown, event: string, listener: Function) {
  told.push(listener);
  notes.push([event, listener.name === "", listener.length, this === process, process.listenerCount("SIGWINCH")].join(" "));
});
process.stdout.write("");
notes.push("count " + process.listenerCount("SIGWINCH") + " " + (told[0] === process.listeners("SIGWINCH")[0]));
console.log(notes.join("\\n"));
`,
    shown: "SIGWINCH true 0 true 0\ncount 1 true",
  },
  "it stands among the listeners of the program where the stream was first read": {
    source: `function first() {}
function last() {}
function front() {}
process.on("SIGWINCH", first);
process.stdout.write("");
process.stderr.write("");
process.on("SIGWINCH", last);
process.prependListener("SIGWINCH", front);
const names = process.listeners("SIGWINCH").map(each => each.name || "of a stream");
console.log(names.join(", "));
`,
    shown: "front, first, of a stream, of a stream, last",
  },
  "it reads the size anew in front of a listener that was added behind the first read": {
    source: `const before = process.stdout.columns + "x" + process.stdout.rows;
process.on("SIGWINCH", () => {
  console.log(before, process.stdout.columns + "x" + process.stdout.rows);
  process.exit(0);
});
setTimeout(() => process.exit(2), 30_000);
console.log("ready");
`,
    shown: "ready\n80x24 90x20",
  },
  "the stream with all its members tells its own listeners of the new size": {
    source: `process.stdout.on("resize", () => {
  console.log("resize", process.stdout.columns + "x" + process.stdout.rows);
  process.exit(0);
});
setTimeout(() => process.exit(2), 30_000);
console.log("ready");
`,
    shown: "ready\nresize 90x20",
  },
};

describe.skipIf(isWindows)("the listener that a standard stream over a terminal lays for SIGWINCH", () => {
  for (const [name, { source, shown, exitCode = 0 }] of Object.entries(programs)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-listener-for-size", { "app.ts": source });
          const folder = String(dir);
          built(await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], folder, env));
          const compiled = await shownInTerminal([join(folder, "app")], folder);
          expect(compiled).toEqual({ shown, exitCode, signal: null });
          expect(compiled).toEqual(await shownInTerminal([bunExe(), "app.ts"], folder));
        }),
      300_000,
    );
  }
});
