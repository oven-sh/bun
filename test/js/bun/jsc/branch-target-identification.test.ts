import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";

// With oven-sh/WebKit#965, JavaScriptCore guards the pages of LLInt and of JIT code where the processor has branch target
// identification: an indirect branch into them traps unless it lands on a landing pad.
const hasBranchTargetIdentification = isLinux && isArm64 && /\bbti\b/.test(readFileSync("/proc/cpuinfo", "utf8"));

// Prints the mappings of this process that are guarded ("bt" in VmFlags), and how far from where the executable begins LLInt has a
// landing pad and a return (llint_landing_pad_and_return). Given a distance and "call", it calls what is there.
const script = `
const fs = require("fs");
const mappings = fs.readFileSync("/proc/self/smaps", "utf8").split(/\\n(?=[0-9a-f]+-[0-9a-f]+ )/).map(text => {
  const [range, permissions, , , , ...path] = text.split("\\n")[0].split(/\\s+/);
  return { start: BigInt("0x" + range.split("-")[0]), range, permissions, path: path.join(" "), guarded: /^VmFlags:.*\\bbt\\b/m.test(text) };
});
const executable = fs.realpathSync(process.execPath);
const base = mappings.find(mapping => mapping.path === executable).start;
const guarded = mappings.filter(mapping => mapping.guarded);
const { CFunction, toArrayBuffer } = require("bun:ffi");
let distance = process.argv[2] ? BigInt(process.argv[2]) : -1n;
for (const mapping of distance < 0n ? guarded.filter(mapping => mapping.path === executable) : []) {
  const instructions = new Uint32Array(toArrayBuffer(Number(mapping.start), 0, Number(BigInt("0x" + mapping.range.split("-")[1]) - mapping.start)));
  const index = instructions.findIndex((instruction, i) => instruction === 0xd503245f && instructions[i + 1] === 0xd65f03c0); // bti c, ret
  if (index >= 0) distance = mapping.start + BigInt(index * 4) - base;
}
fs.writeSync(1, JSON.stringify({
  ofExecutable: guarded.filter(mapping => mapping.path === executable).map(mapping => mapping.range + " " + mapping.permissions),
  anonymous: guarded.filter(mapping => !mapping.path).map(mapping => mapping.range + " " + mapping.permissions),
  distance: String(distance),
}) + "\\n");
if (process.argv[3] === "call") {
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

// Not anywhere in a guarded page: a breakpoint is a breakpoint wherever the branch to it came from, and what is no return goes on.
test.if(hasBranchTargetIdentification)("an indirect branch past a landing pad traps", async () => {
  using dir = tempDir("branch-target-identification", { "script.js": script });
  const distance = BigInt(JSON.parse((await run(String(dir), [])).stdout).distance);
  expect(distance).toBeGreaterThan(0n);

  const off = { BUN_JSC_useBranchTargetIdentification: "0" };
  const results = {
    toLandingPad: await run(String(dir), [String(distance), "call"]),
    pastLandingPad: await run(String(dir), [String(distance + 4n), "call"]),
    pastLandingPadWithoutGuard: await run(String(dir), [String(distance + 4n), "call"], off),
  };
  for (const [name, result] of Object.entries(results))
    console.log(
      name,
      result.exitCode,
      result.signalCode,
      result.stderr.match(/^.*(?:panic|at address).*$/m)?.[0] ?? "",
    );

  expect(results.toLandingPad.stdout).toContain("returned");
  expect(results.toLandingPad.exitCode).toBe(0);
  expect(results.pastLandingPadWithoutGuard.stdout).toContain("returned");
  expect(results.pastLandingPadWithoutGuard.exitCode).toBe(0);
  expect(results.pastLandingPad.stdout).not.toContain("returned");
  expect(results.pastLandingPad.signalCode ?? results.pastLandingPad.exitCode).toBeOneOf(["SIGILL", 132]);
});
