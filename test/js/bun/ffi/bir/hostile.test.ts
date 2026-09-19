import { describe, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, symlinkSync, truncateSync, writeFileSync } from "fs";
import { bunExe, isPosix, tempDir } from "harness";
import { dirname, join, sep } from "path";
import cases from "./fixtures/hostile/cases.json";
import { cEnv, lines, longsOfUnstatedWidth, meets, repeated, run, supported } from "./run-fixtures";

// Input no program looks like: nested, repeated or grown far past what a person writes, and files that are not
// files. Each ends in what `cases.json` says: the program's output, or one diagnostic and status 1. Never a crash,
// a hang or an out-of-memory kill. The sources are made here from a description, so none of them is checked in.

type Part = string | [text: string, count: number] | { each: string; count: number; from: number };
type Expected =
  | { error: { message: string; line: number; column: number } | { contains: string } }
  | { output: string; status: number };
type Case = {
  name: string;
  source: Part[];
  files?: Record<string, Part[]>;
  /** Files of so many bytes, all zeros, that take no room on the disk. */
  sparse?: Record<string, number>;
  symlinks?: Record<string, string>;
  hardlinks?: Record<string, string>;
  fifos?: string[];
  unreadable?: string[];
  requires?: string;
} & Expected;

function textOf(parts: Part[]) {
  return parts
    .map(part => {
      if (typeof part === "string") return part;
      if (Array.isArray(part)) return repeated(part[0], part[1]);
      const pieces: string[] = [];
      for (let i = part.from; i < part.from + part.count; i++)
        pieces.push(part.each.replaceAll("{i+1}", String(i + 1)).replaceAll("{i}", String(i)));
      return pieces.join("");
    })
    .join("");
}

// The files of a case, in a directory of their own.
function treeOf(entry: Case) {
  const dir = tempDir("bir-hostile", { "test.c": textOf(entry.source) });
  const root = String(dir);
  for (const [name, parts] of Object.entries(entry.files ?? {})) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), textOf(parts));
  }
  for (const [name, size] of Object.entries(entry.sparse ?? {})) {
    writeFileSync(join(root, name), "");
    truncateSync(join(root, name), size);
  }
  for (const [name, target] of Object.entries(entry.symlinks ?? {})) symlinkSync(target, join(root, name));
  for (const [name, target] of Object.entries(entry.hardlinks ?? {})) linkSync(join(root, target), join(root, name));
  for (const name of entry.fifos ?? []) {
    const made = Bun.spawnSync({ cmd: ["mkfifo", join(root, name)] });
    if (made.exitCode !== 0) throw new Error(`mkfifo ${name}: ${made.stderr}`);
  }
  for (const name of entry.unreadable ?? []) chmodSync(join(root, name), 0);
  return dir;
}

function check(entry: Case, root: string, result: { stdout: string; stderr: string; exitCode: number }) {
  const stderr = lines(result.stderr).replaceAll(root + sep, "");
  if ("error" in entry) {
    if ("contains" in entry.error) expect(stderr).toContain(entry.error.contains);
    else {
      expect(stderr).toContain(`error: ${entry.error.message}\n`);
      expect(stderr).toContain(`test.c:${entry.error.line}:${entry.error.column}\n`);
    }
    expect(stderr).not.toContain("Bun has crashed");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  } else {
    expect(lines(result.stdout), stderr).toBe(entry.output);
    expect(result.exitCode).toBe(entry.status);
  }
}

// A file nobody may read can be read by root.
const isRoot = isPosix && process.getuid?.() === 0;
const applies = (entry: Case) => meets(entry.requires) && !(entry.unreadable?.length && isRoot);

test("`long` alone is only in a case that says how wide it is, or that either width will do", () => {
  // (Of what a case is made of, each piece once: what is repeated says nothing new.)
  const once = (parts: Part[]) =>
    parts.map(part => (typeof part === "string" ? part : Array.isArray(part) ? part[0] : part.each)).join("\n");
  const withLong = (cases as Case[]).filter(entry =>
    [entry.source, ...Object.values(entry.files ?? {})].some(
      parts => longsOfUnstatedWidth(once(parts), entry.requires).length,
    ),
  );
  expect(withLong.map(entry => entry.name)).toEqual([]);
});

describe.skipIf(!supported)("hostile input", () => {
  for (const entry of cases as Case[]) {
    test.concurrent.skipIf(!applies(entry))(entry.name, async () => {
      using dir = treeOf(entry);
      check(entry, String(dir), await run(String(dir), ["test.c"]));
    });

    test.concurrent.skipIf(!applies(entry))(`${entry.name} (bundled)`, async () => {
      using dir = treeOf(entry);
      const root = String(dir);
      const built = await run(root, ["build", "test.c", "--target=bun", "--outdir", "out"]);
      if ("error" in entry) return check(entry, root, built);
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
      check(entry, root, await run(root, [join("out", "test.js")]));
    });

    // With a stack a sixteenth of the usual one, what ran out of stack before still ends the same way: the
    // compiler's depth is bounded by the stack it is given, and says so when that is not enough.
    test.concurrent.skipIf(!applies(entry) || !isPosix)(`${entry.name} (on a 512 KB stack)`, async () => {
      using dir = treeOf(entry);
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", 'ulimit -s 512 && exec "$0" test.c', bunExe()],
        env: cEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // What is too deep for this stack says so, before whatever else there is to say about it.
      const tooDeep = lines(stderr).includes("is nested too deeply");
      if ("error" in entry && !tooDeep) return check(entry, String(dir), { stdout, stderr, exitCode });
      if (!("error" in entry) && exitCode === entry.status) expect(lines(stdout), stderr).toBe(entry.output);
      else {
        expect(lines(stderr)).toContain("is nested too deeply");
        expect(stderr).not.toContain("Bun has crashed");
        expect(stdout).toBe("");
        expect(exitCode).toBe(1);
      }
    });
  }
});
