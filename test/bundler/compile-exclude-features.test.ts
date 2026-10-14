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
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const exe = (name: string) => (isWindows ? name + ".exe" : name);

const app = `
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const worker = new Worker("data:text/javascript,postMessage(40 + 2)");
const posted = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
worker.terminate();
const server = Bun.serve({ port: 0, fetch: () => new Response("served") });
const fetched = await (await fetch(server.url)).text();
server.stop(true);
console.log(JSON.stringify({
  sqlite: new Database(":memory:").query("select 42 as x").get(),
  posted,
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
  posted: 42,
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

/** What loaders ask of an ELF file with pages left out. */
function expectWellFormedElf(path: string) {
  const headers = readElf64ProgramHeaders(path);
  // Older Linux reads no more than a page of them.
  expect(headers.length * 56).toBeLessThanOrEqual(4096);
  const isLoad = (ph: { type: number }) => ph.type === 1; /* PT_LOAD */
  const loads = headers.filter(isLoad);
  expect(loads.length).toBeGreaterThan(readElf64ProgramHeaders(bunExe()).filter(isLoad).length);
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
}

/** What the Windows loader asks of a PE file with pages left out. */
function expectWellFormedPe(path: string) {
  const file = readFileSync(path);
  const pe = file.readUInt32LE(0x3c);
  const [count, optional] = [file.readUInt16LE(pe + 6), pe + 24];
  const [alignment, sizeOfImage, sizeOfHeaders] = [32, 56, 60].map(at => file.readUInt32LE(optional + at));
  const first = optional + file.readUInt16LE(pe + 20);
  const sections = Array.from({ length: count }, (_, i) => first + i * 40).map(at => ({
    size: file.readUInt32LE(at + 8),
    address: file.readUInt32LE(at + 12),
    rawSize: file.readUInt32LE(at + 16),
    raw: file.readUInt32LE(at + 20),
    flags: file.readUInt32LE(at + 36),
  }));
  const up = (n: number) => Math.ceil(n / alignment) * alignment;
  expect(count).toBeLessThanOrEqual(96);
  expect(first + count * 40).toBeLessThanOrEqual(sizeOfHeaders);
  expect(sizeOfHeaders).toBeLessThanOrEqual(sections[0].address);
  expect(sections.filter(s => s.size === 0)).toEqual([]);
  for (let i = 1; i < count; i++) expect(sections[i].address).toBe(sections[i - 1].address + up(sections[i - 1].size));
  expect(sizeOfImage).toBe(sections[count - 1].address + up(sections[count - 1].size));
  for (const s of sections.filter(s => s.rawSize)) expect(s.raw + s.rawSize).toBeLessThanOrEqual(file.length);
  // What is left out holds nothing, and may not be read, written or run.
  const gaps = sections.filter(s => s.flags >>> 29 === 0);
  expect(gaps.length).toBeGreaterThan(0);
  expect(gaps.filter(s => s.rawSize || s.raw)).toEqual([]);
}

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
  // Each of these writes executables of 100 MB and starts them, next to the others. On Windows that alone takes seconds.
  const timeout = 30_000;
  const size = (cwd: string, name: string) => statSync(join(cwd, exe(name))).size;
  const files = {
    "app.ts": app,
    "one.ts": "export const one = 1;\n",
    "tsconfig.json": `{ "files": ["one.ts"] }`,
    // `bun fmt` runs this in a process of its own, with what `bun lint` runs its plugins with.
    "prettier.config.mjs": "export default { semi: true };\n",
  };
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

      if (excluded.length) {
        if (isLinux) expectWellFormedElf(join(cwd, "app"));
        if (isWindows) expectWellFormedPe(join(cwd, "app.exe"));
        // On x64 nothing is signed.
        if (isMacOS && isArm64) {
          const { stderr, exitCode } = await run(["codesign", "--verify", "--strict", "--verbose=2", "app"], cwd);
          expect(stderr).toContain("valid on disk");
          expect(exitCode).toBe(0);
        }
      }

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
    timeout,
  );

  test.concurrent(
    "what is excluded is not in the file",
    async () => {
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
    },
    timeout,
  );

  // Nothing moves, so it reads against the symbols of the release like any other.
  test.concurrent(
    "a crash report has the addresses it would have had",
    async () => {
      using dir = tempDir("exclude-features", files);
      const cwd = String(dir);
      const compiled = await Promise.all([
        compile(cwd, "full"),
        compile(cwd, "without", "--compile-exclude-features=check,lint,fmt"),
      ]);
      expect(compiled.map(c => c.exitCode)).toEqual([0, 0]);
      const report = async (name: string) => {
        const crash = `require("bun:internal-for-testing").crash_handler.panic()`;
        // Not sent, and not to where CI collects the crashes that nobody meant.
        const to = { BUN_CRASH_REPORT_URL: "http://report.invalid", BUN_ENABLE_CRASH_REPORTING: "0" };
        const env = { ...bunEnv, ...to, BUN_BE_BUN: "1" };
        const { stderr } = await run([join(cwd, exe(name)), "-e", crash], cwd, env);
        return /report\.invalid\/\S+/.exec(stderr)?.[0];
      };
      const [full, without] = await Promise.all([report("full"), report("without")]);
      expect(full).toBeString();
      expect(without).toBe(full);
    },
    timeout,
  );

  // What asks for an excluded feature in another way is refused too, not ignored.
  test.concurrent(
    "--check and `check: true` without check",
    async () => {
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
    },
    timeout,
  );

  test.concurrent(
    "Bun.build",
    async () => {
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
    },
    timeout,
  );

  test.concurrent(
    "a name that does not exist",
    async () => {
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
    },
    timeout,
  );

  // The table is about the executable as it was.
  test.concurrent(
    "features cannot be excluded a second time",
    async () => {
      using dir = tempDir("exclude-features", files);
      const cwd = String(dir);
      expect((await compile(cwd, "app", "--compile-exclude-features=lint")).exitCode).toBe(0);
      const from = `--compile-executable-path=${join(cwd, exe("app"))}`;
      const again = await compile(cwd, "again", from, "--compile-exclude-features=fmt");
      expect(again.stdout + again.stderr).toContain(noTable);
      expect(again.exitCode).not.toBe(0);
    },
    timeout,
  );

  // A release is signed. The signature comes behind everything else in the file, and is of the file as it was.
  test.skipIf(!isWindows).concurrent(
    "PE: from a signed bun",
    async () => {
      using dir = tempDir("exclude-features", files);
      const cwd = String(dir);
      const unsigned = readFileSync(bunExe());
      const directory = unsigned.readUInt32LE(0x3c) + 24 + 112 + 4 * 8; // IMAGE_DIRECTORY_ENTRY_SECURITY
      expect(unsigned.readUInt32LE(directory + 4)).toBe(0);
      const certificate = Buffer.alloc(8 + 1000); // WIN_CERTIFICATE
      certificate.writeUInt32LE(certificate.length, 0);
      certificate.writeUInt16LE(0x200, 4); // WIN_CERT_REVISION_2_0
      certificate.writeUInt16LE(2, 6); // WIN_CERT_TYPE_PKCS_SIGNED_DATA
      const signed = Buffer.concat([unsigned, Buffer.alloc(-unsigned.length & 7), certificate]);
      signed.writeUInt32LE(signed.length - certificate.length, directory);
      signed.writeUInt32LE(certificate.length, directory + 4);
      writeFileSync(join(cwd, "signed.exe"), signed);

      const from = `--compile-executable-path=${join(cwd, "signed.exe")}`;
      const compiled = await compile(cwd, "app", from, "--compile-exclude-features=check,lint,fmt");
      expect(compiled.stdout + compiled.stderr).not.toContain("error");
      expect(compiled.exitCode).toBe(0);
      const ran = await run([join(cwd, "app.exe")], cwd);
      expect(JSON.parse(ran.stdout)).toEqual(working);
      expect(ran.exitCode).toBe(0);
    },
    timeout,
  );

  // On Windows no compiled executable can: it has a `.bun` section already.
  test.skipIf(isWindows).concurrent(
    "the executable can compile in its turn",
    async () => {
      using dir = tempDir("exclude-features", files);
      const cwd = String(dir);
      expect((await compile(cwd, "without", "--compile-exclude-features=check,lint,fmt")).exitCode).toBe(0);
      const compiled = await asBun(cwd, "without", "build", "--compile", "app.ts", "--outfile", "again");
      expect(compiled.stderr).not.toContain("error");
      expect(compiled.exitCode).toBe(0);
      const ran = await run([join(cwd, exe("again"))], cwd);
      expect(JSON.parse(ran.stdout)).toEqual(working);
      expect(ran.exitCode).toBe(0);
    },
    timeout,
  );
});
