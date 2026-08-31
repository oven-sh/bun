// Regenerates node-path-parity.json. Run under Node.js (not Bun):
//
//   node node-path-parity.gen.mjs > node-path-parity.json
//
// Generates pseudo-random node:path calls (fixed seed), evaluates them with the
// running Node's path.posix/path.win32, drops the ones whose result depends on
// process.cwd(), and keeps up to 70 per (namespace, function).
import path from "node:path";

// The Node.js release whose lib/path.js src/runtime/node/path.rs is ported from. The
// recorded results are that release's behaviour, so only it may regenerate them; bump
// this together with the port.
const NODE_VERSION = "26.3.0";
if (process.versions.node !== NODE_VERSION) {
  console.error(`node-path-parity.json must be generated with Node.js v${NODE_VERSION}, not v${process.versions.node}`);
  process.exit(1);
}

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

// lib/path.js reads process.cwd() whenever a result involves the working directory. Such
// results differ between hosts (on Windows the cwd carries a drive letter, which
// win32.resolve() and everything built on it pick up, including drive-relative inputs
// like "C:x" when the cwd is on that drive) and between checkouts (relative() counts the
// cwd's components), so a case is kept only if it evaluates the same under working
// directories of different depths, without a drive and on each drive the inputs use.
// prettier-ignore
const cwds = ["/", "/one", "/two/deeper", "C:\\", "C:\\three", "C:\\four\\deeper\\still", "D:\\five\\deeper", "Z:\\six", "\\\\server\\share\\seven"];
const evaluateEverywhere = (ns, fn, args) =>
  cwds.map(cwd => {
    process.cwd = () => cwd;
    return JSON.stringify(evaluate(ns, fn, args));
  });

const cases = Array.from({ length: 20000 }, makeCase);
const rows = [];
const seen = new Set();
for (const ns of ["posix", "win32"]) {
  for (const [fn, args] of cases) {
    const key = JSON.stringify([ns, fn, args]);
    if (seen.has(key) || key.length > 320) continue;
    seen.add(key);
    const results = evaluateEverywhere(ns, fn, args);
    if (results[0] === undefined || results.some(result => result !== results[0])) continue; // depends on process.cwd()
    const a = JSON.parse(results[0]);
    if (typeof a !== "string" && typeof a !== "boolean" && (typeof a !== "object" || a === null)) continue;
    rows.push([ns, fn, args, a]);
  }
}

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
