import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A suspended generator holds what it will still read, and nothing else. Plain Bun holds more: what a name of an arm or of an earlier turn held stays in its frame.
// So these programs cannot be held to `bun <file>`, as the stored ones are: what the executable prints is judged by itself.
const files = {
  // An arm of a turn makes a value, waits, reads it for the last time and goes on with the next turn.
  "on-the-way-back.mjs": `const later = value => new Promise(resolve => setTimeout(resolve, 0, value));
const ofArms = [], ofTurns = [], out = [];
const make = (list, n) => { const made = { n, fill: new Array(300).fill(n) }; list.push(new WeakRef(made)); return made; };
async function* events() { for (let i = 0; ; i++) yield i; }
async function* awaited(inner, index) {
  let sum = 0;
  for await (const x of inner) {
    if (x === 1) { const held = make(ofArms, index); await null; sum += held.n; continue; }
    if (x === 2) { const first = make(ofArms, index), second = make(ofArms, index + 1); await null; sum += first.n; await null; sum += second.n; continue; }
    const kept = make(ofTurns, x);
    yield sum + kept.n;
    sum += kept.fill.length;
  }
}
function* plainly(index) {
  let sum = 0;
  for (let x = 0; ; x++) {
    if (x === 1) { const held = make(ofArms, index); yield -1; sum += held.n; continue; }
    for (let inner = 0; inner < 2; inner++) {
      if (x === 2) { const held = make(ofArms, index); yield -2; sum += held.n; continue; }
      yield sum + inner;
    }
  }
}
const suspended = [];
for (let index = 0; index < 40; index++) {
  const a = awaited(events(), index), p = plainly(index);
  for (let step = 0; step < 3; step++) out.push((await a.next()).value);
  for (let step = 0; step < 9; step++) out.push(p.next().value);
  suspended.push(a, p);
}
for (let round = 0; round < 6; round++) { Bun.gc(true); await later(0); }
const alive = list => list.filter(ref => ref.deref() !== undefined).length;
console.log("of what the arms held", alive(ofArms) <= ofArms.length / 10 ? "few" : "many: " + alive(ofArms) + " of " + ofArms.length, "are left;", suspended.length, "are suspended");
console.log(out.slice(0, 12).join(","), out.reduce((a, b) => a + b, 0));
`,
  // A read throws in front of the place where the compiler lets go of a value, and the handler goes on to the next yield.
  "a-throw-in-front-of-letting-go.mjs": `import { heapStats } from "bun:jsc";
const views = () => { Bun.gc(true); Bun.gc(true); return heapStats().objectTypeCounts.DataView ?? 0; };
const make = n => ({ n, view: new DataView(new ArrayBuffer(8)) });
const word = count => count >= 40 ? "most" : count <= 10 ? "few" : String(count);
let sum = 0;
function* holder(inTry, probe, n) {
  let big = make(n);
  yield 1;
  if (inTry) {
    try { let a = big; sum += a.n + probe.n; a = null; sum += 1; } catch (error) { sum += 1000; }
  } else { let b = big; sum += b.n; b = null; sum += 1; }
  yield 2;
  yield 3;
  return n;
}
const [none, some, yes] = JSON.parse('[null,{"n":0},true]');
const kept = [];
const drive = probe => { for (let n = 0; n < 50; n++) { const it = holder(yes, probe, 1); it.next(); it.next(); kept.push(it); } };
const base = views();
drive(none); const thrown = views() - base;
drive(some); const passed = views() - base - thrown;
let ends = 0; for (const it of kept) { it.next(); ends += it.next().value; }
console.log("thrown", word(thrown), "passed", word(passed), sum, ends);
`,
};

async function printedBy(file: string) {
  using dir = tempDir("aot-what-a-suspended-generator-let-go-of", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", file, "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const ran = await run([executable], String(dir));
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return ran.stdout.trim().split("\n");
}

test("what an arm held that went on with the next turn is collected while the generator is suspended in a later turn", async () => {
  expect(await printedBy("on-the-way-back.mjs")).toEqual([
    "of what the arms held few are left; 80 are suspended",
    "0,304,605,0,1,-1,-2,-2,0,1,0,1 50320",
  ]);
}, 240_000);

test("what was let go of behind a read that threw is collected as where the read passed", async () => {
  expect(await printedBy("a-throw-in-front-of-letting-go.mjs")).toEqual(["thrown few passed few 50100 100"]);
}, 240_000);
