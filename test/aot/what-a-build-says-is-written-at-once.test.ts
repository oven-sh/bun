import { dlopen, ptr } from "bun:ffi";
import { expect } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, libcPathForDlopen, tempDir } from "harness";
import { closeSync, readSync } from "node:fs";
import { test } from "./supported";

// Another thread, or another process with the same stderr, may write at any time, and what it writes must not come between two parts of
// a message. On Linux a pipe can keep each write as a packet, and one read takes one packet.
function openPipeOfPackets(): [number, number] {
  const O_DIRECT = isArm64 ? 0x10000 : 0x4000;
  const O_CLOEXEC = 0x80000;
  const { symbols } = dlopen(libcPathForDlopen(), { pipe2: { args: ["ptr", "i32"], returns: "i32" } });
  const descriptors = new Int32Array(2);
  if (symbols.pipe2(ptr(descriptors), O_DIRECT | O_CLOEXEC) !== 0) throw new Error("pipe2 failed");
  return [descriptors[0], descriptors[1]];
}

async function readWrites(cmd: string[], cwd: string) {
  const [reading, writing] = openPipeOfPackets();
  await using run = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "ignore", stderr: writing });
  closeSync(writing);
  const buffer = Buffer.alloc(1 << 16);
  const writes: string[] = [];
  for (let length; (length = readSync(reading, buffer)) > 0;) writes.push(buffer.toString("utf8", 0, length));
  closeSync(reading);
  return { writes, exitCode: await run.exited };
}

const files = {
  "package.json": `{ "name": "written-at-once" }`,
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "nothingOfThisName": true } }`,
  "node_modules/@types/bun/package.json": `{ "name": "@types/bun", "version": "1.0.0", "types": "index.d.ts" }`,
  "node_modules/@types/bun/index.d.ts": `declare module "bun:test" {
  export function test(name: string, run: () => void): void;
  export function expect(value: unknown): { toBe(expected: unknown): void };
}
declare var console: { log(...data: unknown[]): void };
`,
  "one.test.ts": `import { expect, test } from "bun:test";\ntest("one", () => { expect(1).toBe(1); });\n`,
  "main.ts": `console.log(1);\n`,
};

test.skipIf(!isLinux)("the warnings in front of a test run are one write", async () => {
  using dir = tempDir("written-at-once", files);
  const { writes, exitCode } = await readWrites([bunExe(), "test", "--aot"], String(dir));
  const warnings = writes.filter(it => it.includes("TS5023"));
  expect(warnings).toEqual([expect.stringContaining("warn: TS5023: Unknown compiler option 'nothingOfThisName'.")]);
  expect(warnings[0]).toContain(`"nothingOfThisName": true`);
  expect(warnings[0]).toContain("tsconfig.json:1:");
  expect(writes.join("")).toContain(" 1 pass");
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux)("the errors that stop a build are one write", async () => {
  using dir = tempDir("written-at-once", files);
  const { writes, exitCode } = await readWrites(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "out"],
    String(dir),
  );
  const errors = writes.filter(it => it.includes("TS5023"));
  expect(errors).toEqual([expect.stringContaining("error: TS5023: Unknown compiler option 'nothingOfThisName'.")]);
  expect(errors[0]).toContain("tsconfig.json:1:");
  expect(exitCode).toBe(1);
});
