import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";

// With oven-sh/WebKit#965, JavaScriptCore guards the pages of LLInt and of JIT code where the processor has branch target
// identification: an indirect branch into them traps unless it lands on a landing pad.
const hasBranchTargetIdentification = isLinux && isArm64 && /\bbti\b/.test(readFileSync("/proc/cpuinfo", "utf8"));

// Prints the mappings of this process that are guarded ("bt" in VmFlags), and how far the first one of the executable is from
// where the executable begins. Given such a distance and "call", it calls what is there.
const script = `
const fs = require("fs");
const mappings = fs.readFileSync("/proc/self/smaps", "utf8").split(/\\n(?=[0-9a-f]+-[0-9a-f]+ )/).map(text => {
  const [range, permissions, , , , ...path] = text.split("\\n")[0].split(/\\s+/);
  return { start: BigInt("0x" + range.split("-")[0]), range, permissions, path: path.join(" "), guarded: /^VmFlags:.*\\bbt\\b/m.test(text) };
});
const executable = fs.realpathSync(process.execPath);
const base = mappings.find(mapping => mapping.path === executable).start;
const guarded = mappings.filter(mapping => mapping.guarded);
const first = guarded.find(mapping => mapping.path === executable);
const distance = process.argv[2] ? BigInt(process.argv[2]) : first ? first.start - base : -1n;
fs.writeSync(1, JSON.stringify({
  ofExecutable: guarded.filter(mapping => mapping.path === executable).map(mapping => mapping.range + " " + mapping.permissions),
  anonymous: guarded.filter(mapping => !mapping.path).map(mapping => mapping.range + " " + mapping.permissions),
  distance: String(distance),
}) + "\\n");
if (process.argv[3] === "call") {
  const { CFunction } = require("bun:ffi");
  new CFunction({ ptr: Number(base + distance), args: [], returns: "void" })();
  fs.writeSync(1, "returned\\n");
}
`;

async function run(dir: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "script.js", ...args],
    env: { ...bunEnv, ...env },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.if(hasBranchTargetIdentification)("the pages of LLInt and of JIT code are guarded", async () => {
  using dir = tempDir("branch-target-identification", { "script.js": script });
  const { stdout, exitCode } = await run(String(dir), []);
  console.log(stdout);
  const { ofExecutable, anonymous } = JSON.parse(stdout);
  expect(ofExecutable.length).toBeGreaterThan(0);
  expect(anonymous.length).toBeGreaterThan(0);
  expect(exitCode).toBe(0);

  const without = await run(String(dir), [], { BUN_JSC_useBranchTargetIdentification: "0" });
  console.log(without.stdout);
  expect(JSON.parse(without.stdout)).toMatchObject({ ofExecutable: [], anonymous: [] });
});

// The first guarded page of the executable begins with a nop, a landing pad and a breakpoint. A call of the nop traps because of
// the guard. Without the guard it gets to the breakpoint.
test.if(hasBranchTargetIdentification)("an indirect branch past a landing pad traps", async () => {
  using dir = tempDir("branch-target-identification", { "script.js": script });
  const { distance } = JSON.parse((await run(String(dir), [])).stdout);
  expect(BigInt(distance)).toBeGreaterThan(0n);

  const guarded = await run(String(dir), [distance, "call"]);
  const unguarded = await run(String(dir), [distance, "call"], { BUN_JSC_useBranchTargetIdentification: "0" });
  for (const [name, result] of Object.entries({ guarded, unguarded }))
    console.log(name, result.exitCode, result.signalCode, result.stderr.split("\n").slice(0, 6).join(" | "));

  expect(guarded.stdout).not.toContain("returned");
  expect(unguarded.stdout).not.toContain("returned");
  expect(guarded.signalCode ?? guarded.exitCode).toBeOneOf(["SIGILL", 132]);
  expect(unguarded.signalCode ?? unguarded.exitCode).toBeOneOf(["SIGTRAP", 133]);
});
