// `bun build --compile --compile-exclude-features=<name>` leaves parts of the runtime out of the executable.
//
// What can be left out is said by a table that Bun's build embeds in the stripped release binary of the targets it
// supports (scripts/build/feature-table.ts). A debug or ASAN build has none, and has to say so.

import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isArm64,
  isASAN,
  isCI,
  isDebug,
  isGlibc,
  isLinux,
  isMacOS,
  isWindows,
  readElf64ProgramHeaders,
  tempDir,
} from "harness";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const exe = (name: string) => (isWindows ? name + ".exe" : name);

// CI runs the tests with `bun-profile`, which keeps its symbols and has no table. The `bun` that ships is unpacked next
// to it: `bun-linux-x64-profile/bun-profile` and `bun-linux-x64/bun`.
const shipped = (() => {
  const beside = join(dirname(bunExe()).replace(/-profile$/, ""), exe("bun"));
  return dirname(bunExe()).endsWith("-profile") && existsSync(beside) ? beside : bunExe();
})();

const app = `
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const server = Bun.serve({ port: 0, fetch: () => new Response("served") });
const fetched = await (await fetch(server.url)).text();
server.stop(true);
console.log(JSON.stringify({
  sqlite: new Database(":memory:").query("select 42 as x").get(),
  fetched,
  shell: (await Bun.$\`echo shell\`.text()).trim(),
  sha256: createHash("sha256").update("a").digest("hex").slice(0, 8),
  gzip: gzipSync("hello").length > 0,
  intl: new Intl.NumberFormat("de").format(1234.5),
  password: typeof Bun.password,
  hasPassword: "password" in Bun,
  Transpiler: typeof Bun.Transpiler,
  randomUUIDv7: typeof Bun.randomUUIDv7,
  hash: typeof Bun.hash,
}));
`;
const working = {
  sqlite: { x: 42 },
  fetched: "served",
  shell: "shell",
  sha256: "ca978112",
  gzip: true,
  intl: "1.234,5",
  password: "object",
  hasPassword: true,
  Transpiler: "function",
  randomUUIDv7: "function",
  hash: "function",
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const compileFrom = (from: string, cwd: string, outfile: string, ...args: string[]) =>
  run(
    [bunExe(), "build", "--compile", "app.ts", "--outfile", outfile, `--compile-executable-path=${from}`, ...args],
    cwd,
  );
const compile = (cwd: string, outfile: string, ...args: string[]) => compileFrom(shipped, cwd, outfile, ...args);
/** Runs a compiled executable as the `bun` it holds. */
const asBun = (cwd: string, name: string, ...args: string[]) =>
  run([join(cwd, exe(name)), ...args], cwd, { ...bunEnv, BUN_BE_BUN: "1" });

const noTable = "does not say what can be excluded";
const hasTable = (() => {
  using dir = tempDir("exclude-features-probe", { "app.ts": "" });
  const from = `--compile-executable-path=${shipped}`;
  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "app.ts", "--outfile", "app", from, "--compile-exclude-features=?"],
    cwd: String(dir),
    env: bunEnv,
  });
  return (stdout.toString() + stderr.toString()).includes("These can be excluded:");
})();

// Else every test below could be skipped without anyone noticing that a release lost its table.
test.skipIf(!isCI)("the builds that should be able to exclude features are", () => {
  const isSupportedTarget = isGlibc || (isMacOS && isArm64) || (isWindows && !isArm64);
  expect(hasTable).toBe(!isDebug && !isASAN && isSupportedTarget);
});

test("requires --compile", async () => {
  using dir = tempDir("exclude-features", { "app.ts": app });
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "app.ts", "--outdir", "out", "--compile-exclude-features=lint"],
    String(dir),
  );
  expect(stderr).toContain("--compile-exclude-features requires --compile");
  expect(exitCode).not.toBe(0);
});

test.skipIf(hasTable)("a bun that cannot exclude features says so", async () => {
  using dir = tempDir("exclude-features", { "app.ts": app });
  const { stdout, stderr, exitCode } = await compile(String(dir), "app", "--compile-exclude-features=lint");
  expect(stdout + stderr).toContain(noTable);
  expect(existsSync(join(String(dir), exe("app")))).toBe(false);
  expect(exitCode).not.toBe(0);
});

