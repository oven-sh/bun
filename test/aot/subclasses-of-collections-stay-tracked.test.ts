import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

async function escapedBuiltins(text: string) {
  using dir = tempDir("aot-tracked-collections", { "main.js": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr).split("\n");
  expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
  return lines.flatMap(line => /trim: uses (.*) \(escapes, so any member may be used\)$/.exec(line)?.[1] ?? []);
}

const nothingEscapes = {
  "a subclass of Set passes an iterable to super": `
    class Tags extends Set { constructor(values) { super(values); } }
    console.log(new Tags(["a", "b"]).size);`,
  "a subclass of Map overrides set": `
    class Upper extends Map { set(key, value) { return super.set(key.toUpperCase(), value); } }
    console.log(new Upper([["a", 1]]).get("A"));`,
  "a subclass of WeakSet passes an iterable to super": `
    class Seen extends WeakSet {}
    const key = {};
    console.log(new Seen([key]).has(key));`,
  "a subclass of Set is declared and filled inside a function": `
    function count(values) {
      class Tags extends Set {}
      return new Tags(values).size;
    }
    console.log(count(["a", "b"]));`,
  "a method fills a subclass of Map": `
    class Index extends Map {}
    class Store { build(entries) { return new Index(entries); } }
    console.log(new Store().build([["a", 1]]).get("a"));`,
  "a field holds a filled subclass of Set": `
    class Tags extends Set {}
    class Post { tags = new Tags(["a"]); }
    console.log(new Post().tags.has("a"));`,
};

for (const [what, text] of Object.entries(nothingEscapes))
  test.concurrent(`no built-in escapes when ${what}`, async () => {
    expect(await escapedBuiltins(text)).toEqual([]);
  });
