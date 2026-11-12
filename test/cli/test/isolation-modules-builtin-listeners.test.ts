import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";

// Under `bun test --isolate=modules` every test file runs with one `process` and one copy of each built-in module, and the
// listeners that a file leaves on `process` are removed before the next file. These are about a listener that a built-in
// adds for itself. test/internal/source-lints/process-listeners-of-builtins.test.ts says what a built-in does with one.

// Every test waits for a whole `bun test`, which takes seconds in a debug build.
setDefaultTimeout(isASAN ? 120_000 : 30_000);

async function run(files: Record<string, string>, flag = "--isolate=modules") {
  using dir = tempDir("isolate-modules-listeners", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", flag, ...Object.keys(files).map(name => "./" + name)],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent(
  "process.finalization drops what a finished file registered, and listens again for the next file",
  async () => {
    const file = (name: string, last = "") => `
    const atLoad = [process.listenerCount("exit"), process.listenerCount("beforeExit")];
    test("${name}", () => {
      const ran = [];
      process.finalization.register(process, (_, event) => ran.push("${name} " + event));
      process.finalization.registerBeforeExit(process, (_, event) => ran.push("${name} " + event));
      const registered = [process.listenerCount("exit"), process.listenerCount("beforeExit")];
      process.emit("beforeExit", 0);
      process.emit("exit", 0);
      console.log(JSON.stringify([atLoad, registered, ran]));
      // Still registered when the file ends.
      process.finalization.register(process, () => console.log("${name} ran in a later file"));
      ${last}
    });
  `;
    const { stdout, stderr, exitCode } = await run({
      "a.test.js": file("a"),
      // This file takes the two listeners away itself.
      "b.test.js": file("b", `process.removeAllListeners("exit"); process.removeAllListeners("beforeExit");`),
      "c.test.js": file("c"),
      // In this file they are never added.
      "d.test.js": `test("d", () => {
      process.on = () => { throw new Error("not added"); };
      expect(() => process.finalization.register(process, () => {})).toThrow("not added");
    });`,
      "e.test.js": file("e"),
    });
    expect(stderr).toContain(" 5 pass\n 0 fail\n");
    // The counts at load, the counts with something registered, and what ran.
    expect(stdout.split("\n").filter(line => line.startsWith("["))).toEqual(
      ["a", "b", "c", "e"].map(name => `[[0,0],[1,1],["${name} beforeExit","${name} exit"]]`),
    );
    expect(stdout).not.toContain("ran in a later file");
    expect(exitCode).toBe(0);
  },
);

// A run that uses node:test emits "exit" when it ends.
test.concurrent.each(["--isolate", "--isolate=modules"])(
  "%s: what the last file registered with process.finalization runs when a node:test run ends",
  async flag => {
    const file = (name: string) => `
      import { test } from "node:test";
      process.on("exit", () => console.log("${name} exit listener"));
      test("${name}", () => {
        process.finalization.register(process, () => console.log("${name} finalization"));
      });
    `;
    const { stdout, stderr, exitCode } = await run(
      { "a.test.js": file("a"), "b.test.js": file("b"), "c.test.js": file("c") },
      flag,
    );
    expect(stderr).toContain(" 3 pass\n 0 fail\n");
    expect(stdout.split("\n").filter(line => / (exit listener|finalization)$/.test(line))).toEqual([
      "c exit listener",
      "c finalization",
    ]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("what a finished file registered with process.finalization is released", async () => {
  // The exports of a built-in module are the same object in every file.
  const file = (name: string) => `
    import fs from "node:fs";
    test("${name}", () => {
      const held = { name: "${name}" };
      (fs.heldByFiles ??= []).push(new WeakRef(held));
      process.finalization.register(process, () => held);
      Bun.gc(true);
      console.log("held:", fs.heldByFiles.filter(ref => ref.deref()).length);
    });
  `;
  const names = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, "0")}.test.js`);
  const { stdout, stderr, exitCode } = await run(Object.fromEntries(names.map(name => [name, file(name)])));
  expect(stderr).toContain(" 12 pass\n 0 fail\n");
  const held = stdout
    .split("\n")
    .filter(line => line.startsWith("held: "))
    .map(line => Number(line.slice(6)));
  expect(held).toHaveLength(12);
  // The object of the running file, and none that the collector has yet to visit twice. Every file's own stays otherwise: 12.
  expect(held.at(-1)).toBeLessThan(4);
  expect(exitCode).toBe(0);
});

test
  .skipIf(isWindows)
  .concurrent("process.stdout and process.stderr follow the size of their terminal in every file", async () => {
    const file = (name: string, first = "", last = "") => `
      const atLoad = process.listenerCount("SIGWINCH");
      test("${name}", async () => {
        ${first}
        const sizes = () => process.stdout.columns + " " + process.stderr.columns;
        const resized = new Promise(resolve => process.stdout.once("resize", resolve));
        // The file's own, beside the two of the streams.
        process.on("SIGWINCH", () => {});
        console.log("${name} is ready:", atLoad, process.listenerCount("SIGWINCH"), sizes());
        await resized;
        console.log("${name} sees", sizes());
        ${last}
      });
    `;
    using dir = tempDir("isolate-modules-terminal", {
      // The streams are first read while the global \`process\` is another object, which has no on().
      "a.test.js": file(
        "a",
        `const real = process;
        globalThis.process = Object.create(real, { on: { value: undefined } });
        try { real.stdout; real.stderr; } finally { globalThis.process = real; }`,
      ),
      "b.test.js": file("b"),
      // A file that removes the listener of a stream takes it from the files after it.
      "c.test.js": file("c", "", `process.removeAllListeners("SIGWINCH");`),
      "d.test.js": `test("d", () => { console.log("d starts with", process.listenerCount("SIGWINCH")); });`,
    });
    const decoder = new TextDecoder();
    let shown = "";
    let resizes = 0;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate=modules", "./a.test.js", "./b.test.js", "./c.test.js", "./d.test.js"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      terminal: {
        cols: 80,
        rows: 24,
        data(terminal, chunk) {
          shown += decoder.decode(chunk, { stream: true });
          // Each test waits for a resize of its own.
          if (shown.split(" is ready: ").length - 1 > resizes) terminal.resize(80 + 10 * ++resizes, 24);
        },
      },
    });
    const exitCode = await proc.exited;
    // The listeners at load and with the file's own, then the columns of the two streams.
    expect(Bun.stripANSI(shown).match(/[abcd] (?:is ready:|sees|starts with) [\d ]*\d/g)).toEqual([
      "a is ready: 0 3 80 80",
      "a sees 90 90",
      "b is ready: 2 3 90 90",
      "b sees 100 100",
      "c is ready: 2 3 100 100",
      "c sees 110 110",
      "d starts with 0",
    ]);
    expect(exitCode).toBe(0);
  });