describe.skipIf(!hasTable)("with a feature table", () => {
  test.concurrent("commands", async () => {
    using dir = tempDir("exclude-features", { "app.ts": app, "lintme.ts": "export const one = 1;\n" });
    const cwd = String(dir);
    const [full, without] = await Promise.all([
      compile(cwd, "full"),
      // separated by commas, and given again
      compile(cwd, "without", "--compile-exclude-features=check,lint", "--compile-exclude-features=fmt"),
    ]);
    expect(full.stderr + without.stderr).not.toContain("error");
    expect([full.exitCode, without.exitCode]).toEqual([0, 0]);
    expect(statSync(join(cwd, exe("without"))).size).toBeLessThan(statSync(join(cwd, exe("full"))).size - 1024 * 1024);

    const ran = await run([join(cwd, exe("without"))], cwd);
    expect(JSON.parse(ran.stdout)).toEqual(working);
    expect(ran.exitCode).toBe(0);

    for (const command of ["check", "lint", "fmt"]) {
      const gone = await asBun(cwd, "without", command, "lintme.ts");
      expect(gone.stderr).toContain("this executable was built without this command");
      expect(gone.exitCode).not.toBe(0);
    }
    // What asks for an excluded feature in another way is refused too, not ignored.
    for (const args of [
      ["build", "--check", "lintme.ts"],
      ["run", "--check", "lintme.ts"],
      ["-e", `await Bun.build({ entrypoints: ["lintme.ts"], check: true })`],
    ]) {
      const refused = await asBun(cwd, "without", ...args);
      expect(refused.stderr).toContain("this executable was built without type checking");
      expect(refused.exitCode).not.toBe(0);
    }
    const kept = await asBun(cwd, "full", "lint", "lintme.ts");
    expect(kept.stderr).not.toContain("built without");
    expect(kept.exitCode).toBe(0);
  });

  test.concurrent("properties, through Bun.build", async () => {
    using dir = tempDir("exclude-features", { "app.ts": app });
    const cwd = String(dir);
    const result = await Bun.build({
      entrypoints: [join(cwd, "app.ts")],
      compile: {
        outfile: join(cwd, "app"),
        executablePath: shipped,
        excludeFeatures: ["Bun.password", "Bun.Transpiler"],
      },
    });
    expect(result.success).toBe(true);
    const ran = await run([join(cwd, exe("app"))], cwd);
    expect(JSON.parse(ran.stdout)).toEqual({
      ...working,
      password: "undefined",
      hasPassword: false,
      Transpiler: "undefined",
    });
    expect(ran.exitCode).toBe(0);
  });

  test.concurrent("a name that does not exist", async () => {
    using dir = tempDir("exclude-features", { "app.ts": app });
    const cwd = String(dir);
    const { stdout, stderr, exitCode } = await compile(cwd, "app", "--compile-exclude-features=lint,nope");
    expect(stdout + stderr).toContain('there is no feature called "nope". These can be excluded:\n  check\n  lint\n');
    expect(existsSync(join(cwd, exe("app")))).toBe(false);
    expect(exitCode).not.toBe(0);

    const rejected = await Bun.build({
      entrypoints: [join(cwd, "app.ts")],
      compile: { outfile: join(cwd, "app"), executablePath: shipped, excludeFeatures: ["nope"] },
    }).catch(e => e);
    expect(rejected).toBeInstanceOf(AggregateError);
    expect(rejected.errors[0].message).toContain('there is no feature called "nope"');
  });

  test.concurrent("the executable does not carry the table", async () => {
    using dir = tempDir("exclude-features", { "app.ts": app });
    const cwd = String(dir);
    for (const [name, ...args] of [["full"], ["without", "--compile-exclude-features=lint"]]) {
      expect((await compile(cwd, name, ...args)).exitCode).toBe(0);
      const again = await compileFrom(join(cwd, exe(name)), cwd, "again", "--compile-exclude-features=fmt");
      expect(again.stdout + again.stderr).toContain(noTable);
      expect(again.exitCode).not.toBe(0);
    }
  });

  // On Windows no compiled executable can: it has a `.bun` section already.
  test.skipIf(isWindows).concurrent("the executable can compile in its turn", async () => {
    using dir = tempDir("exclude-features", { "app.ts": app });
    const cwd = String(dir);
    expect((await compile(cwd, "without", "--compile-exclude-features=check,lint,fmt")).exitCode).toBe(0);
    const compiled = await asBun(cwd, "without", "build", "--compile", "app.ts", "--outfile", "again");
    expect(compiled.stderr).not.toContain("error");
    expect(compiled.exitCode).toBe(0);
    const ran = await run([join(cwd, exe("again"))], cwd);
    expect(JSON.parse(ran.stdout)).toEqual(working);
    expect(ran.exitCode).toBe(0);
  });

  // A loader that honors p_align maps whole multiples of it. See compile-elf-segment-layout.test.ts.
  test.skipIf(!isLinux).concurrent("ELF: the segments do not overlap under strict p_align", async () => {
    using dir = tempDir("exclude-features", { "app.ts": app });
    const cwd = String(dir);
    expect((await compile(cwd, "without", "--compile-exclude-features=check,lint,fmt")).exitCode).toBe(0);
    const loads = readElf64ProgramHeaders(join(cwd, "without"))
      .filter(ph => ph.type === 1 /* PT_LOAD */)
      .sort((a, b) => (a.vaddr < b.vaddr ? -1 : 1))
      .map(({ vaddr, memsz, offset, align }) => {
        const a = align > 0x1000n ? align : 0x1000n;
        return { start: vaddr & ~(a - 1n), end: (vaddr + memsz + a - 1n) & ~(a - 1n), skew: (vaddr - offset) % align };
      });
    expect(loads.length).toBeGreaterThan(1);
    for (let i = 1; i < loads.length; i++) expect(loads[i].start).toBeGreaterThanOrEqual(loads[i - 1].end);
    expect(loads.map(l => l.skew)).toEqual(loads.map(() => 0n));
  });

  test.skipIf(!isMacOS).concurrent("Mach-O: the signature is valid", async () => {
    using dir = tempDir("exclude-features", { "app.ts": app });
    const cwd = String(dir);
    expect((await compile(cwd, "without", "--compile-exclude-features=check,lint,fmt")).exitCode).toBe(0);
    const { stderr, exitCode } = await run(["codesign", "--verify", "--strict", "--verbose=2", "without"], cwd);
    expect(stderr).toContain("valid on disk");
    expect(exitCode).toBe(0);
  });
});
