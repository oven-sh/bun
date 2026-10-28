import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { test } from "./supported";

// An executable whose program may ask for the system's CA certificates starts loading them on a thread of its own when the process starts:
// a flag of the module graph says so. `bun build --compile` sets it where the text of the program holds the name getCACertificates.
// With --aot the compiler knows what the program reaches, and the name in a string or in code that never runs sets nothing.
const programs = {
  "asks.js": `
    import tls from "node:tls";
    const list = process.argv.includes("--list") ? tls.getCACertificates("system") : [];
    console.log(Array.isArray(list));
  `,
  "asks-for-the-default.js": `
    import { getCACertificates } from "node:tls";
    console.log(getCACertificates().length > 0);
  `,
  "never-asks.js": `
    import tls from "node:tls";
    console.log(tls.rootCertificates.length > 0);
  `,
  "only-spells-the-name.js": `
    import tls from "node:tls";
    console.log("getCACertificates".length === 17, tls.rootCertificates.length > 0);
  `,
};

const trailer = Buffer.from("\n---- Bun! ----\n");
const loadsSystemCertificatesAtStart = 1 << 15;

async function build(name: keyof typeof programs, flags: string[]) {
  using dir = tempDir("system-ca-certificates-by-use", programs);
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", ...flags, name, "--outfile", executable],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  await using program = Bun.spawn({ cmd: [executable], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([program.stdout.text(), program.exited]);
  const bytes = readFileSync(executable);
  const end = bytes.lastIndexOf(trailer);
  expect(end).toBeGreaterThan(4);
  return {
    stdout: stdout.trim(),
    exitCode,
    flag: (bytes.readUInt32LE(end - 4) & loadsSystemCertificatesAtStart) !== 0,
  };
}

test.concurrent.each([
  ["asks.js", "true", true, true],
  ["asks-for-the-default.js", "true", true, true],
  ["never-asks.js", "true", false, false],
  ["only-spells-the-name.js", "true true", true, false],
] as const)(
  "%s",
  async (name, stdout, byText, byReach) => {
    expect(await build(name, [])).toEqual({ stdout, exitCode: 0, flag: byText });
    expect(await build(name, ["--aot"])).toEqual({ stdout, exitCode: 0, flag: byReach });
  },
  240_000,
);
