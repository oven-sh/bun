// repeats.ts <binaries> <target> <bytes> <variants, e.g. 0,1,2> [jobs]: not fuzzing: every word of the target's dictionary, and
// every pair of an opening word and what closes it, over and over until the text has <bytes> bytes: on its own, with a blank and
// with a line break in between, and n of the first followed by n of the second. That is what nests without end or takes quadratic time in
// a careless parser or printer. Prints the inputs on which the process dies or that take longer than a second, with the time
// at half the size: twice as long is linear, four times is quadratic.
// With COMMAND="<a release build of bun> format --check" and NAMES=a.html,a.vue,.. (one for each variant) that command is run on a file
// of that name in the place of the fuzzer, which is many times slower than Bun. SLOW_MS: what counts as slow, 1000 unless set.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [binaries, target, bytes, variants, jobs = "8"] = process.argv.slice(2);
const dictionary = target == "lint" || target == "parser" ? "js" : target == "md" ? "markdown" : target;
const words = readFileSync(join(import.meta.dir, "dictionaries", dictionary + ".dict"), "latin1")
  .split("\n")
  .filter(line => line.startsWith('"'))
  .map(line => Buffer.from(line.slice(1, -1).replace(/\\x([0-9a-f]{2})|\\(.)/g, (_, hex, c) => (hex ? String.fromCharCode(parseInt(hex, 16)) : c)), "latin1"));
const CLOSERS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^<([a-zA-Z][\w:.-]*)[^>]*>$/, m => `</${m[1]}>`],
  [/^\{\{#([\w-]+).*$/, m => `{{/${m[1]}}}`],
  [/^[([{]$/, m => ({ "(": ")", "[": "]", "{": "}" })[m[0]]!],
  [/\{$/, () => "}"],
  [/\($/, () => ")"],
];

function repeated(unit: Buffer, size: number) {
  return Buffer.alloc(Math.max(unit.length, size - (size % unit.length)), unit);
}
type Shape = { name: string; make: (size: number) => Buffer };
const shapes: Shape[] = [];
for (const word of words) {
  const name = JSON.stringify(word.toString("latin1"));
  shapes.push({ name, make: size => repeated(word, size) });
  shapes.push({ name: name + " blank", make: size => repeated(Buffer.concat([word, Buffer.from(" ")]), size) });
  shapes.push({ name: name + " line", make: size => repeated(Buffer.concat([word, Buffer.from("\n")]), size) });
  shapes.push({ name: name + " a", make: size => repeated(Buffer.concat([word, Buffer.from("a")]), size) });
  for (const [pattern, closer] of CLOSERS) {
    const match = pattern.exec(word.toString("latin1"));
    if (!match) continue;
    const close = Buffer.from(closer(match), "latin1");
    const share = (size: number, part: Buffer) => Math.floor((size * part.length) / (word.length + close.length));
    shapes.push({ name: `${name} n times, then its end n times`, make: size => Buffer.concat([repeated(word, share(size, word)), repeated(close, share(size, close))]) });
    shapes.push({ name: `${name} n times, a, then its end n times`, make: size => Buffer.concat([repeated(word, share(size, word)), Buffer.from("a"), repeated(close, share(size, close))]) });
    break;
  }
}

const directory = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "repeats-"));
const { COMMAND, NAMES = "", SLOW_MS = "1000" } = process.env;
function run(variant: number, shape: Shape, size: number, slot: number) {
  const path = COMMAND ? join(directory, `${slot}-${NAMES.split(",")[variant]}`) : join(directory, String(slot));
  const header = Buffer.alloc(COMMAND ? 0 : 10);
  if (!COMMAND) header[0] = variant;
  writeFileSync(path, Buffer.concat([header, shape.make(size)]));
  const script = COMMAND
    ? `ulimit -c 0; ulimit -v 8000000; exec timeout 20 ${COMMAND} "$1"`
    : `ulimit -c 0; ulimit -s 4096; exec "$0" -timeout=20 -rss_limit_mb=4096 -malloc_limit_mb=2048 "$1"`;
  return new Promise<{ ms: number; died: string }>(done => {
    const began = performance.now();
    const child = spawn("/bin/sh", ["-c", script, join(binaries, `fuzz_${target}`), path], {
      env: { ...process.env, FUZZ_FINDINGS: join(directory, "findings"), FUZZ_SLOW_MS: "100000", ASAN_OPTIONS: "detect_leaks=0:detect_stack_use_after_return=0:allocator_may_return_null=1" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", data => (errors = (errors + data).slice(-20000)));
    child.on("close", (code, signal) => {
      const why = /ERROR: (AddressSanitizer: [\w-]+|libFuzzer: [\w- ]+)/.exec(errors)?.[1] ?? `${signal ?? code}`;
      // The exit codes of `bun format --check`: 1: not formatted, 2: a syntax error.
      done({ ms: performance.now() - began, died: code == 0 || (COMMAND && (code == 1 || code == 2)) ? "" : why });
    });
  });
}

const all = variants.split(",").flatMap(variant => shapes.map(shape => ({ variant: Number(variant), shape })));
let next = 0;
const found = { died: 0, slow: 0 };
await Promise.all(
  Array.from({ length: Number(jobs) }, async (_, slot) => {
    while (next < all.length) {
      const { variant, shape } = all[next++];
      const whole = await run(variant, shape, Number(bytes), slot);
      if (!whole.died && whole.ms < Number(SLOW_MS)) continue;
      const half = await run(variant, shape, Number(bytes) >> 1, slot);
      found[whole.died ? "died" : "slow"]++;
      console.log(`${target} variant ${variant}\t${whole.died || "slow"}\t${Math.round(whole.ms)} ms\thalf: ${half.died || Math.round(half.ms) + " ms"}\t${shape.name}`);
    }
  }),
);
// What panics is not fatal to the process.
console.log(`${all.length} inputs of ${bytes} bytes: ${found.died} end the process, ${found.slow} take more than ${SLOW_MS} ms`);
try {
  const panics = Bun.spawnSync(["find", join(directory, "findings"), "-name", "*.info"]).stdout.toString().trim();
  if (panics) console.log("findings:\n" + panics.split("\n").map(path => path.slice(directory.length + 10) + ": " + readFileSync(path, "utf8").trim().split("\n").slice(0, 2).join(" | ")).join("\n"));
} catch {}
rmSync(directory, { recursive: true, force: true });
