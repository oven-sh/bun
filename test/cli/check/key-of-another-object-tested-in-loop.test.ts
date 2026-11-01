import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
  },
});

// In a loop, `first` is read for a constant, the constant decides a key, and `text[key] === ..` is tested. The test says
// nothing about `first`, so narrowing `first` past it does not need the type of the key, and nothing refers to itself.
// TypeScript 6 and 7.1 accept all of it. TypeScript 7.0 reports 7022 for the constants.
const source = `export function neverAssigned(text: string, end: number) {
  let first = true;
  while (end < text.length) {
    const mark = !first;
    const at = mark ? 1 : 0;
    if (text[at] === ":") {
    }
  }
}

export function assignedBehindTheLoop(lines: string[], end: number) {
  let first = true;
  let found = 0;
  for (const text of lines) {
    let start = 0;
    while (start < text.length) {
      const mark = !(first && start === 0) && text.charCodeAt(start) === 0xfeff;
      const lineStart = mark ? start + 1 : start;
      const colon = lineStart + end;
      start = colon + 1;
      if (colon === end || text[colon] === ":") {
        found++;
      }
    }
    first = false;
  }
  return found;
}

export function otherTests(record: Record<string, number>, maybe: Record<string, number> | undefined, end: number) {
  let last: string | undefined = "a";
  for (let i = 0; i < end; i++) {
    const has = last !== undefined;
    const key = has ? "a" : "b";
    if (1 == record[key] || maybe?.[key] !== 2) {
    }
  }
}

class A {
  a = 1;
}
class B {
  b = 2;
}

export function constructorStillNarrows(x: A | B, end: number) {
  let sum = 0;
  for (let i = 0; i < end; i++) {
    if (x.constructor === A) sum += x.a;
    if (x["constructor"] === B) sum += x.b;
  }
  return sum;
}
`;

test("a test on a key of another object makes no cycle", async () => {
  using dir = tempDir("check-key-of-another-object", { "tsconfig.json": tsconfig, "keys.ts": source });
  const { stdout, stderr, exitCode } = await run([bunExe(), "check", "./keys.ts"], String(dir));
  expect({ output: exitCode ? stdout + stderr : "", exitCode }).toEqual({ output: "", exitCode: 0 });
});
