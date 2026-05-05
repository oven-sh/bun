/**
 * Regression test for #29681 — the prebuilt `bun-linux-*-musl` binaries
 * linked `libstdc++.so.6` and `libgcc_s.so.1` dynamically, forcing users
 * on clean Alpine images to `apk add libstdc++ libgcc` before bun would
 * launch. PR #15186 introduced the dynamic linking; earlier Bun releases
 * linked these statically (as glibc builds still do).
 *
 * The fix (scripts/build/flags.ts) drops the musl-only `-lstdc++ -lgcc`
 * branch and always emits `-static-libstdc++ -static-libgcc` on Linux.
 *
 * This test evaluates the linker-flag table by reading `flags.ts` as
 * source and running the `linkerFlags` array literal through a minimal
 * fake config for each {gnu, musl} × {x64, aarch64} combination. The
 * array is parsed + transpiled rather than `import`ed directly because
 * the debug build's module loader mis-handles the transitive `config.ts`
 * import graph (unrelated to this fix).
 *
 * If a future edit re-introduces `-lstdc++` / `-lgcc` for musl, or drops
 * the `-static-*` flags, this test fails here instead of at Alpine
 * install time.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Only the fields the linkerFlags predicates read. Extra booleans default
// to `false`/`undefined` so unrelated predicates (windows, macOS, etc.)
// simply don't fire.
type FakeConfig = Record<string, unknown>;

interface FlagEntry {
  flag: string | string[] | ((cfg: FakeConfig) => string | string[]);
  when?: (cfg: FakeConfig) => boolean;
  desc: string;
}

const FLAGS_TS = join(import.meta.dir, "..", "..", "..", "scripts", "build", "flags.ts");

function makeLinuxConfig(abi: "gnu" | "musl", arch: "x64" | "aarch64"): FakeConfig {
  const cwd = join(import.meta.dir, "..", "..", "..");
  return {
    linux: true,
    darwin: false,
    windows: false,
    unix: true,
    x64: arch === "x64",
    arm64: arch === "aarch64",
    debug: false,
    release: true,
    abi,
    lto: false,
    asan: false,
    smol: false,
    assertions: false,
    valgrind: false,
    fuzzilli: false,
    ci: false,
    pgoGenerate: undefined,
    pgoUse: undefined,
    osxDeploymentTarget: undefined,
    osxSysroot: undefined,
    cwd,
    buildDir: join(cwd, "build", "release"),
    ld: "/usr/bin/ld.lld",
  };
}

/**
 * Parse out the `linkerFlags` array literal from flags.ts and evaluate it
 * as JS. Returns the Flag[] table. See the file-level comment for why
 * we avoid a plain `import`.
 */
function loadLinkerFlags(): FlagEntry[] {
  const src = readFileSync(FLAGS_TS, "utf8");

  // Find the declaration. The type annotation `Flag[]` contains a `[`
  // too, so start the array search from after the `=`.
  const declIdx = src.indexOf("export const linkerFlags");
  if (declIdx < 0) throw new Error("linkerFlags declaration not found");
  const eqIdx = src.indexOf("=", declIdx);
  const arrStart = src.indexOf("[", eqIdx);
  if (arrStart < 0) throw new Error("linkerFlags array not found");

  // Walk to the matching close bracket, respecting string literals and
  // line comments. The array has no nested `/* */` blocks, no template
  // literals with `${}` nesting, and no regex literals, so this is safe.
  let depth = 0;
  let inStr: string | null = null;
  let end = arrStart;
  for (; end < src.length; end++) {
    const c = src[end]!;
    if (inStr !== null) {
      if (c === "\\") end++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "/" && src[end + 1] === "/") {
      while (end < src.length && src[end] !== "\n") end++;
    } else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  if (depth !== 0) throw new Error("linkerFlags array did not close");

  const arrayLiteral = src.slice(arrStart, end + 1);

  // Transpile TS → JS (strips `as Foo` casts, arrow param type annots).
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(`globalThis.__t__ = ${arrayLiteral};`);

  // Stub the helpers referenced inside the array (imported at the top
  // of flags.ts). None of them matter for the musl-libstdc++ check;
  // they just need to resolve so eval doesn't throw.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("bunExeName", "slash", "join", js)(
    () => "bun",
    (p: string) => p,
    (...parts: string[]) => parts.join("/"),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const arr = g.__t__ as FlagEntry[];
  delete g.__t__;
  return arr;
}

function resolveLinkerFlags(cfg: FakeConfig, table: FlagEntry[]): string[] {
  const out: string[] = [];
  for (const f of table) {
    if (f.when && !f.when(cfg)) continue;
    const v = typeof f.flag === "function" ? f.flag(cfg) : f.flag;
    out.push(...(Array.isArray(v) ? v : [v]));
  }
  return out;
}

test.each([
  ["musl", "x64"],
  ["musl", "aarch64"],
  ["gnu", "x64"],
  ["gnu", "aarch64"],
] as const)("linux-%s-%s links libstdc++/libgcc statically", (abi, arch) => {
  const flags = resolveLinkerFlags(makeLinuxConfig(abi, arch), loadLinkerFlags());

  // Must opt into the static C++ runtime.
  expect(flags).toContain("-static-libstdc++");
  expect(flags).toContain("-static-libgcc");

  // Must NOT fall back to dynamic `-lstdc++` / `-lgcc` — that is what
  // caused #29681 ("symbol not found" on clean Alpine until
  // `apk add libstdc++ libgcc`).
  expect(flags).not.toContain("-lstdc++");
  expect(flags).not.toContain("-lgcc");
});
