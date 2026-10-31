// ./let-values-be-something-else.ts writes no program without an end: where something else comes in the place of a value, the program still ends.
import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { list, read, write } from "./let-values-be-something-else";

const program = `const seen = [];
for (let i = 0; i < 3; i++) seen.push(i);
let left = 3;
while (left) left = left - 1;
let missing = 0;
for (let turn = 0; turn < Infinity; turn++) {
  const found = seen[turn];
  if (found === undefined) missing++;
  if (missing > 2) break;
}
const counted = {
  [Symbol.iterator]() {
    let at = 0;
    return { next: () => (at < 2 ? { done: false, value: at++ } : { done: true, value: undefined }) };
  },
};
for (const value of counted) seen.push(value);
function down(n, sum) {
  if (n === 0) return sum;
  return down(n - 1, sum + n);
}
seen.push(down(3, 0));
seen.push(await new Promise(resolve => setTimeout(resolve, 1, "timer")));
seen.push(
  await new Promise(resolve => {
    const finish = () => resolve("function");
    queueMicrotask(finish);
  }),
);
seen.push(await { then(settle) { settle("then"); } });
const racers = [Promise.resolve("race")];
seen.push(await Promise.race(racers));
const waiting = new Map();
const log = [];
function arrive(id, value) {
  const entry = waiting.get(id);
  waiting.delete(id);
  log.push(id);
  entry.resolve(value);
}
seen.push(
  await new Promise((resolve, reject) => {
    waiting.set(1, { resolve, reject });
    queueMicrotask(() => arrive(1, "map"));
  }),
);
class Swapped extends Promise {
  constructor(executor) {
    super((resolve, reject) => executor(() => resolve("species"), reject));
  }
}
const first = Promise.resolve(0);
first.constructor = { [Symbol.species]: Swapped };
seen.push(await first.then(() => 1));
const target = new EventTarget();
const heard = new Promise(resolve => target.addEventListener("done", resolve, { once: true }));
target.dispatchEvent(new Event("done"));
seen.push((await heard).type);
const stream = new ReadableStream({
  pull(controller) {
    controller.enqueue("stream");
    controller.close();
  },
});
for await (const chunk of stream) seen.push(chunk);
console.log(seen.join());
`;

test("what the value did is still done where something else comes", () => {
  const file = read("program.mjs", "finish(1);\n");
  expect(write(file, "comes@0-9=2")).toBe(";(process.argv.length > 5 ? finish(1) : (void (finish(1)), []));\n");
});

test("wraps no function or class expression in an object or array literal", () => {
  const text =
    "exports.arrow = () => {};\nexports.plain = function () {};\nexports.made = class {};\nexports.read = kept;\n";
  const variants = list(read("program.cjs", text));
  const formsOf = (written: string) => {
    const where = `@${text.indexOf(written)}-${text.indexOf(written) + written.length}`;
    return variants.filter(variant => variant.split("=")[0].endsWith(where)).map(variant => variant.split("@")[0]);
  };
  for (const written of ["() => {}", "function () {}", "class {}"]) {
    expect(formsOf(written)).toContain("parameter");
    expect(formsOf(written)).not.toContain("field");
    expect(formsOf(written)).not.toContain("element");
  }
  expect(formsOf("kept")).toContain("field");
  expect(formsOf("kept")).toContain("element");
});

test("leaves the function that a file marked as CommonJS consists of in its place", () => {
  const wrapper = "function(exports, require, module, __filename, __dirname) {exports.made = function () {};\n}";
  const placesIn = (text: string) => list(read("bundle.cjs", text)).map(variant => /@(\d+)-/.exec(variant)![1]);
  const marked = `// @bun @bun-cjs\n(${wrapper})\n`;
  expect(placesIn(marked)).not.toContain(String(marked.indexOf(wrapper)));
  expect(placesIn(marked)).toContain(String(marked.indexOf("function () {}")));
  expect(placesIn(`(${wrapper})\n`)).toContain("1");
});

test("every program in which something else comes ends", async () => {
  using folder = tempDir("aot-something-else-comes", {});
  const file = read("program.mjs", program);
  const variants = list(file).filter(variant => variant.startsWith("comes@"));
  expect(variants.length).toBeGreaterThan(50);
  const withoutEnd: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: availableParallelism() }, async () => {
      while (next < variants.length) {
        const variant = variants[next++];
        const path = join(String(folder), `${next}.mjs`);
        writeFileSync(path, write(file, variant)!);
        await using proc = Bun.spawn({
          cmd: [bunExe(), "run", path],
          env: bunEnv,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          timeout: 30_000,
          killSignal: "SIGKILL",
        });
        await proc.exited;
        if (proc.signalCode) withoutEnd.push(variant);
      }
    }),
  );
  expect(withoutEnd).toEqual([]);
}, 600_000);
