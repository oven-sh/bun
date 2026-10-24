import { expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "../aot/harness/run";

setDefaultTimeout(120_000);

const isUnsupportedHere = (stderr: string) =>
  /^error: (--aot |ahead-of-time compilation )(only supports|isn't available)/m.test(stderr);

async function build(dir: string, executablePath: string) {
  const { stderr, exitCode } = await runCommand(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--compile-executable-path",
      executablePath,
      "entry.ts",
      "--outfile",
      "out",
    ],
    dir,
    { ...bunEnv, NO_COLOR: "1" },
  );
  return { stderr, exitCode };
}

const files = { "entry.ts": `const n: number = 1 + 1;\nconsole.log("answer", n);\n` };

// The note of the linker: name size 4, description size 20, NT_GNU_BUILD_ID, "GNU".
const buildIdNote = Buffer.from([4, 0, 0, 0, 20, 0, 0, 0, 3, 0, 0, 0, 0x47, 0x4e, 0x55, 0]);

test("--compile-executable-path with --aot takes another path to this Bun", async () => {
  using dir = tempDir("aot-executable-path-same", files);
  if (isWindows) copyFileSync(bunExe(), join(String(dir), "same-bun.exe"));
  else symlinkSync(bunExe(), join(String(dir), "same-bun.exe"));
  const { stderr, exitCode } = await build(String(dir), "./same-bun.exe");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const { stdout, stderr: runStderr, exitCode: runExitCode } = await runCommand([join(String(dir), "out")]);
  expect({ stdout, stderr: runStderr }).toEqual({ stdout: "answer 2\n", stderr: "" });
  expect(runExitCode).toBe(0);
});

async function expectAnswer(dir: string) {
  const { stdout, stderr, exitCode } = await runCommand([join(dir, "out")]);
  expect({ stdout, stderr }).toEqual({ stdout: "answer 2\n", stderr: "" });
  expect(exitCode).toBe(0);
}

function findRuntimeDescription(file: Buffer): number {
  const magic = Buffer.from("BUNAOTRT", "latin1");
  // Bun's own code holds the same eight bytes as an immediate.
  for (let at = file.indexOf(magic); at >= 0; at = file.indexOf(magic, at + 1)) {
    if (at + 32 <= file.length && file.readUInt32LE(at + 8) === 32 + 4 * file.readUInt32LE(at + 12)) return at;
  }
  return -1;
}

function writeOther(dir: string, name: string, bytes: Buffer) {
  writeFileSync(join(dir, name), bytes);
  chmodSync(join(dir, name), 0o755);
}

test.skipIf(!isLinux)("--compile-executable-path with --aot takes another link of the same run time", async () => {
  using dir = tempDir("aot-executable-path-another-link", files);
  const other = readFileSync(bunExe());
  const note = other.indexOf(buildIdNote);
  if (note < 0) return;
  other[note + 16] ^= 0xff;
  writeOther(String(dir), "another-link", other);
  const { stderr, exitCode } = await build(String(dir), "./another-link");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const out = readFileSync(join(String(dir), "out"));
  expect(out.subarray(note + 16, note + 32).equals(other.subarray(note + 16, note + 32))).toBe(true);
  await expectAnswer(String(dir));
});

test.skipIf(!isLinux)(
  "--compile-executable-path with --aot refuses a run time that differs, and says in what",
  async () => {
    using dir = tempDir("aot-executable-path-differs", files);
    const other = readFileSync(bunExe());
    const description = findRuntimeDescription(other);
    if (description < 0) return;
    const entries = description + 32 + 2 * 4;
    const here = other.readUInt32LE(entries);
    other.writeUInt32LE(here + 1, entries);
    writeOther(String(dir), "differs", other);
    const { stderr, exitCode } = await build(String(dir), "./differs");
    if (isUnsupportedHere(stderr)) return;
    expect(stderr).toContain(
      `error: ./differs can't run code compiled by this Bun: the number of entries in the table of the run time is ${here + 1} there and ${here} here`,
    );
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "out"))).toBe(false);
  },
);

