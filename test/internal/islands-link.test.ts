import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const wrapper = join(import.meta.dir, "../../scripts/build/islands.ts");
const tools = Object.fromEntries(["clang", "ld.lld", "llvm-cxxfilt", "llvm-nm", "llvm-objcopy"].map(name => [name, Bun.which(name)]));
const canLink = isLinux && Object.values(tools).every(path => path !== null);

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const manyFunctions = (prefix: string) =>
  Array.from(
    { length: 1500 },
    (_, index) => `__attribute__((noinline)) int ${prefix}${index}(int x) { for (int i = 0; i < ${index + 3}; i++) x = x * ${index + 7} + i; return x ^ ${index}; }`,
  ).join("\n");
const callAll = (prefix: string) => Array.from({ length: 1500 }, (_, index) => `x += ${prefix}${index}(x);`).join(" ");

const sources = {
  "behind.c": `
    const char behind_table[62] = "${alphabet}";
    const int behind_numbers[8192] = { 1, 2, 3 };
    ${manyFunctions("behind_")}
    int behind(int x) { ${callAll("behind_")} return x + behind_table[x & 31] + behind_numbers[x & 8191]; }
  `,
  "door.c": `
    int behind(int);
    __attribute__((noinline)) int the_door(int x) { return behind(x) * 3 + behind(x + 1); }
  `,
  "table.c": `const char table_that_stays[62] = "${alphabet}";`,
  "main.c": `
    extern const char table_that_stays[62];
    int the_door(int);
    __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
    __attribute__((noinline)) int stays(int x) { return table_that_stays[x & 31]; }
    int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays(argc) == '1' ? 0 : 1; }
  `,
  "doors": `feature extra what lies behind the door\ndoor extra exit ^the_door$\n`,
};

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

async function linked(folder: string, plan: string) {
  const objects = ["behind", "door", "table", "main"];
  for (const name of objects) {
    const compiled = await run([tools.clang!, "-O1", "-ffunction-sections", "-fdata-sections", "-fno-pic", "-c", `${name}.c`, "-o", `${name}.o`], folder);
    expect(compiled).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  }
  writeFileSync(join(folder, "in.rsp"), objects.map(name => `${name}.o\n`).join(""));
  const flags = ["-fuse-ld=lld", "-no-pie", "-Wl,--gc-sections", "-Wl,--icf=all", "-Wl,-Map=program.map"];
  const said = await run(
    [bunExe(), wrapper, "doors", tools["llvm-cxxfilt"]!, "work", plan, "program.plan", "--", tools.clang!, "@in.rsp", ...flags, "-o", "program"],
    folder,
  );
  expect({ stderr: said.stderr, exitCode: said.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const names = await run([tools["llvm-nm"]!, "program"], folder);
  const addressOf = new Map(names.stdout.split("\n").map(line => [line.split(" ")[2]!, parseInt(line.split(" ")[0]!, 16)]));
  await run([tools["llvm-objcopy"]!, "-O", "binary", "--only-section=.bun_islands", "program", "table.txt"], folder);
  const islands = readFileSync(join(folder, "table.txt"), "latin1")
    .split("\n")
    .filter(line => line.startsWith("island "))
    .map(line => line.split(" "))
    .map(([, start, end]) => [parseInt(start!, 16), parseInt(end!, 16)] as const);
  const canGo = (name: string) => islands.some(([start, end]) => start <= addressOf.get(name)! && addressOf.get(name)! < end);
  return { said: said.stdout, addressOf, canGo, ran: await run([join(folder, "program")], folder) };
}

describe.skipIf(!canLink)("a link with islands", () => {
  test("what only the door reaches can go, code and constants; what stays cannot", async () => {
    using dir = tempDir("islands-link", sources);
    const { canGo, ran } = await linked(String(dir), "none");
    expect(["behind", "behind_0", "behind_1499", "behind_numbers"].map(canGo)).toEqual([true, true, true, true]);
    expect(["main", "stays", "the_door", "Bun__trimmedOut"].map(canGo)).toEqual([false, false, false, false]);
    expect(ran.exitCode).toBe(0);
  });

  test("a constant that stays and was folded into an equal one behind the door cannot go", async () => {
    using dir = tempDir("islands-link", sources);
    const { addressOf, canGo } = await linked(String(dir), "none");
    expect(addressOf.get("table_that_stays")).toBe(addressOf.get("behind_table")!);
    expect(canGo("table_that_stays")).toBe(false);
  });

  test("by its own plan it links once and lists the same", async () => {
    using dir = tempDir("islands-link", sources);
    const folder = String(dir);
    const twice = await linked(folder, "none");
    writeFileSync(join(folder, "earlier.plan"), readFileSync(join(folder, "program.plan")));
    const once = await linked(folder, "earlier.plan");
    expect(twice.said).toContain("first link");
    expect(once.said).not.toContain("first link");
    expect(once.said).toContain("link by an earlier build's plan");
    expect(["behind", "behind_1499", "behind_numbers", "table_that_stays", "stays"].map(once.canGo)).toEqual([true, true, true, false, false]);
  });

  test("a plan that names what stays costs bytes and nothing else", async () => {
    using dir = tempDir("islands-link", sources);
    const folder = String(dir);
    await linked(folder, "none");
    const plan = readFileSync(join(folder, "program.plan"), "utf8").split("\n");
    plan.splice(plan.indexOf("behind_700"), 0, "stays", "main");
    writeFileSync(join(folder, "wrong.plan"), plan.join("\n"));
    const { addressOf, canGo, ran } = await linked(folder, "wrong.plan");
    expect(addressOf.get("stays")!).toBeGreaterThan(addressOf.get("behind_699")!);
    expect(addressOf.get("stays")!).toBeLessThan(addressOf.get("behind_700")!);
    expect(["stays", "main", "behind_0", "behind_1499"].map(canGo)).toEqual([false, false, true, true]);
    expect(ran.exitCode).toBe(0);
  });
});
