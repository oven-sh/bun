import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { eachRow, gap, test } from "./supported";

// Bun's library has places with two ways, one for compiled code (IS_COMPILED_AHEAD_OF_TIME, the second texts of src/js/ahead-of-time). A test may replace a
// built-in function or lay a name on Object.prototype, so in a test run it can tell which built-ins the library calls and which names it asks an object for.
const folder = join(import.meta.dir, "built-ins-that-the-library-calls");
const readOffObjectPrototype = "read off Object.prototype: ";

// The deeds of deeds.fixture.js, one case each.
const deeds = [
  "an emitter is made, listened to and emits",
  "an emitter that captures rejections",
  "a readable is made and read",
  "a writable is written and ended",
  "a transform passes a chunk on",
  "a tick under a hook",
  "a file is written through a stream",
];
// What is owed, by the name of what is counted. Whatever else parts in such a deed is red.
const owed: Record<string, { names: string[]; why: string }> = {
  "a file is written through a stream": {
    names: ["Function.prototype.bind"],
    why: "a wrong answer today: under `bun test --aot` the modules that load with the first stream of node:fs call bind 6 times, where `bun test` calls it 28 times",
  },
};

async function take(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", "--timeout=60000", ...flags, "./deeds.test.js"],
    directory,
    bunEnv,
  );
  if (exitCode !== 0) console.error(stderr);
  expect(exitCode).toBe(0);
  const refused = new Set<string>();
  const counted = new Map<string, Map<string, number>>();
  let deed: Map<string, number> | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("refused: ")) refused.add(line.slice("refused: ".length));
    else if (line.startsWith("== ")) counted.set(line.slice(3), (deed = new Map()));
    else if (deed && /.+ \d+$/.test(line))
      deed.set(line.slice(0, line.lastIndexOf(" ")), Number(line.slice(line.lastIndexOf(" ") + 1)));
  }
  return { refused, counted };
}

async function takeBoth() {
  using dir = tempDir("built-ins-that-the-library-calls", {
    "count.js": await Bun.file(join(folder, "count.fixture.js")).text(),
    "deeds.test.js": await Bun.file(join(folder, "deeds.fixture.js")).text(),
  });
  return { plain: await take(String(dir)), compiled: await take(String(dir), "--aot") };
}
let taken: ReturnType<typeof takeBoth> | undefined;
const both = () => (taken ??= takeBoth());

test("every deed is asked, and what is owed is a deed", async () => {
  const { plain, compiled } = await both();
  expect(plain.refused.size).toBe(0);
  expect([...plain.counted.keys()]).toEqual(deeds);
  expect([...compiled.counted.keys()]).toEqual(deeds);
  expect(Object.keys(owed).filter(label => !deeds.includes(label))).toEqual([]);
});

eachRow(deeds.map(label => (label in owed ? gap(owed[label].why, [label] as const) : ([label] as const))))(
  "the library calls the same built-ins and asks for the same names compiled as plain: %s",
  async label => {
    const { plain, compiled } = await both();
    const [inPlain, inCompiled] = [plain.counted.get(label)!, compiled.counted.get(label)!];
    const differences = new Map<string, string>();
    for (const name of new Set([...inPlain.keys(), ...inCompiled.keys()])) {
      // What a compiled test run lets no test replace, no test can watch.
      if (compiled.refused.has(name)) continue;
      let [before, after] = [inPlain.get(name) ?? 0, inCompiled.get(name) ?? 0];
      // How often the library asks an object for a name is no promise. Whether it asks at all is: a name that a test lays on Object.prototype changes the answer.
      // No fault, so a deed that serves a request by node:http passes over them: the compiled text makes no object of options for a request, so what a Readable
      // asks of its options (objectMode, emitClose, autoDestroy, defaultEncoding, encoding, read, destroy, construct, signal, captureRejections) is not asked there.
      if (name.startsWith(readOffObjectPrototype)) [before, after] = [Math.min(before, 1), Math.min(after, 1)];
      if (before !== after) differences.set(name, `plain ${before}, compiled ${after}`);
    }
    // A deed that touches nothing holds nothing.
    const isCounted = inPlain.size > 0 && inCompiled.size > 0;
    // Only these names are owed: a case in which others part, or none, ends well, which is red.
    if (label in owed && !(isCounted && Bun.deepEquals([...differences.keys()].sort(), owed[label].names))) {
      console.error(label, "parts otherwise than what is owed says:", Object.fromEntries(differences));
      return;
    }
    expect(isCounted).toBe(true);
    expect(Object.fromEntries(differences)).toEqual({});
  },
);
