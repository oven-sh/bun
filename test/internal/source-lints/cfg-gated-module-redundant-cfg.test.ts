import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// A module that is only ever mounted under `#[cfg(P)]` is never compiled when
// `P` is false. Inside such a module, `#[cfg(P)]` is redundant and every
// `#[cfg(not(P))]` arm is dead code that rustc cannot report: it is stripped
// before `dead_code` analysis runs, so a stub like
//
//     #[cfg(not(windows))]
//     pub(crate) fn open(..) { unreachable!("windows-only") }
//
// survives forever once the parent adds `#[cfg(windows)]` to the `mod` line.
// `socket/WindowsNamedPipe.rs` carried 50 such lines after its mount was gated
// in 77ab49c2a8; `node/path_watcher.rs` carried 15 `#[cfg(not(windows))]`
// attributes under a `#[cfg(not(windows))]` mount.
//
// The check is textual. For every top-level `mod name;` item in a tracked
// `src/**/*.rs` file, the mounted file is resolved (`#[path = ".."]` is
// relative to the directory of the declaring file; otherwise `name.rs` or
// `name/mod.rs` next to a `mod.rs`/`lib.rs`/`main.rs`, or under a directory
// named after any other declaring file). A file whose every mount carries the
// same `#[cfg(P)]` must not contain an outer `#[cfg(P)]` or `#[cfg(not(P))]`
// attribute. Inner `#![cfg(P)]` attributes are allowed: they restate the
// constraint inside the file and guard against an ungated mount.
//
// Predicates are compared with whitespace removed, so the match is exact:
// `#[cfg(target_os = "linux")]` inside a module mounted under
// `#[cfg(any(target_os = "linux", target_os = "android"))]` narrows the
// condition and is not reported.

const root = path.resolve(import.meta.dir, "..", "..", "..");

function trackedRustSources(): string[] {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-files", "-z", "--", "src/*.rs", "src/**/*.rs"],
    stdout: "pipe",
    stderr: "ignore",
  });
  expect(r.success).toBe(true);
  return r.stdout.toString().split("\0").filter(Boolean);
}

/** Drop full-line `//` comments (doc comments included) so prose mentioning `#[cfg(windows)]` is ignored. */
function stripLineComments(source: string): string {
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Every `#[cfg(...)]` / `#![cfg(...)]` attribute in `source` with its
 * whitespace-free predicate, the 1-based line it starts on, and whether it is
 * an inner (`#!`) attribute. Parentheses are matched so nested predicates like
 * `any(target_os = "linux", not(windows))` come back whole.
 */
function cfgAttributes(source: string): { predicate: string; line: number; inner: boolean }[] {
  const out: { predicate: string; line: number; inner: boolean }[] = [];
  const re = /#(!?)\[\s*cfg\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    if (depth !== 0) break;
    const predicate = source.slice(re.lastIndex, i - 1).replace(/\s+/g, "");
    const line = source.slice(0, m.index).split("\n").length;
    out.push({ predicate, line, inner: m[1] === "!" });
    re.lastIndex = i;
  }
  return out;
}

/** `mod name;` items at column 0 with their attributes, as `{ file, predicate | null }` per mounted file. */
function collectMounts(files: string[]): Map<string, { mounter: string; predicate: string | null }[]> {
  const mounts = new Map<string, { mounter: string; predicate: string | null }[]>();
  // Attribute lines directly above a top-level `mod name;` declaration.
  const modItem = /^((?:#\[[^\]]*\][ \t]*\n)*)(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*;/gm;
  const pathAttr = /#\[\s*path\s*=\s*"([^"]+)"\s*\]/;

  for (const file of files) {
    const source = stripLineComments(readFileSync(path.join(root, file), "utf8"));
    const dir = path.posix.dirname(file);
    const base = path.posix.basename(file);
    const modDir = ["mod.rs", "lib.rs", "main.rs"].includes(base) ? dir : path.posix.join(dir, base.slice(0, -3));

    let m: RegExpExecArray | null;
    while ((m = modItem.exec(source)) !== null) {
      const [, attrs, name] = m;
      const explicit = pathAttr.exec(attrs);
      const candidates = explicit
        ? [path.posix.normalize(path.posix.join(dir, explicit[1]))]
        : [path.posix.join(modDir, `${name}.rs`), path.posix.join(modDir, name, "mod.rs")];
      const target = candidates.find(c => existsSync(path.join(root, c)));
      if (!target) continue;

      const cfgs = cfgAttributes(attrs).filter(a => !a.inner);
      const predicate = cfgs.length === 1 ? cfgs[0].predicate : cfgs.length === 0 ? null : "<multiple>";
      const list = mounts.get(target) ?? [];
      list.push({ mounter: file, predicate });
      mounts.set(target, list);
    }
  }
  return mounts;
}

test("a module mounted only under #[cfg(P)] has no #[cfg(P)] or #[cfg(not(P))] items inside", () => {
  const files = trackedRustSources();
  expect(files.length).toBeGreaterThan(100);

  const mounts = collectMounts(files);
  const violations: string[] = [];
  let gatedModules = 0;

  for (const [target, list] of [...mounts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const predicates = new Set(list.map(e => e.predicate));
    if (predicates.size !== 1) continue;
    const [predicate] = predicates;
    if (predicate === null || predicate === "<multiple>") continue;
    gatedModules++;

    // The dead arm is `not(P)`, or the inner predicate when `P` is itself a
    // `not(..)`: inside a module mounted under `#[cfg(not(windows))]` the dead
    // arm is `#[cfg(windows)]`, not `#[cfg(not(not(windows)))]`.
    const negated = /^not\((.*)\)$/.exec(predicate)?.[1] ?? `not(${predicate})`;
    const source = stripLineComments(readFileSync(path.join(root, target), "utf8"));
    for (const attr of cfgAttributes(source)) {
      if (attr.inner) continue;
      if (attr.predicate === predicate) {
        violations.push(
          `${target}:${attr.line}: redundant #[cfg(${predicate})]; the module is only mounted under that cfg (${list[0].mounter})`,
        );
      } else if (attr.predicate === negated) {
        violations.push(
          `${target}:${attr.line}: dead #[cfg(${negated})] arm; the module is only mounted under #[cfg(${predicate})] (${list[0].mounter})`,
        );
      }
    }
  }

  // Guard against the mount scan regressing to nothing (which would make the
  // assertion below pass vacuously). The tree has dozens of cfg-gated modules.
  expect(gatedModules).toBeGreaterThan(10);
  expect(violations).toEqual([]);
});
