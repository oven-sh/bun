// process.stdout and process.stderr over a terminal lay a listener for "SIGWINCH" on `process`, as node's do. A program can list the
// listener, remove it, be told of it and put a function of its own in the place of process.on, which gets `process` as `this`: in a
// compiled program each of these answers as `bun run` does, whether it has the stream with all its members or the light one.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, limitWithASAN, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

// The report of an error shows lines of the source and a stack, and an executable has other paths. The line that names the error stays.
const withoutPlaces = (shown: string) =>
  shown
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter(line => line !== "" && !/^\s*\d+ \| |^\s*\^+$|^\s+at |^Bun v/.test(line))
    .join("\n");

// A test has five minutes. What it starts is ended a little earlier: a command that hangs then fails its test by the signal, with what
// it has shown. A test that only timed out would show nothing, and would leave the command running.
const limitOfATest = 300_000;
const limitOfItsCommands = limitOfATest - 20_000;
// What a program may take to answer a resize. The two that wait for one have no limit of their own.
const limitOfAnAnswer = 30_000;

/** `endsBy`: when the run is ended, on the clock of `performance.now()`. */
async function shownInTerminal(cmd: string[], cwd: string, endsBy: number) {
  let shown = "";
  let answersBy: ReturnType<typeof setTimeout> | undefined;
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    timeout: Math.max(1, Math.round(endsBy - performance.now())),
    killSignal: "SIGKILL",
    terminal: {
      cols: 80,
      rows: 24,
      data: (terminal: { resize(cols: number, rows: number): void }, data: Uint8Array) => {
        shown += new TextDecoder().decode(data);
        if (answersBy !== undefined || !shown.includes("ready")) return;
        terminal.resize(90, 20);
        // Counted from the resize. How soon this process comes to resize, beside the other programs, is not held against the program.
        answersBy = setTimeout(() => child.kill("SIGKILL"), limitOfAnAnswer);
      },
    },
  } as never);
  const exitCode = await child.exited;
  clearTimeout(answersBy);
  return { shown: withoutPlaces(shown), exitCode, signal: child.signalCode };
}

// `underBunRun`: what `bun run` shows where it is not what the compiled program shows. One difference is declared
// (docs/compiler/compatibility.mdx), the other is the text of a message.
type Shown = { shown: string; exitCode?: number };
const programs: Record<string, Shown & { source: string; underBunRun?: Shown }> = {
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
  "no function is laid above `process` in the place of the native one, whose members are read-only": {
    source: `(process as never as { __proto__: NodeJS.Process }).__proto__.on = function (this: NodeJS.Process, event: string) {
  console.log(event, typeof this.finalization.register);
  return this;
};
process.stderr.write("written\\n");
`,
    shown:
      "TypeError: Cannot assign to %EventEmitter%.prototype.on because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)",
    exitCode: 1,
    underBunRun: { shown: "SIGWINCH function\nwritten" },
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
  // Of a call in the text of its own library plain Bun quotes nothing. A compiled program quotes the call.
  "what is no function under process.on is reported as a TypeError, and the stream is undefined from then on": {
    source: `process.on = 5 as never;
const stream = process.stdout;
console.log(typeof stream, process.listenerCount("SIGWINCH"));
`,
    shown: "TypeError: process.on is not a function. (In 'process.on()', 'process.on' is 5)\nundefined 0",
    exitCode: 1,
    underBunRun: { shown: "TypeError: 5 is not a function\nundefined 0", exitCode: 1 },
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
setInterval(() => {}, 1000);
console.log("ready");
`,
    shown: "ready\n80x24 90x20",
  },
  "the stream with all its members tells its own listeners of the new size": {
    source: `process.stdout.on("resize", () => {
  console.log("resize", process.stdout.columns + "x" + process.stdout.rows);
  process.exit(0);
});
setInterval(() => {}, 1000);
console.log("ready");
`,
    shown: "ready\nresize 90x20",
  },
};

describe.skipIf(isWindows)("the listener that a standard stream over a terminal lays for SIGWINCH", () => {
  for (const [name, { source, shown, exitCode = 0, underBunRun = { shown, exitCode } }] of Object.entries(programs)) {
    // Each program has its own folder, build and terminals, so the programs run beside one another on every lane.
    test.concurrent(
      name,
      () => {
        // Taken before the slot: the time of a test runs while it waits for one.
        const endsBy = performance.now() + limitOfItsCommands;
        return slot(async () => {
          const left = Math.round(endsBy - performance.now());
          if (left <= 0) throw new Error("the time of the test was up before a slot was free");
          using dir = tempDir("aot-listener-for-size", { "app.ts": source });
          const folder = String(dir);
          const [build, plain] = await Promise.all([
            // The build keeps the limit that spawned() gives it, of which the longest is limitWithASAN, unless less than that is left.
            spawned(
              [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"],
              folder,
              env,
              left < limitWithASAN ? left : undefined,
            ),
            // `bun run` asks nothing of the build, so it runs beside it.
            shownInTerminal([bunExe(), "app.ts"], folder, endsBy),
          ]);
          expect(plain).toEqual({ exitCode: 0, ...underBunRun, signal: null });
          built(build);
          expect(await shownInTerminal([join(folder, "app")], folder, endsBy)).toEqual({
            shown,
            exitCode,
            signal: null,
          });
        });
      },
      limitOfATest,
    );
  }
});
