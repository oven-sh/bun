// Regenerates node-path-parity.json. Run under Node.js (not Bun):
//
//   node node-path-parity.gen.mjs > node-path-parity.json
//
// Generates pseudo-random node:path calls (fixed seed), evaluates them with the
// running Node's path.posix/path.win32, drops the ones whose result depends on
// process.cwd(), and keeps up to 70 per (namespace, function).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let s = 42;
const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const pick = a => a[Math.floor(rnd() * a.length)];

// prettier-ignore
const atoms = [
  "/", "/", "/", "\\", "\\", ".", ".", "..", "...", ":", "a", "b", "c", "foo", "bar", "C:", "c:", "D:", "Z:", "1:",
  "CON", "con", "PRN", "aux", "NUL", "COM1", "LPT9", "COM¹", "LPT²", "COM³", "CONx", "COM0", "LPT10",
  "?", "UNC", "server", "share", " ", "file.txt", ".js", "index.html", ".hidden", "a.b.c", "x.", "..ext",
  "İ", "ß", "ı", "ſ", "é", "É", "µ", "ÿ", "日本", "😀", "\u0301", "K", "\u212A", "pipe", "PHYSICALDRIVE0", "",
];
// prettier-ignore
const roots = ["", "", "/", "//", "///", "\\", "\\\\", "C:", "c:", "C:\\", "C:/", "Z:x", "\\\\?\\", "\\\\.\\", "//?/", "//./", "//server/share", "\\\\server\\share\\", "\\\\?\\UNC\\server\\share", "\\\\?\\C:\\", "//server", "\\\\?\\COM1:", "CON:", "con:x"];
// prettier-ignore
const segs = ["a", "b", "..", ".", "", "foo", "bar.txt", "CON", "COM1:", "LPT¹", "İ", "ß", "日本語", "x.y.z", "...", " ", "aux:", "c:", "D:"];
const seps = ["/", "\\", "//", "\\/", "/\\\\"];
// Values JSON can round-trip, so the recorded call is exactly the replayed one.
const nonStrings = [null, 0, 1, true, {}, [], ["a"]];

function str(maxAtoms = 7) {
  const mode = rnd();
  let out = "";
  if (mode < 0.45) {
    for (let n = Math.floor(rnd() * maxAtoms); n > 0; n--) out += pick(atoms);
  } else if (mode < 0.95) {
    out = pick(roots);
    const n = Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) out += (i || rnd() < 0.3 ? pick(seps) : "") + pick(segs);
    if (rnd() < 0.3) out += pick(seps);
  } else {
    out = pick(atoms);
  }
  return out;
}
const arg = (pNonString = 0.03) => (rnd() < pNonString ? pick(nonStrings) : str());

// prettier-ignore
const fns = ["resolve", "normalize", "isAbsolute", "join", "relative", "toNamespacedPath", "dirname", "basename", "extname", "parse", "format"];
function makeCase() {
  const fn = pick(fns);
  switch (fn) {
    case "resolve":
    case "join":
      return [
        fn,
        Array.from({ length: rnd() < 0.05 ? 17 + Math.floor(rnd() * 10) : Math.floor(rnd() * 5) }, () => arg()),
      ];
    case "relative":
      return [fn, [arg(), arg()]];
    case "basename":
      return [fn, rnd() < 0.5 ? [arg()] : [arg(), arg()]];
    case "format": {
      const o = {};
      for (const k of ["root", "dir", "base", "name", "ext"]) {
        const r = rnd();
        if (r < 0.45) o[k] = str(3);
        else if (r < 0.5) o[k] = pick(nonStrings);
      }
      return [fn, rnd() < 0.05 ? [arg(0.9)] : [o]];
    }
    default:
      return [fn, [arg()]];
  }
}

function evaluate(ns, fn, args) {
  try {
    return path[ns][fn](...args);
  } catch (e) {
    return { error: { code: e.code || e.name, message: e.message } };
  }
}

const cases = Array.from({ length: 20000 }, makeCase);
const here = process.cwd();
const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
const rows = [];
const seen = new Set();
for (const ns of ["posix", "win32"]) {
  for (const [fn, args] of cases) {
    const key = JSON.stringify([ns, fn, args]);
    if (seen.has(key) || key.length > 320) continue;
    seen.add(key);
    process.chdir(here);
    const a = evaluate(ns, fn, args);
    process.chdir(elsewhere);
    const b = evaluate(ns, fn, args);
    if (JSON.stringify(a) !== JSON.stringify(b)) continue; // depends on process.cwd()
    if (typeof a !== "string" && typeof a !== "boolean" && (typeof a !== "object" || a === null)) continue;
    rows.push([ns, fn, args, a]);
  }
}
process.chdir(here);
fs.rmdirSync(elsewhere);

const buckets = new Map();
for (const row of rows) {
  const key = `${row[0]}.${row[1]}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(row);
}
const out = [];
for (const key of [...buckets.keys()].sort()) out.push(...buckets.get(key).slice(0, 70));
process.stdout.write(JSON.stringify(out) + "\n");
process.stderr.write(`${out.length} cases from Node.js ${process.version}\n`);
