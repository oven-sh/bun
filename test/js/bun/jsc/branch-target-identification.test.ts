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

// Why neither JavaScriptCore's C++ nor Bun is compiled with +bti: which register holds the target of a jump counts only for a
// jump that is in a guarded page itself. From any other page it may land where a call may.
const jump = `
const { dlopen, CFunction, toArrayBuffer } = require("bun:ffi");
const { mmap, mprotect } = dlopen("libc.so.6", {
  mmap: { args: ["ptr", "usize", "i32", "i32", "i32", "i64"], returns: "ptr" },
  mprotect: { args: ["ptr", "usize", "i32"], returns: "i32" },
}).symbols;
const { __clear_cache } = dlopen("libgcc_s.so.1", { __clear_cache: { args: ["ptr", "ptr"], returns: "void" } }).symbols;
const size = 65536;
function page(guarded, instructions) {
  const address = mmap(null, size, 3, 0x22, -1, 0); // PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS
  new Uint32Array(toArrayBuffer(address, 0, instructions.length * 4)).set(instructions);
  if (mprotect(address, size, 5 | (guarded ? 0x10 : 0))) throw new Error("mprotect"); // PROT_READ | PROT_EXEC, PROT_BTI
  __clear_cache(address, address + size);
  return address;
}
const [register, from, to] = process.argv.slice(2);
const ret = 0xd65f03c0;
const target = page(true, { "bti c": [0xd503245f, ret], "bti j": [0xd503249f, ret], "nop": [0xd503201f, ret] }[to]);
// bti c; mov register, x0; br register
const jumper = page(from === "guarded", { x2: [0xd503245f, 0xaa0003e2, 0xd61f0040], x16: [0xd503245f, 0xaa0003f0, 0xd61f0200] }[register]);
new CFunction({ ptr: jumper, args: ["ptr"], returns: "void" })(target);
require("fs").writeSync(1, "landed\\n");
`;

test.if(hasBranchTargetIdentification)("only a jump in a guarded page needs its target in x16 or x17", async () => {
  using dir = tempDir("branch-target-identification", { "script.js": jump });
  const rows: string[][] = [];
  for (const from of ["unguarded", "guarded"])
    for (const register of ["x2", "x16"]) for (const to of ["bti c", "bti j", "nop"]) rows.push([register, from, to]);
  const results = await Promise.all(
    rows.map(async row => {
      const { stdout, stderr, exitCode, signalCode } = await run(String(dir), row);
      const trapped = signalCode === "SIGILL" || exitCode === 132;
      return `br ${row[0]} in a page that is ${row[1]}, to ${row[2]}: ${stdout.includes("landed") && exitCode === 0 ? "lands" : trapped ? "traps" : `exit ${exitCode} ${signalCode} ${stderr.slice(0, 300)}`}`;
    }),
  );
  expect(results).toEqual([
    "br x2 in a page that is unguarded, to bti c: lands",
    "br x2 in a page that is unguarded, to bti j: lands",
    "br x2 in a page that is unguarded, to nop: traps",
    "br x16 in a page that is unguarded, to bti c: lands",
    "br x16 in a page that is unguarded, to bti j: lands",
    "br x16 in a page that is unguarded, to nop: traps",
    "br x2 in a page that is guarded, to bti c: traps",
    "br x2 in a page that is guarded, to bti j: lands",
    "br x2 in a page that is guarded, to nop: traps",
    "br x16 in a page that is guarded, to bti c: lands",
    "br x16 in a page that is guarded, to bti j: lands",
    "br x16 in a page that is guarded, to nop: traps",
  ]);
});
