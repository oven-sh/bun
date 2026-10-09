// repeats.ts <binaries> <target> <bytes> <variants, e.g. 0,1,2> [jobs]: not fuzzing: every word of the target's dictionary, and
// every pair of an opening word and what closes it, over and over until the text has <bytes> bytes: on its own, with a blank and
// with a line break in between, and n of the first followed by n of the second. That is what nests without end or takes quadratic time in
// a careless parser or printer. Prints the inputs on which the process dies or that take longer than a second, with the time
// at half the size: twice as long is linear, four times is quadratic.
// With COMMAND="<a release build of bun> format --check" and NAMES=a.html,a.vue,.. (one for each variant) that command is run on a file
// of that name in the place of the fuzzer, which is many times slower than Bun. SLOW_MS: what counts as slow, 1000 unless set.
// ONLY="n times": only the inputs whose description has that in it.
// A word that is repeated from the first byte on is often a syntax error at once. nests.json has what nests in a context: the ending of the
// name of the file, what is before, what opens, what is in the middle, what closes, what is after. Those for the target are run too, each as
// the variant that its ending stands for: before + n times what opens + the middle + n times what closes + after.
// PAIRS=1: in the place of all that, every two of them that have the same ending, before and after, in turn: n times (what opens the first, what
// opens the second) .. A recursion through two constructs that neither checks shows at 64 KB; look-ahead in look-ahead, which takes exponential
// time, at 512 bytes: `type X = ` + `({[K in a as ` x 16 + `x` + `]: b})` x 16 took 18 s.
// STACK_KB: the stack, 4096 unless set. With 1024 and the build with AddressSanitizer a recursion that nothing checks shows at a tenth of the size.
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
type Shape = { name: string; make: (size: number) => Buffer; variant?: number; second?: number; ending?: string };
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

/** For each target: the variant (format.rs: `TARGETS`, lint.rs: `VARIANTS`, parser.rs: `PATHS`) for the ending of a name. */
const ENDINGS: Record<string, Record<string, number>> = {
  js: { js: 0, jsx: 1, ts: 2, tsx: 3, mjs: 4, cjs: 5, mts: 6, cts: 7, "d.ts": 8 },
  lint: { js: 0, cjs: 2, jsx: 3, ts: 4, tsx: 5, "d.ts": 6, cts: 7, mts: 8, mjs: 11 },
  parser: { ts: 0, tsx: 1, js: 2, jsx: 3, "d.ts": 4, mts: 5, cts: 6, mjs: 7, cjs: 8 },
  html: { html: 0, vue: 1, "component.html": 2, mjml: 4 },
  css: { css: 0, scss: 1, less: 2 },
  markdown: { md: 0, mdx: 1 },
  md: { md: 0 },
  json: { json: 0, json5: 1, "package.json": 4 },
  yaml: { yaml: 0 },
  graphql: { graphql: 0 },
  handlebars: { hbs: 0 },
};
let nests = JSON.parse(readFileSync(join(import.meta.dir, "nests.json"), "utf8")) as string[][];
// Two kinds in turn.
if (process.env.PAIRS) {
  shapes.length = 0;
  nests = nests.flatMap(([ending, before, open, , close, after]) =>
    nests
      .filter(inner => inner[0] == ending && inner[1] == before && inner[5] == after && inner[2] != open)
      .map(inner => [ending, before, open + inner[2], inner[3], inner[4] + close, after]),
  );
}
for (const [ending, before, open, middle, close, after] of nests) {
  const variant = ENDINGS[target]?.[ending];
  const isFlow = before.includes("@flow");
  if (variant === undefined || (isFlow && target == "lint")) continue;
  // The second byte of an input of `parser` is the dialect: those of tsc and Babel, or the two of Flow.
  for (const second of target != "parser" ? [0] : isFlow ? [4, 5] : [0, 3]) {
    shapes.push({
      name: `${ending}${second ? " dialect " + second : ""}: ${JSON.stringify(before)} + n times ${JSON.stringify(open)} + ${JSON.stringify(middle)} + n times ${JSON.stringify(close)} + ${JSON.stringify(after)}`,
      make: size => Buffer.from(before + open.repeat(Math.floor(size / (open.length + close.length))) + middle + close.repeat(Math.floor(size / (open.length + close.length))) + after + "\n"),
      variant,
      second,
      ending,
    });
  }
}

const directory = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "repeats-"));
const { COMMAND, NAMES = "", SLOW_MS = "1000", ONLY = "", STACK_KB = "4096" } = process.env;
function run(variant: number, shape: Shape, size: number, slot: number) {
  const path = COMMAND ? join(directory, `${slot}-${NAMES.split(",")[variant]}`) : join(directory, String(slot));
  const header = Buffer.alloc(COMMAND ? 0 : 10);
  if (!COMMAND) header[0] = variant;
  if (!COMMAND) header[1] = shape.second ?? 0;
  writeFileSync(path, Buffer.concat([header, shape.make(size)]));
  const script = COMMAND
    ? `ulimit -c 0; ulimit -v 8000000; exec /usr/bin/time -f "CPU %U %S" timeout 20 ${COMMAND} "$1"`
    : `ulimit -c 0; ulimit -s ${STACK_KB}; exec /usr/bin/time -f "CPU %U %S" "$0" -timeout=300 -rss_limit_mb=4096 -malloc_limit_mb=2048 "$1"`;
  return new Promise<{ ms: number; died: string }>(done => {
    const child = spawn("/bin/sh", ["-c", script, join(binaries, `fuzz_${target}`), path], {
      env: { ...process.env, FUZZ_STACK_KB: STACK_KB, FUZZ_FINDINGS: join(directory, "findings"), FUZZ_SLOW_MS: "100000", ASAN_OPTIONS: "detect_leaks=0:detect_stack_use_after_return=0:allocator_may_return_null=1" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", data => (errors = (errors + data).slice(-20000)));
    child.on("close", (code, signal) => {
      const why = /ERROR: (AddressSanitizer: [\w-]+|libFuzzer: [\w- ]+)|(has overflowed its stack|terminated by signal \d+)/.exec(errors)?.slice(1).find(Boolean) ?? `${signal ?? code}`;
      // Processor time, not the time of day: other processes want the processor too. So libFuzzer's own limit, which goes by the clock, is far away.
      const [, user, system] = /CPU ([\d.]+) ([\d.]+)/.exec(errors) ?? [];
      const ms = (Number(user) + Number(system)) * 1000;
      // The exit codes of `bun format --check`: 1: not formatted, 2: a syntax error.
      done({ ms, died: code == 0 || (COMMAND && (code == 1 || code == 2)) ? "" : why });
    });
  });
}

const wanted = shapes.filter(shape => shape.name.includes(ONLY));
const all = [
  ...variants.split(",").flatMap(variant => wanted.filter(shape => shape.variant === undefined).map(shape => ({ variant: Number(variant), shape }))),
  // With COMMAND a variant is one of NAMES.
  ...wanted
    .filter(shape => shape.variant !== undefined && !(COMMAND && shape.second))
    .map(shape => ({ variant: COMMAND ? NAMES.split(",").findIndex(name => name == shape.ending || name.endsWith("." + shape.ending)) : shape.variant!, shape }))
    .filter(it => it.variant >= 0),
];
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
