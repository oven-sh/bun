import { spawn } from "bun";
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "../aot/supported";

setDefaultTimeout(60_000);

const root = isWindows ? "B:\\~BUN\\root\\" : "/$bunfs/root/";

if (isASAN)
  console.error(
    "SKIPPED: compile-aot-crash.test.ts: in a Bun built with AddressSanitizer its handler answers a segmentation fault, not Bun's",
  );

const files = {
  "ffi.d.ts": `declare module "bun:ffi" {
  export const read: { u8(pointer: number, offset: number): number };
}
`,
  "app.ts": `
import { read } from "bun:ffi";
class Reader {
  constructor(public base: number) {}
  byteAt(offset: number): number {
    return read.u8(this.base + offset, 0) + 1;
  }
  peek(offset: number): number {
    return this.byteAt(offset);
  }
}
function sum(reader: Reader): number {
  let total = 0;
  for (let i = 0; i < 3; i++) total += reader.peek(i);
  return total;
}
function start(): number {
  const total = sum(new Reader(8));
  return total + 1;
}
console.log("before");
console.log(start());
`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
};

const folders: string[] = [];
afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));
async function crashed(flags: string[]) {
  const dir = String(tempDir("compile-aot-crash", files));
  folders.push(dir);
  await using build = spawn({
    cmd: [bunExe(), "build", "--compile", ...flags, "app.ts", "--outfile", "app"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(buildErrors).not.toContain("error");
  expect(buildExitCode).toBe(0);
  await using run = spawn({
    // It crashes on purpose, and leaves no core file.
    cmd: isWindows ? [join(dir, "app")] : ["/bin/sh", "-c", 'ulimit -c 0 && exec "$@"', "--", join(dir, "app")],
    cwd: dir,
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(stdout).toBe("before\n");
  expect(stderr).toContain("Segmentation fault at address 0x8");
  expect(isWindows ? run.exitCode : run.signalCode).toBe(isWindows ? 3 : "SIGSEGV");
  return { stderr, exe: join(dir, "app") };
}

test.if(!isASAN)("a crash in compiled code lists the compiled functions on the stack", async () => {
  const { stderr, exe } = await crashed(["--aot"]);
  expect(stderr).toMatch(/^Features: .*\baot\b/m);
  const start = stderr.indexOf("Compiled JavaScript on the stack:\n");
  expect(start).toBeGreaterThan(-1);
  const frames = stderr
    .slice(start)
    .split("\n")
    .slice(1)
    .filter(line => line.startsWith("    at "));
  expect(frames).toEqual([
    `    at byteAt (${root}app.ts:6:17)`,
    `    at sum (${root}app.ts:14:47)`,
    `    at start (${root}app.ts:18:17)`,
    `    at ${root}app.ts:22:13`,
  ]);
  const url = stderr.match(/^ (\S*CGaot\S*)$/m)![1];
  for (const word of ["byteAt", "peek", "sum", "start", "app.ts"]) expect(url).not.toContain(word);

  const decoded = async (report: string) => {
    await using proc = spawn({
      cmd: [exe],
      env: { ...bunEnv, BUN_OPTIONS: "--aot-decode-crash-report=" + report },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  expect(await decoded(url)).toEqual({ stdout: frames.join("\n") + "\n", stderr: "", exitCode: 0 });
  expect(await decoded("https://bun.report/1.4.4/M_24eaedc6EggggC__m5/43EA2AA")).toEqual({
    stdout: "",
    stderr: "error: --aot-decode-crash-report: that report has no frames from this executable's compiled code\n",
    exitCode: 1,
  });
});

test.if(!isASAN)("a crash in an executable built without --aot does not mention compiled code", async () => {
  const { stderr } = await crashed([]);
  expect(stderr).not.toMatch(/^Features: .*\baot\b/m);
  expect(stderr).not.toContain("Compiled JavaScript on the stack");
});