test.skipIf(!isLinux)(
  "--compile-executable-path with --aot refuses a run time that takes another version of the image format",
  async () => {
    using dir = tempDir("aot-executable-path-format-version", files);
    const other = readFileSync(bunExe());
    const description = findRuntimeDescription(other);
    if (description < 0) return;
    const here = other.readUInt32LE(description + 28);
    other.writeUInt32LE(here + 1, description + 28);
    writeOther(String(dir), "format-version", other);
    const { stderr, exitCode } = await build(String(dir), "./format-version");
    if (isUnsupportedHere(stderr)) return;
    expect(stderr).toContain(
      `error: ./format-version can't run code compiled by this Bun: the version of the image format is ${here + 1} there and ${here} here`,
    );
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "out"))).toBe(false);
  },
);

test.skipIf(!isLinux)("the description of the run time names the version of the image format", async () => {
  using dir = tempDir("aot-executable-path-names-format-version", files);
  const { stderr, exitCode } = await build(String(dir), bunExe());
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  const out = readFileSync(join(String(dir), "out"));
  const versionsOfImages: number[] = [];
  // An image starts on a page. Bun's own code holds the same eight bytes as an immediate.
  for (let at = out.indexOf("BUNAOT01"); at >= 0; at = out.indexOf("BUNAOT01", at + 1)) {
    if (at % 4096 === 0) versionsOfImages.push(out.readUInt32LE(at + 0x48));
  }
  const named = out.readUInt32LE(findRuntimeDescription(out) + 28);
  expect(named).toBeGreaterThan(0);
  expect(versionsOfImages).toEqual([named]);
});

test.skipIf(!isLinux)("--compile-executable-path with --aot refuses another revision of Bun", async () => {
  using dir = tempDir("aot-executable-path-revision", files);
  const other = readFileSync(bunExe());
  const record = other.indexOf(Buffer.from("BUNAOTHO\x38\0\0\0", "latin1"));
  if (record < 0) return;
  const revision = other.latin1Slice(record + 16, record + 56).replace(/\0+$/, "");
  if (!revision) return;
  const changed = (revision[0] === "f" ? "e" : "f") + revision.slice(1);
  other.write(changed, record + 16, "latin1");
  writeOther(String(dir), "revision", other);
  const { stderr, exitCode } = await build(String(dir), "./revision");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain(
    `error: ./revision can't run code compiled by this Bun: it is revision ${changed} of Bun and this is ${revision}`,
  );
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test.skipIf(!isLinux)(
  "--compile-executable-path with --aot refuses a Bun whose description it cannot read",
  async () => {
    using dir = tempDir("aot-executable-path-unreadable", files);
    const other = readFileSync(bunExe());
    const description = findRuntimeDescription(other);
    if (description < 0) return;
    other[description] ^= 0xff;
    writeOther(String(dir), "unreadable", other);
    const { stderr, exitCode } = await build(String(dir), "./unreadable");
    if (isUnsupportedHere(stderr)) return;
    expect(stderr).toContain(
      "error: ./unreadable can't run code compiled by this Bun: its description of the run time can't be read",
    );
    expect(exitCode).toBe(1);
    expect(existsSync(join(String(dir), "out"))).toBe(false);
  },
);

test.skipIf(!isLinux)("--compile-executable-path with --aot rejects a Bun that has no build id", async () => {
  using dir = tempDir("aot-executable-path-unidentified", files);
  const other = readFileSync(bunExe());
  const note = other.indexOf(buildIdNote);
  if (note < 0) return;
  other[note + 8] = 0;
  writeFileSync(join(String(dir), "no-build-id"), other);
  chmodSync(join(String(dir), "no-build-id"), 0o755);
  const { stderr, exitCode } = await build(String(dir), "./no-build-id");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toMatch(/^error: .*no-build-id/m);
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("--compile-executable-path with --aot refuses a file that is not a Bun", async () => {
  using dir = tempDir("aot-executable-path-other", { ...files, "no-bun": "#!/bin/sh\nexit 0\n" });
  const { stderr, exitCode } = await build(String(dir), "./no-bun");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain(
    "error: ./no-bun can't run code compiled by this Bun. It isn't a Bun executable, or it's a different version. Use the same version of Bun, built for this platform",
  );
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});

test("--compile-executable-path with --aot names a file that does not exist", async () => {
  using dir = tempDir("aot-executable-path-missing", files);
  const { stderr, exitCode } = await build(String(dir), "./nothing");
  if (isUnsupportedHere(stderr)) return;
  expect(stderr).toContain("error: failed to read executable for ");
  expect(stderr).toContain("ENOENT");
  expect(exitCode).toBe(1);
  expect(existsSync(join(String(dir), "out"))).toBe(false);
});
