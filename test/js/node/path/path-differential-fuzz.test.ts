// Seeded differential fuzz of node:path (src/runtime/node/path.rs) against the
// installed Node.js: random paths through path.posix.* and path.win32.*, the
// whole batch evaluated by one node child and compared call for call.
// Replay with BUN_PATH_FUZZ_SEED=<seed>; soak with BUN_PATH_FUZZ_ITERS=<n>.
//
// Every call is independent of the cwd and of the host platform: resolve()
// starts from an absolute base, relative() and win32 toNamespacedPath() only
// see paths carrying their own device, and a win32 drive-relative argument
// (`c:foo`) only ever names the base's drive (any other drive resolves against
// the cwd or the `=D:` environment variable).
//
// Not generated, because node:path on main predates their handling in Node's
// lib/path.js. oven-sh/bun#37305 brings them in; the test.failing pin at the
// bottom of this file starts passing with it, which is the cue to widen the
// generator to these (#37305's recorded node-path-parity corpus covers them
// as fixed cases; this file is the soakable, live-node counterpart):
//   - win32 reserved device names (CON, NUL, COM1, ...) and a `:` anywhere but
//     in a drive prefix at the start of the path (CVE-2024-36139 `.\` prefixing);
//   - `\\.\` and `\\?\` device roots;
//   - upper-case non-ASCII letters (win32.relative folds them; main folds ASCII only);
//   - lone surrogates (main transcodes them to U+FFFD).
import { fuzzEnv, Rng } from "_util/fuzz";
import { expect, test } from "bun:test";
import { bunEnv, nodeExe } from "harness";
import path from "node:path";

/** Each iteration is 24 calls (12 per namespace, see genCases). */
const fuzz = fuzzEnv("BUN_PATH_FUZZ", 0x70617468, { release: 1000, debug: 100 });
/** Iterations evaluated by one node child; a soak spawns one child per chunk. */
const ITERS_PER_CHILD = 1000;

type Namespace = "posix" | "win32";

interface Case {
  ns: Namespace;
  /** A method of path.posix / path.win32, or "format(parse())" for the round trip. */
  fn: string;
  args: string[];
}

/**
 * Evaluates one case to a comparable string. Runs both in this process and,
 * embedded through Function#toString, in the node child, so it must only use
 * its parameters and globals.
 */
function evaluate(ns: typeof path.posix, c: { fn: string; args: string[] }): string {
  try {
    if (c.fn === "format(parse())") return JSON.stringify(ns.format(ns.parse(c.args[0])));
    return JSON.stringify((ns as any)[c.fn](...c.args));
  } catch (e: any) {
    return `throws ${e?.code ?? e?.name ?? e}`;
  }
}

const NODE_SCRIPT = `
const path = require("node:path");
const evaluate = ${evaluate.toString()};
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => (input += chunk));
process.stdin.on("end", () => {
  const results = JSON.parse(input).map(c => evaluate(path[c.ns], c));
  process.stdout.write(JSON.stringify({ version: process.versions.node, results }));
});
`;

