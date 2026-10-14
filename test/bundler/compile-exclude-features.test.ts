// `bun build --compile --compile-exclude-features=<name>` leaves parts of the runtime out of the executable.
//
// What can be left out is said by a table that Bun's build writes into the release binaries of the targets it supports,
// stripped or not (scripts/build/feature-table.ts). A debug or ASAN build has none, and has to say so.

import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isArm64,
  isASAN,
  isCI,
  isDebug,
  isLinux,
  isMacOS,
  isWindows,
  readElf64ProgramHeaders,
  tempDir,
} from "harness";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const exe = (name: string) => (isWindows ? name + ".exe" : name);

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
  transpiled: new Bun.Transpiler({ loader: "ts" }).transformSync("const one: number = 1; export { one };").length > 0,
  verified: await Bun.password.verify("a", await Bun.password.hash("a", { algorithm: "bcrypt", cost: 4 })),
}));
`;
const working = {
  sqlite: { x: 42 },
  fetched: "served",
  shell: "shell",
  sha256: "ca978112",
  gzip: true,
  intl: "1.234,5",
  transpiled: true,
  verified: true,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const compile = (cwd: string, outfile: string, ...args: string[]) =>
  run([bunExe(), "build", "--compile", "app.ts", "--outfile", outfile, ...args], cwd);
/** Runs a compiled executable as the `bun` it holds. */
const asBun = (cwd: string, name: string, ...args: string[]) =>
  run([join(cwd, exe(name)), ...args], cwd, { ...bunEnv, BUN_BE_BUN: "1" });

const noTable = "does not say what can be excluded";
const hasTable = (() => {
  using dir = tempDir("exclude-features-probe", { "app.ts": "" });
  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "app.ts", "--outfile", "app", "--compile-exclude-features=?"],
    cwd: String(dir),
    env: bunEnv,
  });
  return (stdout.toString() + stderr.toString()).includes("These can be excluded:");
})();

// Else every test below could be skipped without anyone noticing that a release lost its table.
test.skipIf(!isCI)("the builds that should be able to exclude features are", () => {
  const isSupportedTarget = isLinux || isMacOS || (isWindows && !isArm64);
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
  const size = (cwd: string, name: string) => statSync(join(cwd, exe(name))).size;
  const files = { "app.ts": app, "one.ts": "export const one = 1;\n", "tsconfig.json": `{ "files": ["one.ts"] }` };
  const commands = { check: ["check"], lint: ["lint", "one.ts"], fmt: ["fmt", "--check", "one.ts"] };
  const features = Object.keys(commands) as (keyof typeof commands)[];

  // What two features share goes only once both are excluded, so each set of them is an executable of its own.
  const sets = Array.from({ length: 1 << features.length }, (_, bits) => features.filter((_, i) => bits & (1 << i)));
  test.concurrent.each(sets.map(set => [set.join(",") || "nothing", set] as const))(
    "without %s",
    async (_, excluded) => {
      using dir = tempDir("exclude-features", files);
      const cwd = String(dir);
      const compiled = await compile(cwd, "app", ...excluded.map(name => `--compile-exclude-features=${name}`));
      expect(compiled.stderr).not.toContain("error");
      expect(compiled.exitCode).toBe(0);

      const ran = await run([join(cwd, exe("app"))], cwd);
      expect(JSON.parse(ran.stdout)).toEqual(working);
      expect(ran.exitCode).toBe(0);

      for (const feature of features) {
        const { stdout, stderr, exitCode } = await asBun(cwd, "app", ...commands[feature]);
        if (excluded.includes(feature)) {
          expect(stderr).toContain("this executable was built without this command");
          expect(exitCode).not.toBe(0);
        } else {
          expect({ feature, output: stdout + stderr, exitCode }).toEqual({
            feature,
            output: expect.any(String),
            exitCode: 0,
          });
        }
      }
    },
  );

  test.concurrent("what is excluded is not in the file", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    const compiled = await Promise.all([
      compile(cwd, "full"),
      compile(cwd, "lint", "--compile-exclude-features=lint"),
      // separated by commas
      compile(cwd, "all", "--compile-exclude-features=check,lint,fmt"),
    ]);
    expect(compiled.map(c => c.exitCode)).toEqual([0, 0, 0]);
    const MB = 1024 * 1024;
    expect(size(cwd, "lint")).toBeLessThan(size(cwd, "full") - 5 * MB);
    expect(size(cwd, "all")).toBeLessThan(size(cwd, "lint") - 5 * MB);
  });

  // What asks for an excluded feature in another way is refused too, not ignored.
  test.concurrent("--check and `check: true` without check", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    expect((await compile(cwd, "app", "--compile-exclude-features=check")).exitCode).toBe(0);
    for (const args of [
      ["build", "--check", "one.ts"],
      ["run", "--check", "one.ts"],
      ["test", "--check"],
      ["--check"],
      ["-e", `await Bun.build({ entrypoints: ["one.ts"], check: true })`],
    ]) {
      const refused = await asBun(cwd, "app", ...args);
      expect(refused.stderr).toContain("this executable was built without type checking");
      expect(refused.exitCode).not.toBe(0);
    }
    // The help does not go through what is gone.
    const help = await asBun(cwd, "app", "check", "--help");
    expect(help.stderr).toContain("this executable was built without this command");
  });

  test.concurrent("Bun.build", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    const result = await Bun.build({
      entrypoints: [join(cwd, "app.ts")],
      compile: { outfile: join(cwd, "app"), excludeFeatures: ["lint", "fmt"] },
    });
    expect(result.success).toBe(true);
    const ran = await run([join(cwd, exe("app"))], cwd);
    expect(JSON.parse(ran.stdout)).toEqual(working);
    expect(ran.exitCode).toBe(0);
    expect((await asBun(cwd, "app", "lint", "one.ts")).stderr).toContain("built without this command");
  });

  test.concurrent("a name that does not exist", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    const { stdout, stderr, exitCode } = await compile(cwd, "app", "--compile-exclude-features=lint,nope");
    expect(stdout + stderr).toContain(
      'there is no feature called "nope". These can be excluded:\n  check\n  lint\n  fmt\n',
    );
    expect(existsSync(join(cwd, exe("app")))).toBe(false);
    expect(exitCode).not.toBe(0);

    const rejected = await Bun.build({
      entrypoints: [join(cwd, "app.ts")],
      compile: { outfile: join(cwd, "app"), excludeFeatures: ["nope"] },
    }).catch(e => e);
    expect(rejected).toBeInstanceOf(AggregateError);
    expect(rejected.errors[0].message).toContain('there is no feature called "nope"');
  });

  // The table is about the executable as it was.
  test.concurrent("features cannot be excluded a second time", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    expect((await compile(cwd, "app", "--compile-exclude-features=lint")).exitCode).toBe(0);
    const from = `--compile-executable-path=${join(cwd, exe("app"))}`;
    const again = await compile(cwd, "again", from, "--compile-exclude-features=fmt");
    expect(again.stdout + again.stderr).toContain(noTable);
    expect(again.exitCode).not.toBe(0);
  });

  // On Windows no compiled executable can: it has a `.bun` section already.
  test.skipIf(isWindows).concurrent("the executable can compile in its turn", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    expect((await compile(cwd, "without", "--compile-exclude-features=check,lint,fmt")).exitCode).toBe(0);
    const compiled = await asBun(cwd, "without", "build", "--compile", "app.ts", "--outfile", "again");
    expect(compiled.stderr).not.toContain("error");
    expect(compiled.exitCode).toBe(0);
    const ran = await run([join(cwd, exe("again"))], cwd);
    expect(JSON.parse(ran.stdout)).toEqual(working);
    expect(ran.exitCode).toBe(0);
  });

  test.skipIf(!isLinux).concurrent("ELF: the program headers", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    expect((await compile(cwd, "without", "--compile-exclude-features=check,lint,fmt")).exitCode).toBe(0);
    const headers = readElf64ProgramHeaders(join(cwd, "without"));
    // Older Linux reads no more than a page of them.
    expect(headers.length * 56).toBeLessThanOrEqual(4096);
    const loads = headers.filter(ph => ph.type === 1 /* PT_LOAD */);
    expect(loads.length).toBeGreaterThan(4);
    expect(loads.map(l => l.vaddr)).toEqual(loads.map(l => l.vaddr).sort((a, b) => (a < b ? -1 : 1)));
    // A loader that honors p_align maps whole multiples of it. See compile-elf-segment-layout.test.ts.
    const spans = loads.map(({ vaddr, memsz, offset, align }) => {
      const a = align > 0x1000n ? align : 0x1000n;
      return { start: vaddr & ~(a - 1n), end: (vaddr + memsz + a - 1n) & ~(a - 1n), skew: (vaddr - offset) % align };
    });
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    expect(spans.map(l => l.skew)).toEqual(spans.map(() => 0n));
    // Older Linux takes the headers to be as far from the start of the image as from the start of the file.
    const [self] = headers.filter(ph => ph.type === 6 /* PT_PHDR */);
    expect(loads[0].offset).toBe(0n);
    expect(self.vaddr - loads[0].vaddr).toBe(self.offset);
    expect(self.offset + self.filesz).toBeLessThanOrEqual(loads[0].filesz);
  });

  // On x64 nothing is signed.
  test.skipIf(!isMacOS || !isArm64).concurrent("Mach-O: the signature is valid", async () => {
    using dir = tempDir("exclude-features", files);
    const cwd = String(dir);
    expect((await compile(cwd, "without", "--compile-exclude-features=check,lint,fmt")).exitCode).toBe(0);
    const { stderr, exitCode } = await run(["codesign", "--verify", "--strict", "--verbose=2", "without"], cwd);
    expect(stderr).toContain("valid on disk");
    expect(exitCode).toBe(0);
  });
});
