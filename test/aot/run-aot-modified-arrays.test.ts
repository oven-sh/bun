import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const programs = {
  "a-class-that-extends-array-fills-itself.js": `
class ZeroArray extends Array { constructor(size) { super(size); this.fill(0); } }
let sum = 0;
for (let i = 0; i < 300000; i++) { const made = new ZeroArray(8); sum += made.length + made[3]; }
console.log(sum, new ZeroArray(4) instanceof ZeroArray, Object.getPrototypeOf(new ZeroArray(2)) === ZeroArray.prototype);`,
  "methods-of-a-class-that-extends-array.js": `
class Rows extends Array { first() { return this[0]; } }
function make(n) { const rows = new Rows(n); rows[0] = n; return rows.first() + rows.length; }
function mapped(n) { const rows = Rows.of(n, n + 1).map(x => x * 2); return rows.first() + (rows instanceof Rows ? 1 : 0); }
let sum = 0;
for (let i = 0; i < 200000; i++) sum += make(4) + mapped(1);
console.log(sum);`,
  "the-prototype-of-a-fresh-array-is-changed.js": `
const prototype = { __proto__: Array.prototype, x: 7, twice() { return this.length * 2; } };
function literal(p) { const a = [1, 2, 3]; Object.setPrototypeOf(a, p); return a.x + a.length; }
function assigned() { const a = [1, 2, 3]; a.__proto__ = prototype; return a.twice(); }
function sized(n) { const a = new Array(n); Object.setPrototypeOf(a, prototype); return a.twice(); }
function rest(...all) { Object.setPrototypeOf(all, prototype); return all.twice(); }
let sum = 0;
for (let i = 0; i < 200000; i++) sum += literal(prototype) + assigned() + sized(4) + rest(1, 2);
console.log(sum);`,
  "a-fresh-array-gets-an-accessor-at-an-index.js": `
function f(i) { const a = [1, 2, 3]; Object.defineProperty(a, "1", { get() { return 5; }, configurable: true }); a.tag = i; return a.tag + a[1]; }
let sum = 0;
for (let i = 0; i < 300000; i++) sum += f(1);
console.log(sum);`,
  "an-array-that-compiled-code-holds-is-changed-later.js": `
const prototype = Object.create(Array.prototype); prototype.x = 7;
const shared = [1, 2, 3];
const other = [4, 5]; Object.setPrototypeOf(other, prototype);
function read(a) { return a.length + (a.x | 0); }
function both() { return read(shared) + read(other); }
let sum = 0;
for (let i = 0; i < 200000; i++) sum += both();
Object.setPrototypeOf(shared, prototype);
for (let i = 0; i < 200000; i++) sum += both();
console.log(sum);`,
};

async function run(cwd: string, cmd: string[]) {
  await using ran = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr: exitCode ? stderr : "", exitCode, signal: ran.signalCode };
}

test.concurrent.each(Object.keys(programs))(
  "%s answers under bun run --aot and --debug-aot as under plain Bun",
  async name => {
    using dir = tempDir("aot-arrays-not-as-made", programs);
    const plain = await run(String(dir), [bunExe(), "run", name]);
    expect({ exitCode: plain.exitCode, isSilent: plain.stdout === "" }).toEqual({ exitCode: 0, isSilent: false });
    for (const flag of ["--aot", "--debug-aot"])
      expect({ flag, ...(await run(String(dir), [bunExe(), "run", flag, name])) }).toEqual({ flag, ...plain });
  },
  120_000,
);