async function evaluateInNode(node: string, cases: Case[]): Promise<{ version: string; results: string[] }> {
  await using proc = Bun.spawn({
    cmd: [node, "-e", NODE_SCRIPT],
    env: bunEnv,
    stdin: new Blob([JSON.stringify(cases)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

function describeCall({ ns, fn, args }: Case): string {
  const list = args.map(a => JSON.stringify(a)).join(", ");
  return fn === "format(parse())" ? `path.${ns}.format(path.${ns}.parse(${list}))` : `path.${ns}.${fn}(${list})`;
}

// No word spells a reserved device name, contains a `:` or has an upper-case
// non-ASCII letter (header). "" produces doubled separators; "c\\d" is an
// ordinary posix file name that happens to contain a backslash.
const WORDS = [
  "a",
  "b",
  "foo",
  "bar.js",
  "x.y",
  "x.y.z",
  ".hidden",
  "..x",
  "x..",
  "file.",
  "a b",
  "index.d.ts",
  "日本",
  "é",
  "𝟘",
  "-",
  "c\\d",
  ".",
  "..",
  "",
];
const POSIX_SEPARATORS = ["/"];
const WIN32_SEPARATORS = ["\\", "/"];
const DRIVES = ["C", "c", "D", "z"];
const UNC_SERVERS = ["server", "srv", "日本"];
const UNC_SHARES = ["share", "s", "c$"];

function genSeparators(rng: Rng, separators: readonly string[]): string {
  return rng.string(separators, rng.chance(0.8) ? 1 : rng.range(2, 3));
}

function genWords(rng: Rng): string[] {
  const words: string[] = [];
  const n = rng.int(5);
  for (let i = 0; i < n; i++) words.push(rng.pick(WORDS));
  return words;
}

/** The words joined by separator runs, sometimes with a trailing run. */
function joinWords(rng: Rng, words: readonly string[], separators: readonly string[]): string {
  let s = "";
  for (let i = 0; i < words.length; i++) {
    if (i > 0) s += genSeparators(rng, separators);
    s += words[i];
  }
  if (rng.chance(0.2)) s += genSeparators(rng, separators);
  return s;
}

function genBody(rng: Rng, separators: readonly string[]): string {
  return joinWords(rng, genWords(rng), separators);
}

function genPosixPath(rng: Rng, absolute: boolean = rng.chance(0.5)): string {
  return (absolute ? genSeparators(rng, POSIX_SEPARATORS) : "") + genBody(rng, POSIX_SEPARATORS);
}

type Win32Root = "relative" | "rooted" | "drive-relative" | "drive" | "unc" | "unc-server-only";
const ANY_ROOT: readonly Win32Root[] = ["relative", "rooted", "drive-relative", "drive", "unc", "unc-server-only"];
/** Roots that do not start with a drive letter, so they never put a `:` after the start of a joined path. */
const COLON_FREE_ROOTS: readonly Win32Root[] = ["relative", "relative", "rooted", "unc", "unc-server-only"];
/** Roots that resolve() can complete without consulting the cwd. */
const ROOTS_WITH_DEVICE: readonly Win32Root[] = ["drive", "unc"];

function genWin32Root(rng: Rng, kind: Win32Root, drives: readonly string[]): string {
  switch (kind) {
    case "relative":
      return "";
    case "rooted":
      return rng.pick(WIN32_SEPARATORS);
    case "drive-relative":
      return rng.pick(drives) + ":";
    case "drive":
      return rng.pick(drives) + ":" + genSeparators(rng, WIN32_SEPARATORS);
    case "unc":
      return (
        rng.string(WIN32_SEPARATORS, 2) +
        rng.pick(UNC_SERVERS) +
        genSeparators(rng, WIN32_SEPARATORS) +
        rng.pick(UNC_SHARES) +
        (rng.chance(0.7) ? genSeparators(rng, WIN32_SEPARATORS) : "")
      );
    case "unc-server-only":
      return (
        rng.string(WIN32_SEPARATORS, 2) + rng.pick(UNC_SERVERS) + (rng.chance(0.5) ? rng.pick(WIN32_SEPARATORS) : "")
      );
  }
}

function genWin32Path(rng: Rng, kinds: readonly Win32Root[] = ANY_ROOT, drives: readonly string[] = DRIVES): string {
  let s: string;
  do {
    s = genWin32Root(rng, rng.pick(kinds), drives) + genBody(rng, WIN32_SEPARATORS);
    // The words "" and "." after a bare separator spell the `\\.\` device root
    // (`\\.` alone becomes one once join() appends the next argument).
  } while (/^[\\/]{2}[.?](?:[\\/]|$)/.test(s));
  return s;
}

function genSuffix(rng: Rng, p: string, ns: typeof path.posix): string {
  let suffix: string;
  switch (rng.int(4)) {
    case 0:
      suffix = ns.extname(p);
      break;
    case 1:
      suffix = ns.basename(p);
      break;
    default:
      suffix = rng.pick([".js", ".d.ts", "js", ".", "", "x", "日本", "é"]);
  }
  // Known divergence (pinned below): node takes basename()'s suffix branch when
  // the suffix has no more UTF-16 units than the path, main compares UTF-8 byte
  // lengths. Skip the suffixes on which the two length checks disagree.
  if (suffix.length <= p.length && Buffer.byteLength(suffix) > Buffer.byteLength(p)) return ".js";
  return suffix;
}

/**
 * Arguments for relative(): both carry a device (or `/`), and `to` usually
 * shares the root and some leading words with `from`, joined by separator runs
 * of its own.
 */
function genRelativeArgs(rng: Rng, win32: boolean): [from: string, to: string] {
  const separators = win32 ? WIN32_SEPARATORS : POSIX_SEPARATORS;
  const genRoot = win32
    ? () => genWin32Root(rng, rng.pick(ROOTS_WITH_DEVICE), DRIVES)
    : () => genSeparators(rng, POSIX_SEPARATORS);
  const root = genRoot();
  const words = genWords(rng);
  const from = root + joinWords(rng, words, separators);

  let toWords: string[];
  switch (rng.int(4)) {
    case 0:
      toWords = words;
      break;
    case 1:
      toWords = genWords(rng);
      break;
    case 2:
      toWords = words.slice(0, rng.int(words.length + 1)).concat(genWords(rng));
      break;
    default:
      toWords = words.concat(genWords(rng));
  }
  let to = (rng.chance(0.7) ? root : genRoot()) + joinWords(rng, toWords, separators);
  // win32.relative compares case-insensitively (ASCII only here, see the header).
  if (win32 && rng.chance(0.25)) to = to.replace(/[a-z]+/g, m => m.toUpperCase());
  return [from, to];
}

const UNARY = ["normalize", "dirname", "basename", "extname", "parse", "isAbsolute", "format(parse())"];

function genCases(rng: Rng, ns: Namespace): Case[] {
  const cases: Case[] = [];
  const add = (fn: string, ...args: string[]) => cases.push({ ns, fn, args });
  const win32 = ns === "win32";
  const genPath = win32 ? () => genWin32Path(rng) : () => genPosixPath(rng);

  for (const fn of UNARY) add(fn, genPath());
  const p = genPath();
  add("basename", p, genSuffix(rng, p, path[ns]));

  const joinArgs: string[] = [];
  const joinCount = rng.int(5);
  for (let i = 0; i < joinCount; i++) {
    if (rng.chance(0.15)) joinArgs.push("");
    else joinArgs.push(win32 && i > 0 ? genWin32Path(rng, COLON_FREE_ROOTS) : genPath());
  }
  add("join", ...joinArgs);

  const resolveArgs = [win32 ? rng.pick(["C:\\base\\dir", "c:/base", "C:\\"]) : rng.pick(["/base/dir", "/", "//base"])];
  const resolveCount = rng.int(4);
  for (let i = 0; i < resolveCount; i++) {
    if (!win32) resolveArgs.push(genPosixPath(rng, rng.chance(0.2)));
    else if (rng.chance(0.2)) resolveArgs.push(genWin32Path(rng, ["drive-relative"], ["C", "c"]));
    else resolveArgs.push(genWin32Path(rng, [...COLON_FREE_ROOTS, "drive"]));
  }
  add("resolve", ...resolveArgs);

  add("relative", ...genRelativeArgs(rng, win32));
  add("toNamespacedPath", win32 ? genWin32Path(rng, ROOTS_WITH_DEVICE) : genPath());
  return cases;
}

const node = nodeExe();
// Bun implements the node:path of the Node release it reports, so only that
// major is a meaningful oracle (the CI images install exactly that release).
const wantedMajor = process.versions.node.split(".")[0];
const nodeMajor =
  node &&
  Bun.spawnSync({ cmd: [node, "-p", "process.versions.node.split('.')[0]"], env: bunEnv })
    .stdout.toString()
    .trim();

test.skipIf(nodeMajor !== wantedMajor)(`node:path agrees with node ${fuzz.label}`, async () => {
  const rng = new Rng(fuzz.seed);
  let compared = 0;
  for (let start = 0; start < fuzz.iters; start += ITERS_PER_CHILD) {
    const cases: Case[] = [];
    const iterationOf: number[] = [];
    for (let i = start; i < Math.min(start + ITERS_PER_CHILD, fuzz.iters); i++) {
      for (const ns of ["posix", "win32"] as const) {
        for (const c of genCases(rng, ns)) {
          cases.push(c);
          iterationOf.push(i);
        }
      }
    }

    const bunResults = cases.map(c => evaluate(path[c.ns], c));
    const { version, results: nodeResults } = await evaluateInNode(node!, cases);
    expect(nodeResults).toHaveLength(cases.length);

    const mismatches: string[] = [];
    for (let k = 0; k < cases.length && mismatches.length < 10; k++) {
      if (bunResults[k] !== nodeResults[k]) {
        mismatches.push(
          `${describeCall(cases[k])}\n    bun:  ${bunResults[k]}\n    node: ${nodeResults[k]}\n    ${fuzz.repro(iterationOf[k])}`,
        );
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `node:path disagrees with node v${version} (first ${mismatches.length}):\n  ${mismatches.join("\n  ")}`,
      );
    }
    compared += cases.length;
  }
  console.log(`path-differential-fuzz: ${compared} calls agree with node (${fuzz.iters} iterations)`);
  expect(compared).toBeGreaterThan(0);
});

// What genSuffix() steers around; these are node's answers. oven-sh/bun#37305
// makes this pass: delete it and the length check in genSuffix then, and widen
// the generator to the classes listed in the header while at it.
test.failing("known divergence: basename() measures the suffix in UTF-16 units", () => {
  expect(path.posix.basename("//", "日本")).toBe("//");
  expect(path.win32.basename("z:/", "日本")).toBe("/");
});
