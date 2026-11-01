// TS100031 ends with "Write '..'". Whoever does that, by hand or by a script, gets a program that builds and prints what the
// program printed before, as long as its numbers stay int32: `A[top++] = x` still stores at the old `top`, and `++i * 3` is
// still a product. Every form of the advice stands here, each where the words around it matter.
import { expect } from "bun:test";
import { afterAll } from "./harness/declare";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned, withoutDebugInformation } from "./harness/commands";
import { describe, test } from "./supported";

const head = `import type { int32 } from "bun";\n`;
const programs: Record<string, string> = {
  "steps whose value is used": `
const A: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
let top: int32 = 0;
function push(x: number): void {
  A[top++] = x;
}
function pop(): number {
  return A[--top]!;
}
function drop(): number {
  return A[top--]! + A[++top]!;
}
push(5);
push(6);
push(7);
console.log(A.join(), top, drop(), pop(), pop(), top);
`,
  "steps among operators": `
function mixed(n: int32): string {
  let i: int32 = n;
  const seen: number[] = [];
  seen.push(i++ * 2, ++i * 3, -i--, - --i, i-- < 3 ? 10 : 20, i++ ? 1 : 2, i++ + i++, 2 ** i--, typeof i++ === "number" ? i : 0);
  const kept = i++;
  const list = [i++, ++i, i--, --i];
  const text = \`\${i++}-\${--i}\`;
  const chosen = n > 2 ? i++ : --i;
  const both = (i++, i--);
  const inParentheses = (i++) * 2 + (--i) * 2;
  const asNumber = (i++ as number) + (i--)!;
  return [seen, kept, list, text, chosen, both, inParentheses, asNumber, i].join();
}
console.log(mixed(1), mixed(40), mixed(-7));
`,
  "steps whose value is dropped": `
function counted(n: int32): number {
  let i: int32 = 0;
  let j: int32 = n;
  i++;
  --j;
  for (let k: int32 = 0; k < 3; k++, j--) i++;
  for (let k: int32 = 3; k > 0; --k) void i++;
  i++, j++;
  return i * 1000 + j;
}
console.log(counted(5), counted(-5));
`,
  "steps of members": `
class Stack {
  top: int32 = 0;
  items: number[] = [0, 0, 0, 0];
  push(x: number): void {
    this.items[this.top++] = x;
  }
  pop(): number {
    return this.items[--this.top]!;
  }
}
const stack = new Stack();
const cursors: { at: int32 }[] = [{ at: 1 }];
stack.push(3);
stack.push(4);
console.log(stack.pop(), stack.top, cursors[0]!.at++ * 2, cursors[0]!.at, stack.items.join());
`,
  "assignments with an operator": `
function folded(a: int32, b: int32): string {
  let x: int32 = a;
  const seen: number[] = [];
  x += b;
  seen.push(x);
  x -= b + 1;
  seen.push(x);
  x *= b;
  seen.push(x);
  x *= b + 1, seen.push(x);
  x /= 1;
  x %= 1000;
  x **= 1;
  seen.push((x += 2) * 2, x);
  const kept = (x -= 1);
  return [seen, kept, x].join();
}
console.log(folded(6, 3), folded(100, 7));
`,
  "values that are stored, passed and returned": `
function half(n: int32): int32 {
  return n / 2;
}
function product(a: int32, b: int32): int32 {
  return a * b;
}
function sum(a: int32, b: int32): int32 {
  return a + b;
}
function chosen(flag: boolean, a: int32, b: int32): int32 {
  return flag ? a + b : a - b;
}
function read(list: number[], at: int32): int32 {
  const found: int32 = list[at]!;
  return found;
}
const loose: any = 12;
const fromAny: int32 = loose;
const negated: int32 = -fromAny;
const asserted = (fromAny + negated) as int32;
const holder: { count: int32 } = { count: fromAny * 2 };
holder.count = holder.count + 1;
console.log(half(8), product(6, 7), sum(half(4 + 4), 3 * 3), chosen(true, 1, 2), chosen(false, 1, 2), read([4, 5], 1), fromAny, negated, asserted, holder.count);
`,
};

const said = /^error: TS100031: .* but '(.*)' might not be an int32: .*\. Write '(.*)'\.\n +at (.*):(\d+):(\d+)$/gm;

function rewritten(text: string, stderr: string): { text: string; count: number } {
  const lines = text.split("\n");
  const startOfLine = [0];
  for (const line of lines) startOfLine.push(startOfLine.at(-1)! + line.length + 1);
  const edits = [...stderr.matchAll(said)].map(([, old, advice, , line, column]) => ({
    start: startOfLine[Number(line) - 1]! + Number(column) - 1,
    old: old!,
    advice: advice!,
  }));
  edits.sort((a, b) => b.start - a.start);
  for (const { start, old, advice } of edits) {
    expect(text.slice(start, start + old.length)).toBe(old);
    text = text.slice(0, start) + advice + text.slice(start + old.length);
  }
  return { text, count: edits.length };
}

describe("compile/aot/what an int32 error says to write keeps the program", () => {
  const folder = String(tempDir("aot-int32-advice", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test.concurrent.each(Object.keys(programs))("%s", async name => {
    const stem = name.replaceAll(" ", "-");
    const [before, after] = [join(folder, `${stem}.ts`), join(folder, `${stem}-rewritten.ts`)];
    const executable = join(folder, stem + (isWindows ? ".exe" : ""));
    const build = (file: string) =>
      spawned(
        [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), file, "--outfile", executable],
        folder,
        bunEnv,
      );
    writeFileSync(before, head + programs[name]);
    const plain = await spawned([bunExe(), before], folder, bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const refused = await build(before);
    expect(refused.exitCode).not.toBe(0);
    const { text, count } = rewritten(head + programs[name], refused.stderr);
    expect(count).toBe(refused.stderr.match(/^error: /gm)!.length);
    writeFileSync(after, text);

    const accepted = await build(after);
    expect({ text, stderr: accepted.stderr, exitCode: accepted.exitCode }).toEqual({ text, stderr: "", exitCode: 0 });
    const [compiled, interpreted] = [
      await spawned([executable], folder, bunEnv),
      await spawned([bunExe(), after], folder, bunEnv),
    ];
    expect({ text, compiled: compiled.stdout, interpreted: interpreted.stdout }).toEqual({
      text,
      compiled: plain.stdout,
      interpreted: plain.stdout,
    });
  });
});
