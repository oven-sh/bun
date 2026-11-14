// Runs alone: each program is started with little memory, and it asks for a gigabyte.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// A loop that reads the characters of a rope flattens it. Where memory does not suffice for that, the error is thrown by the read: whoever catches it sees all that the loop has done before,
// and nothing is thrown by a loop that fails otherwise before it reads.
const program = `const unit = "a".repeat(1 << 20);
function rope() { let s = unit; for (let i = 0; i < 10; i++) s = s + s; return s; }
const which = process.argv[2];
let effects = 0, h = 0;
const box = { n: 0 }, list = [], map = new Map(), odd = { valueOf() { effects++; return 3; } };
class Reader { pos = 0; constructor(text) { this.text = text; } all() { let n = 0; while (this.pos < this.text.length) n += this.text.charCodeAt(this.pos++); return n; } }
let reader;
const forms = {
  first: x => { const text = String(x); let n = 0; for (let i = 0; i < text.length; i++) n += text.charCodeAt(i); return n; },
  variable: x => { const text = String(x); let n = 0; for (let i = 0; i < text.length; i++) { effects++; n += text.charCodeAt(i); } return n; },
  field: x => { const text = String(x); let n = 0; for (let i = 0; i < text.length; i++) { box.n++; n += text.charCodeAt(i); } return n; },
  pushed: x => { const text = String(x); let n = 0; for (let i = 0; i < text.length; i++) { list.push(i); n += text.charCodeAt(i); } return n; },
  mapped: x => { const text = String(x); let n = 0; for (let i = 0; i < text.length; i++) { map.set(i, i); n += text.charCodeAt(i); } return n; },
  called: x => { const text = String(x); let n = 0; const f = () => { effects++; return 1; }; for (let i = 0; i < text.length; i++) n += f() * text.charCodeAt(i); return n; },
  sum: x => { const text = String(x); let n = odd; for (let i = 0; i < text.length; i++) n = (n * 2 + text.charCodeAt(i)) | 0; return n; },
  nullish: x => { const text = String(x), o = globalThis.none; let n = 0; for (let i = 0; i < text.length; i++) n += o.field + text.charCodeAt(i); return n; },
  around: x => { const text = String(x); let n = 0; for (const w of ["p", "q"]) { list.push(w); for (let i = 0; i < text.length; i++) n += text.charCodeAt(i); } return n; },
  later: x => { const text = String(x); let n = 0; for (let k = 0; k < 3; k++) { if (k === 2) { for (let i = 0; i < text.length; i++) n += text.charCodeAt(i); } else effects++; } return n; },
  skipped: x => { const text = String(x); let n = 0; for (let k = 0; k < 3; k++) { if (k < 2) { effects++; continue; } for (let i = 0; i < text.length; i++) n += text.charCodeAt(i); } return n; },
  behindBranch: x => { const text = String(x); let n = 0; for (let i = 0; i < text.length; i++) { if (i >= 5) n += text.charCodeAt(i); else effects++; } return n; },
  listed: x => { const text = String(x); let n = 0; for (const w of ["p", "q", "r"]) { if (w !== "r") list.push(w); else for (let i = 0; i < text.length; i++) n += text.charCodeAt(i); } return n; },
  header: x => { const text = String(x); let i = 0, n = 0; while (box.n > 5 && i < text.length) n += text.charCodeAt(i++); effects++; return n; },
  method: x => { reader = new Reader(String(x)); return reader.all(); },
  argument: x => { const text = String(x); let n = 0; for (let i = 0; i < text.length; i++) n += text.charCodeAt((effects++, i)); return n; },
  handled: x => { const text = String(x); let n = 0; try { for (let i = 0; i < text.length; i++) { box.n++; n += text.charCodeAt(i); } } catch (e) { return "handler " + e.name + box.n; } return n; },
  handledSum: x => { const text = String(x); let n = odd; try { for (let i = 0; i < text.length; i++) n = (Math.imul(n, 31) + text.charCodeAt(i)) | 0; } catch (e) { return "handler " + e.name + effects; } return n; },
  handledHash: x => { const text = String(x); h = 7; try { for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0; } catch (e) { return "handler " + e.name + h; } return h; },
};
let r;
try { r = forms[which](rope()); } catch (e) { r = "caught " + e.name; }
console.log(which, r, effects, box.n, list.length, map.size, reader?.pos);
`;

const withLittleMemory = ["/bin/sh", "-c", `ulimit -d 900000; exec "$@"`, "--"];

describe.skipIf(!isLinux || isASAN || isDebug)("out of memory comes at the read of a rope", () => {
  test("a compiled program has done what plain Bun has done", async () => {
    using dir = tempDir("aot-out-of-memory-of-ropes", { "ropes.mjs": program });
    const executable = join(String(dir), "ropes");
    await using built = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "./ropes.mjs", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [problems, builtWith] = await Promise.all([built.stderr.text(), built.exited]);
    expect({ errors: problems.split("\n").filter(line => line.startsWith("error")), builtWith }).toEqual({
      errors: [],
      builtWith: 0,
    });

    const run = async (cmd: string[]) => {
      await using started = Bun.spawn({
        cmd: [...withLittleMemory, ...cmd],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "ignore",
      });
      const [stdout] = await Promise.all([started.stdout.text(), started.exited]);
      return stdout;
    };
    const shapes = [...program.matchAll(/^  (\w+): x =>/gm)].map(shape => shape[1]);
    const [compiled, plain] = await Promise.all([
      Promise.all(shapes.map(shape => run([executable, shape]))),
      Promise.all(shapes.map(shape => run([bunExe(), "ropes.mjs", shape]))),
    ]);
    expect(compiled).toEqual(plain);
  });
});
