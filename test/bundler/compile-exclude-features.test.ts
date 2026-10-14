// `bun build --compile --compile-exclude-features=<name>` leaves parts of the runtime out of the executable.
//
// A feature is crates that the rest of Bun does not depend on (src/bun_core/feature.rs). Every build of Bun has its doors. Its
// code is in sections of its own, which can leave the file, where Bun's build could load its compiler pass
// (scripts/build/rust/features.ts).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, isMacOS, isWindows, readElf64ProgramHeaders, tempDir } from "harness";
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

const alreadyExcluded = "does not say what can be excluded";

test("requires --compile", async () => {
  using dir = tempDir("exclude-features", { "app.ts": app });
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "app.ts", "--outdir", "out", "--compile-exclude-features=lint"],
    String(dir),
  );
  expect(stderr).toContain("--compile-exclude-features requires --compile");
  expect(exitCode).not.toBe(0);
});

describe("--compile-exclude-features", () => {
  const commands = { check: ["check"], lint: ["lint", "one.ts"], fmt: ["fmt", "--check", "one.ts"] };
  const features = Object.keys(commands) as (keyof typeof commands)[];
  // What two features share goes only once both are excluded, so each set of them is an executable of its own.
  const sets = Array.from({ length: 1 << features.length }, (_, bits) => features.filter((_, i) => bits & (1 << i)));
  const without = (...set: string[]) => "without-" + (set.join("-") || "nothing");
  const expectToWork = async (name: string) => {
    const ran = await run([join(cwd, exe(name))], cwd);
    expect(JSON.parse(ran.stdout)).toEqual(working);
    expect(ran.exitCode).toBe(0);
  };

  // Each is 100 MB, so each is written once, for all the tests. None of them writes to what another reads.
  let dir: ReturnType<typeof tempDir>;
  let cwd: string;
  beforeAll(async () => {
    dir = tempDir("exclude-features", {
      "app.ts": app,
      "one.ts": "export const one = 1;\n",
      "tsconfig.json": `{ "files": ["one.ts"] }`,
      // `bun fmt` runs this in a process of its own, with what `bun lint` runs its plugins with.
      "prettier.config.mjs": "export default { semi: true };\n",
    });
    cwd = String(dir);
    // Given several times, or separated by commas.
    const flags = (set: string[]) => (set.length === 2 ? set : set.length ? [set.join(",")] : []);
    const compiled = await Promise.all(
      sets.map(set => compile(cwd, without(...set), ...flags(set).map(names => `--compile-exclude-features=${names}`))),
    );
    expect(compiled.map(c => c.stderr).join("")).not.toContain("error");
    expect(compiled.map(c => c.exitCode)).toEqual(sets.map(() => 0));
  });
  afterAll(async () => {
    // Windows goes on with a report of its own about a crash, and has the executable open for that long.
    for (const deadline = Date.now() + 20_000; ; await Bun.sleep(100)) {
      try {
        return dir[Symbol.dispose]();
      } catch (e) {
        if (!isWindows || Date.now() > deadline) throw e;
      }
    }
  });

  test.concurrent.each(sets.map(set => [set.join(",") || "nothing", set] as const))(
    "without %s",
    async (_, excluded) => {
      const name = without(...excluded);
      await expectToWork(name);

      // `bun fmt` depends on the crates of `bun lint`, so those go once both are excluded.
      const leavesTheFile = excluded.includes("check") || (excluded.includes("lint") && excluded.includes("fmt"));
      if (leavesTheFile) {
        if (isLinux) expectWellFormedElf(join(cwd, name));
        if (isWindows) expectWellFormedPe(join(cwd, exe(name)));
        // On x64 nothing is signed.
        if (isMacOS && isArm64) {
          const { stderr, exitCode } = await run(["codesign", "--verify", "--strict", "--verbose=2", name], cwd);
          expect(stderr).toContain("valid on disk");
          expect(exitCode).toBe(0);
        }
      }

      for (const feature of features) {
        const { stdout, stderr, exitCode } = await asBun(cwd, name, ...commands[feature]);
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

  test("what is excluded is not in the file", () => {
    const size = (...set: string[]) => statSync(join(cwd, exe(without(...set)))).size;
    const MB = 1024 * 1024;
    expect(size("lint", "fmt")).toBeLessThan(size() - 5 * MB);
    expect(size(...features)).toBeLessThan(size("lint", "fmt") - 5 * MB);
  });

  // Nothing moves, so it reads against the symbols of the release like any other.
  test.concurrent("a crash report has the addresses it would have had", async () => {
    const report = async (name: string) => {
      const crash = `require("bun:internal-for-testing").crash_handler.panic()`;
      // Not sent, and not to where CI collects the crashes that nobody meant.
      const to = { BUN_CRASH_REPORT_URL: "http://report.invalid", BUN_ENABLE_CRASH_REPORTING: "0" };
      const env = { ...bunEnv, ...to, BUN_BE_BUN: "1" };
      const { stderr } = await run([join(cwd, exe(name)), "-e", crash], cwd, env);
      return /report\.invalid\/\S+/.exec(stderr)?.[0];
    };
    const [full, slim] = await Promise.all([report(without()), report(without(...features))]);
    expect(full).toBeString();
    expect(slim).toBe(full);
  });

  // What asks for an excluded feature in another way is refused too, not ignored.
  test.concurrent("--check and `check: true` without check", async () => {
    for (const args of [
      ["build", "--check", "one.ts"],
      ["run", "--check", "one.ts"],
      ["test", "--check"],
      ["--check"],
      ["-e", `await Bun.build({ entrypoints: ["one.ts"], check: true })`],
    ]) {
      const refused = await asBun(cwd, without("check"), ...args);
      expect(refused.stderr).toContain("this executable was built without type checking");
      expect(refused.exitCode).not.toBe(0);
    }
    // The help does not go through what is gone.
    const help = await asBun(cwd, without("check"), "check", "--help");
    expect(help.stderr).toContain("this executable was built without this command");
  });

  test.concurrent("Bun.build", async () => {
    const result = await Bun.build({
      entrypoints: [join(cwd, "app.ts")],
      compile: { outfile: join(cwd, "from-the-api"), excludeFeatures: ["lint", "fmt"] },
    });
    expect(result.success).toBe(true);
    await expectToWork("from-the-api");
    expect((await asBun(cwd, "from-the-api", "lint", "one.ts")).stderr).toContain("built without this command");
  });

  test.concurrent("a name that does not exist", async () => {
    const { stdout, stderr, exitCode } = await compile(cwd, "nope", "--compile-exclude-features=lint,nope");
    expect(stdout + stderr).toContain(
      'there is no feature called "nope". These can be excluded:\n  check\n  lint\n  fmt\n',
    );
    expect(existsSync(join(cwd, exe("nope")))).toBe(false);
    expect(exitCode).not.toBe(0);

    const rejected = await Bun.build({
      entrypoints: [join(cwd, "app.ts")],
      compile: { outfile: join(cwd, "nope"), excludeFeatures: ["nope"] },
    }).catch(e => e);
    expect(rejected).toBeInstanceOf(AggregateError);
    expect(rejected.errors[0].message).toContain('there is no feature called "nope"');
  });

  // The table is about the executable as it was.
  test.concurrent("features cannot be excluded a second time", async () => {
    const from = `--compile-executable-path=${join(cwd, exe(without("lint")))}`;
    const again = await compile(cwd, "a-second-time", from, "--compile-exclude-features=fmt");
    expect(again.stdout + again.stderr).toContain(alreadyExcluded);
    expect(again.exitCode).not.toBe(0);
  });

  // A release is signed. The signature comes behind everything else in the file, and is of the file as it was.
  test.skipIf(!isWindows).concurrent("PE: from a signed bun", async () => {
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
    const compiled = await compile(cwd, "from-signed", from, "--compile-exclude-features=check,lint,fmt");
    expect(compiled.stdout + compiled.stderr).not.toContain("error");
    expect(compiled.exitCode).toBe(0);
    await expectToWork("from-signed");
  });

  // On Windows no compiled executable can: it has a `.bun` section already.
  test.skipIf(isWindows).concurrent("the executable can compile in its turn", async () => {
    const compiled = await asBun(cwd, without(...features), "build", "--compile", "app.ts", "--outfile", "in-its-turn");
    expect(compiled.stderr).not.toContain("error");
    expect(compiled.exitCode).toBe(0);
    await expectToWork("in-its-turn");
  });
});
