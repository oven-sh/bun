import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeTable } from "../../scripts/build/islands-layout.ts";
import { packageOf } from "./icu-data-package.ts";
import { shutDoors } from "./islands-shut-doors.ts";

const wrapper = join(import.meta.dir, "../../scripts/build/islands.ts");
const tools = Object.fromEntries(["clang", "ld.lld", "llvm-cxxfilt", "llvm-nm", "llvm-objcopy"].map(name => [name, Bun.which(name)]));
const canLink = isLinux && Object.values(tools).every(path => path !== null);
const hasCxxRuntime =
  canLink && Bun.spawnSync({ cmd: [tools.clang!, "-x", "c++", "-fuse-ld=lld", "-lstdc++", "-o", "/dev/null", "-"], stdin: Buffer.from("int main() { try { throw 1; } catch (int) {} }"), env: bunEnv }).exitCode === 0;

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

async function wrapped(folder: string, plan: string, objects: string[], compileFlags: Record<string, string[]>, linkFlags: string[]) {
  for (const name of objects) {
    const flags = ["-O1", "-ffunction-sections", "-fdata-sections", "-fno-pic", ...(compileFlags[name] ?? [])];
    const compiled = await run([tools.clang!, ...flags, "-c", `${name}.c`, "-o", `${name}.o`], folder);
    expect(compiled).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  }
  writeFileSync(join(folder, "in.rsp"), objects.map(name => `${name}.o\n`).join(""));
  const flags = [`--ld-path=${tools["ld.lld"]}`, "-no-pie", "-Wl,--gc-sections", "-Wl,--icf=all", "-Wl,-Map=program.map", ...linkFlags];
  return await run(
    [bunExe(), wrapper, "doors", tools["llvm-cxxfilt"]!, "work", plan, "program.plan", "--", tools.clang!, "@in.rsp", ...flags, "-o", "program"],
    folder,
  );
}

function fillWithTraps(folder: string, islands: (readonly [number, number])[]) {
  const file = readFileSync(join(folder, "program"));
  const headers = Number(file.readBigUInt64LE(0x20));
  for (let index = 0; index < file.readUInt16LE(0x38); index++) {
    const header = headers + index * file.readUInt16LE(0x36);
    if (file.readUInt32LE(header) !== 1) continue;
    const offset = Number(file.readBigUInt64LE(header + 8));
    const address = Number(file.readBigUInt64LE(header + 16));
    const size = Number(file.readBigUInt64LE(header + 32));
    for (const [start, end] of islands) {
      if (start >= address && end <= address + size) file.fill(0xcc, offset + start - address, offset + end - address);
    }
  }
  writeFileSync(join(folder, "trimmed"), file);
  chmodSync(join(folder, "trimmed"), 0o755);
}

async function linked(
  folder: string,
  plan: string,
  objects = ["behind", "door", "table", "main"],
  compileFlags: Record<string, string[]> = {},
  linkFlags: string[] = [],
) {
  const said = await wrapped(folder, plan, objects, compileFlags, linkFlags);
  expect({ stderr: said.stderr, exitCode: said.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const names = await run([tools["llvm-nm"]!, "program"], folder);
  const addressOf = new Map(names.stdout.split("\n").map(line => [line.split(" ")[2]!, parseInt(line.split(" ")[0]!, 16)]));
  await run([tools["llvm-objcopy"]!, "-O", "binary", "--only-section=.bun_islands", "program", "table"], folder);
  const table = decodeTable(readFileSync(join(folder, "table")));
  const islands = table.islands.map(({ start, end }) => [start, end] as const);
  const isDoor = (name: string) => table.doors.some(door => door.address === addressOf.get(name));
  const canGo = (name: string) => islands.some(([start, end]) => start <= addressOf.get(name)! && addressOf.get(name)! < end);
  fillWithTraps(folder, islands);
  return { said: said.stdout, table, addressOf, canGo, isDoor, ran: await run([join(folder, "program")], folder), ranTrimmed: await run([join(folder, "trimmed")], folder) };
}

const start = `
  int the_door(int);
  __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
`;
const doorTo = (name: string) => `
  int behind(int);
  int ${name}(int);
  __attribute__((noinline)) int the_door(int x) { return behind(x) * 3 + ${name}(x + 1); }
`;

interface Road {
  more: string;
  main: string;
  stay: string[];
  compileFlags?: Record<string, string[]>;
  linkFlags?: string[];
  skip?: boolean;
}

const twin = (name: string) => `__attribute__((noinline)) int ${name}(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 77; }`;
const choose = (name: string) => `
  __attribute__((noinline)) int ${name}(int x) {
    switch (x) {
      case 0: return note(x + 5);
      case 1: return note(3) * note(4);
      case 2: return seen - 4;
      case 3: return note(seen) + note(x);
      case 4: seen = 9; return 2;
      case 5: return note(1) - note(seen + 2);
      case 6: return seen * seen;
      case 7: return note(note(note(x)));
      case 8: return 70 / (seen + 1);
      default: return -1;
    }
  }
`;

const roads: Record<string, Road> = {
  "a function folded into an equal one behind the door": {
    more: `${twin("behind_twin")} int more(int x) { return behind_twin(x); }`,
    main: `${twin("stays_twin")} int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays_twin(argc) == 109 ? 0 : 1; }`,
    stay: ["stays_twin", "behind_twin"],
  },
  "a jump table, and one folded into an equal one behind the door": {
    more: `extern volatile int seen; int note(int); ${choose("behind_choice")} int more(int x) { return behind_choice(x); }`,
    main: `
      volatile int seen;
      __attribute__((noinline)) int note(int value) { seen = value; return value; }
      ${choose("stays_choice")}
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays_choice(argc) == 12 && stays_choice(argc + 6) == 7 ? 0 : 1; }
    `,
    stay: ["stays_choice", "note"],
  },
  "a table of functions in data that something that stays reads": {
    more: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      int (*const behind_handlers[2])(int) = { first, second };
      int more(int x) { return behind_handlers[x & 1](x); }
    `,
    main: `
      extern int (*const behind_handlers[2])(int);
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : behind_handlers[argc](argc) == 21 ? 0 : 1; }
    `,
    stay: ["first", "second"],
  },
  "a function that runs before main": {
    more: `
      int early_value;
      static volatile int seed = 5;
      __attribute__((noinline)) int behind_early(int x) { return x * 5 + 1; }
      __attribute__((constructor)) static void early(void) { early_value = behind_early(seed); }
      int more(int x) { return behind_early(x); }
    `,
    main: `extern int early_value; int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : early_value == 26 ? 0 : 1; }`,
    stay: ["early", "behind_early"],
  },
  "a function that chooses an implementation when the program is loaded": {
    more: `
      static volatile int which;
      __attribute__((noinline)) static int chosen_one(int x) { return x + 40; }
      __attribute__((noinline)) static int chosen_two(int x) { return x + 41; }
      static int (*resolve_chosen(void))(int) { return which ? chosen_two : chosen_one; }
      int chosen(int) __attribute__((ifunc("resolve_chosen")));
      int more(int x) { return chosen(x); }
    `,
    main: `int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : 0; }`,
    stay: ["resolve_chosen", "chosen_one", "chosen_two"],
    skip: isMusl,
  },
  "a name that the link command defines": {
    more: `__attribute__((noinline)) int behind_target(int x) { return x * 3 + 4; } int more(int x) { return behind_target(x); }`,
    main: `int renamed(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : renamed(argc) == 7 ? 0 : 1; }`,
    stay: ["behind_target"],
    linkFlags: ["-Wl,--defsym=renamed=behind_target"],
  },
  "a section walked from its start to its stop": {
    more: `
      __attribute__((noinline)) static int member_one(int x) { return x + 1; }
      __attribute__((noinline)) static int member_two(int x) { return x + 2; }
      __attribute__((used, retain, section("the_set"))) static int (*const one)(int) = member_one;
      __attribute__((used, retain, section("the_set"))) static int (*const two)(int) = member_two;
      int more(int x) { return member_one(x) + member_two(x); }
    `,
    main: `
      extern int (*const __start_the_set[])(int);
      extern int (*const __stop_the_set[])(int);
      int main(int argc, char **argv) {
        int sum = 0;
        for (int (*const *member)(int) = __start_the_set; member < __stop_the_set; member++) sum += (*member)(argc);
        return argc > 5 ? the_door(argc) : sum == 5 ? 0 : 1;
      }
    `,
    stay: ["member_one", "member_two"],
  },
  "what a thread's variables start with": {
    more: `
      __attribute__((noinline)) int behind_hooked(int x) { return x + 7; }
      __thread int (*hook)(int) = behind_hooked;
      int more(int x) { return behind_hooked(x) + hook(x); }
    `,
    main: `extern __thread int (*hook)(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : hook(argc) == 8 ? 0 : 1; }`,
    stay: ["behind_hooked"],
  },
  "of two weak definitions the one the linker took": {
    more: `__attribute__((weak, noinline)) int weak_twin(int x) { return x + 100; } int more(int x) { return weak_twin(x); }`,
    main: `
      __attribute__((weak, noinline)) int weak_twin(int x) { return x + 100; }
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : weak_twin(argc) == 101 ? 0 : 1; }
    `,
    stay: ["weak_twin"],
  },
  "a strong definition behind the door that replaces a weak one": {
    more: `__attribute__((noinline)) int replaced(int x) { return x + 2; } int more(int x) { return replaced(x); }`,
    main: `
      __attribute__((weak, noinline)) int replaced(int x) { return x + 1; }
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : replaced(argc) == 3 ? 0 : 1; }
    `,
    stay: ["replaced"],
  },
  "of two copies of an inline function the one the linker took": {
    more: `
      inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }
      extern "C" int more(int x) { return shared_inline(x); }
    `,
    main: `
      inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }
      extern "C" int the_door(int);
      extern "C" __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : shared_inline(argc) == 56 ? 0 : 1; }
    `,
    stay: ["_Z13shared_inlinei"],
    compileFlags: { more: ["-x", "c++", "-fno-exceptions", "-fno-rtti"], main: ["-x", "c++", "-fno-exceptions", "-fno-rtti"] },
  },
  "a string that the linker merged with an equal one": {
    more: `__attribute__((noinline)) const char *behind_words(void) { return "the same words in both"; } int more(int x) { return behind_words()[x & 7]; }`,
    main: `
      __attribute__((noinline)) const char *stays_words(void) { return "the same words in both"; }
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays_words()[argc + 3] == 's' ? 0 : 1; }
    `,
    stay: ["stays_words"],
  },
  "an address taken through the table of global offsets": {
    more: `__attribute__((noinline)) int behind_target(int x) { return x * 3 + 4; } int more(int x) { return behind_target(x); }`,
    main: `
      int behind_target(int);
      int (*volatile pointer)(int);
      int main(int argc, char **argv) { pointer = behind_target; return argc > 5 ? the_door(argc) : pointer(argc) == 7 ? 0 : 1; }
    `,
    stay: ["behind_target"],
    compileFlags: { main: ["-fPIC"] },
  },
  "a type that only a catch clause names": {
    more: `
      struct Boom { int why; };
      extern "C" int more(int x) { if (x > 100) throw Boom{x}; return x; }
    `,
    main: `
      struct Boom { int why; };
      struct Other { int why; };
      extern "C" int the_door(int);
      extern "C" __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
      __attribute__((noinline)) static void fails(int x) { throw Other{x}; }
      int main(int argc, char **argv) {
        try { if (argc > 5) return the_door(argc); fails(argc); } catch (const Boom &) { return 2; } catch (const Other &other) { return other.why - 1; }
        return 3;
      }
    `,
    stay: ["_ZTI4Boom", "_ZTS4Boom"],
    compileFlags: { more: ["-x", "c++"], main: ["-x", "c++"] },
    linkFlags: ["-lstdc++"],
    skip: !hasCxxRuntime,
  },
};

describe.skipIf(!canLink)("what stays can reach what lies behind the door by", () => {
  for (const [name, road] of Object.entries(roads)) {
    test.skipIf(road.skip === true)(name, async () => {
      const isCxx = road.compileFlags?.main?.includes("c++") === true;
      using dir = tempDir("islands-road", {
        "behind.c": sources["behind.c"],
        "door.c": doorTo("more"),
        "more.c": road.more,
        "main.c": (isCxx ? "" : start) + road.main,
        "doors": sources.doors,
      });
      const { said, canGo, ran, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"], road.compileFlags, road.linkFlags);
      expect(Object.fromEntries(road.stay.map(name => [name, canGo(name)]))).toEqual(Object.fromEntries(road.stay.map(name => [name, false])));
      expect(["behind", "behind_0", "behind_1499"].map(canGo)).toEqual([true, true, true]);
      expect(said).toContain("; 0 references lead where the names did not");
      expect({ whole: ran.exitCode, trimmed: ranTrimmed.exitCode }).toEqual({ whole: 0, trimmed: 0 });
    });
  }

  test("a branch that the linker sends past a door that only jumps on", async () => {
    using dir = tempDir("islands-road", {
      ...sources,
      "door.c": doorTo("landing"),
      "more.c": `
        __attribute__((noinline)) int landing(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 5; }
        __asm__(".section .text.hop,\\"ax\\",@progbits\\n.globl hop\\n.type hop,@function\\nhop:\\n"
        #ifdef __x86_64__
          "jmp landing\\n"
        #else
          "b landing\\n"
        #endif
          ".skip 16\\n.size hop, .-hop\\n.text\\n");
      `,
      "main.c": `
        ${start}
        int hop(int);
        int main(int argc, char **argv) { return argc > 6 ? hop(argc) + 1 : argc > 5 ? the_door(argc) : 0; }
      `,
      "doors": sources.doors + "door extra exit ^hop$\n",
    });
    const { said, canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"], {}, ["-Wl,-O2"]);
    const wasSentOn = said.includes("; 1 branches to a branch were sent on to its target;");
    expect(said).toContain(wasSentOn ? "; 1 branches to a branch" : "; 0 branches to a branch");
    expect({ landing: canGo("landing"), behind_0: canGo("behind_0") }).toEqual({ landing: !wasSentOn, behind_0: true });
    expect(said).toContain("; 0 references lead where the names did not");
    expect(ranTrimmed.exitCode).toBe(0);
  });

  test("a function that only returns a type of the feature's is no door", async () => {
    const shared = `
      namespace gone { struct Thing { int value; }; }
      extern "C" int touched(int);
      template <typename By> __attribute__((noinline)) gone::Thing *moved(gone::Thing *thing, By by) { thing->value += touched(by); return thing; }
    `;
    using dir = tempDir("islands-road", {
      ...sources,
      "door.c": doorTo("more"),
      "more.c": `
        ${shared}
        extern "C" int behind(int);
        extern "C" __attribute__((noinline)) int touched(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x % 7; }
        namespace gone { __attribute__((noinline)) int entered(int x) { Thing thing{x}; return moved(&thing, 2)->value + behind(x); } }
        extern "C" int more(int x) { return gone::entered(x); }
      `,
      "main.c": `
        ${shared}
        namespace gone { int entered(int); }
        extern "C" int the_door(int);
        extern "C" __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
        int main(int argc, char **argv) {
          gone::Thing thing{argc};
          return argc > 6 ? gone::entered(argc) : argc > 5 ? the_door(argc) : moved(&thing, 2)->value == 4 ? 0 : 1;
        }
      `,
      "doors": sources.doors + "door extra exit ^gone::\n",
    });
    const flags = ["-x", "c++", "-fno-exceptions", "-fno-rtti"];
    const { isDoor, canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"], { more: flags, main: flags });
    expect({ entered: isDoor("_ZN4gone7enteredEi"), moved: isDoor("_Z5movedIiEPN4gone5ThingES2_T_") }).toEqual({ entered: true, moved: false });
    expect(["_Z5movedIiEPN4gone5ThingES2_T_", "touched"].map(canGo)).toEqual([false, false]);
    expect(ranTrimmed.exitCode).toBe(0);
  });

  test("references written in a way that is not read stop the link", async () => {
    using dir = tempDir("islands-road", { ...sources });
    const said = await wrapped(String(dir), "none", ["behind", "door", "table", "main"], { main: ["-Wa,--crel,--allow-experimental-crel"] }, []);
    expect(said.stderr).toContain("are written in a way that is not read here");
    expect(said.exitCode).toBe(1);
  });

  test("a function too small to be shut is no door, and what it names stays", async () => {
    using dir = tempDir("islands-road", {
      ...sources,
      "more.c": `
        __attribute__((noinline)) int behind_the_small_door(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 5; }
        __attribute__((noinline)) int small_door(int x) { return behind_the_small_door(x); }
      `,
      "main.c": `
        ${start}
        int small_door(int);
        int main(int argc, char **argv) { return argc > 6 ? small_door(argc) : argc > 5 ? the_door(argc) : 0; }
      `,
      "doors": sources.doors + "door extra exit ^small_door$\n",
    });
    const { said, canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"]);
    expect(said).toContain("1 functions that match a door are too small to be shut and are no doors");
    expect(["small_door", "behind_the_small_door", "behind_0"].map(canGo)).toEqual([false, false, true]);
    expect(ranTrimmed.exitCode).toBe(0);
  });

  test("a door whose first byte is another function's too stays open", async () => {
    using dir = tempDir("islands-road", {
      ...sources,
      "more.c": `
        __attribute__((noinline)) int behind_the_shared_door(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 5; }
        __attribute__((noinline)) int shared_door(int x) { for (int i = 0; i < 5; i++) x = x * 7 + i; return behind_the_shared_door(x) & 0xffff; }
        int another_name(int) __attribute__((alias("shared_door")));
      `,
      "main.c": `
        ${start}
        int shared_door(int);
        int another_name(int);
        int main(int argc, char **argv) { return argc > 6 ? shared_door(argc) : argc > 5 ? the_door(argc) : another_name(argc) < 0x10000 ? 0 : 1; }
      `,
      "doors": sources.doors + "door extra exit ^shared_door$\n",
    });
    const { said, isDoor, canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"]);
    expect(said).toContain("1 doors were folded into other functions and stay open");
    expect(isDoor("shared_door")).toBe(false);
    expect(["shared_door", "behind_the_shared_door", "behind_0"].map(canGo)).toEqual([false, false, true]);
    expect(ranTrimmed.exitCode).toBe(0);
  });
});

describe.skipIf(!canLink)("a thin door", () => {
  const thin = {
    ...sources,
    "door.c": `
      int behind(int);
      __attribute__((noinline)) int the_door(int x) { for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x; }
    `,
    "main.c": `
      void _exit(int);
      int the_door(int);
      __attribute__((noinline)) void Bun__trimmedOut(int feature) { _exit(70); }
      int (*const handlers[2])(int) = { 0, the_door };
      int (*volatile pointer)(int);
      __attribute__((noinline)) static int tail(int x) { return the_door(x + 1); }
      int main(int argc, char **argv) {
        if (argc == 2) return the_door(argc) & 63;
        if (argc == 3) return handlers[argc - 2](argc) & 63;
        if (argc == 4) { pointer = the_door; return pointer(argc) & 63; }
        if (argc == 5) return tail(argc) & 63;
        return 0;
      }
    `,
  };
  const roads = [[], ["call"], ["a", "table"], ["an", "address", "taken"], ["a", "jump", "at", "the end"]];

  async function exitCodes(folder: string, program: string) {
    const codes: number[] = [];
    for (const road of roads) codes.push((await run([join(folder, program), ...road], folder)).exitCode);
    return codes;
  }

  test("goes with its feature, and everybody who names it meets the stub", async () => {
    using dir = tempDir("islands-thin", thin);
    const folder = String(dir);
    const { said, table, canGo, addressOf } = await linked(folder, "none", ["behind", "door", "table", "main"]);
    expect(said).toContain("1 doors are thin");
    expect(canGo("the_door")).toBe(true);
    const door = table.doors.find(door => door.address === addressOf.get("the_door"))!;
    expect(door.places!.length).toBeGreaterThanOrEqual(3);
    const whole = await exitCodes(folder, "program");
    expect(whole[0]).toBe(0);
    expect(whole.slice(1)).not.toContain(70);
    writeFileSync(join(folder, "shut"), shutDoors(readFileSync(join(folder, "program")), table, ["extra"], process.arch === "arm64"));
    chmodSync(join(folder, "shut"), 0o755);
    expect(await exitCodes(folder, "shut")).toEqual([0, 70, 70, 70, 70]);
  });

  test("stays fat when the executable exports it", async () => {
    using dir = tempDir("islands-thin", thin);
    const { said, table, canGo, addressOf } = await linked(String(dir), "none", ["behind", "door", "table", "main"], {}, ["-Wl,--export-dynamic-symbol=the_door"]);
    expect(said).toContain("0 doors are thin");
    expect(canGo("the_door")).toBe(false);
    expect(table.doors.find(door => door.address === addressOf.get("the_door"))?.places ?? []).toEqual([]);
  });
});

describe.skipIf(!canLink)("two equal doors of two features", () => {
  const twins = {
    ...sources,
    "more.c": `
      int behind(int);
      __attribute__((noinline)) int door_of_one(int x) { __asm__ volatile(".rept 6000\\nnop\\n.endr"); for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x; }
      __attribute__((noinline)) int door_of_another(int x) { __asm__ volatile(".rept 6000\\nnop\\n.endr"); for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x; }
    `,
    "main.c": `
      void _exit(int);
      int the_door(int);
      int door_of_one(int);
      int door_of_another(int);
      __attribute__((noinline)) void Bun__trimmedOut(int feature) { _exit(70 + (feature & 255)); }
      int main(int argc, char **argv) {
        if (argc == 2) return door_of_one(argc) & 63;
        if (argc == 3) return door_of_another(argc) & 63;
        return argc > 5 ? the_door(argc) : 0;
      }
    `,
    "doors": sources.doors + "feature one the first\nfeature another the second\ndoor one exit ^door_of_one$\ndoor another exit ^door_of_another$\n",
  };

  test("are one body, which goes when both are out and is shut only then", async () => {
    using dir = tempDir("islands-twins", twins);
    const folder = String(dir);
    const { table, addressOf } = await linked(folder, "all", ["behind", "door", "table", "more", "main"]);
    expect(addressOf.get("door_of_one")).toBe(addressOf.get("door_of_another")!);
    const door = table.doors.find(door => door.address === addressOf.get("door_of_one"))!;
    expect(door.feature).toBe("one,another");
    expect(table.islands.filter(island => island.start <= door.address && door.address < island.end).map(island => island.features)).toEqual(["one,another"]);
    const codes = async (program: string) => [(await run([join(folder, program), "a"], folder)).exitCode, (await run([join(folder, program), "a", "b"], folder)).exitCode];
    const whole = await codes("program");
    for (const [name, excluded] of [["without-one", ["one"]], ["without-both", ["one", "another"]]] as const) {
      writeFileSync(join(folder, name), shutDoors(readFileSync(join(folder, "program")), table, excluded, process.arch === "arm64"));
      chmodSync(join(folder, name), 0o755);
    }
    expect(await codes("without-one")).toEqual(whole);
    const first = 70 + table.features.indexOf("one");
    expect(await codes("without-both")).toEqual([first, first]);
  });
});

describe.skipIf(!canLink)("code of one feature that names a door of another", () => {
  const pair = {
    ...sources,
    "door.c": doorTo("more"),
    "more.c": `int door_of_another(int); int more(int x) { return door_of_another(x) + 1; }`,
    "other.c": `__attribute__((noinline)) int door_of_another(int x) { for (int i = 0; i < 9; i++) x = x * 11 + i; return x; }`,
    "main.c": start + `int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : 0; }`,
  };
  const objects = ["behind", "door", "more", "other", "main"];
  const doors = sources.doors + "feature other something else\ndoor other exit ^door_of_another$\nwhen extra global Extra\nwhen other global Other\n";

  test.each([
    ["is listed", "", 0, "other <- extra: 1 references"],
    ["stops the link once pairs are argued and this one is not", "argued extra other the other way round\n", 1, "other <- extra: 1 references"],
    ["is argued", "argued other extra whoever gets there has asked for both\n", 0, ""],
    ["is argued by a pattern over the whole of each name", "argued oth.* ex(tra|cess) whoever gets there has asked for both\n", 0, ""],
    ["is not argued by a pattern that matches a part of a name", "argued oth extra whoever gets there has asked for both\n", 1, "other <- extra: 1 references"],
    ["is kept with it by a condition", "argued extra other the other way round\nwhen other feature extra\n", 0, ""],
  ])("%s", async (_, lines, exitCode, listed) => {
    using dir = tempDir("islands-pair", { ...pair, "doors": doors + lines });
    const said = await wrapped(String(dir), "none", objects, {}, []);
    expect(said.exitCode).toBe(exitCode);
    if (exitCode !== 0) expect(said.stderr).toContain('no line "argued" says why');
    expect(readFileSync(join(String(dir), "work", "pairs.txt"), "utf8").split("\n")[0]).toBe(listed);
  });

  test("a function that runs before main is no door, and what it names stays", async () => {
    using dir = tempDir("islands-pair", {
      ...pair,
      "more.c": `
        int behind_early(int x) { for (int i = 0; i < 9; i++) x = x * 13 + i; return x; }
        int early_value;
        __attribute__((constructor, noinline)) void early(void) { for (int i = 0; i < 9; i++) early_value += behind_early(i); }
        int more(int x) { return behind_early(x); }
      `,
      "main.c": start + `extern int early_value; int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : early_value == 0; }`,
      "doors": sources.doors + "door extra exit ^early$\n",
    });
    const { said, canGo, isDoor, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"]);
    expect(said).toContain("1 functions that match a door run before main or after it, or have a second entry, and are no doors");
    expect({ isDoor: isDoor("early"), early: canGo("early"), behind_early: canGo("behind_early"), more: canGo("more") }).toEqual({ isDoor: false, early: false, behind_early: false, more: true });
    expect(ranTrimmed.exitCode).toBe(0);
  });

  test("the name of a condition is all the words behind its kind", async () => {
    using dir = tempDir("islands-pair", { ...sources, "doors": sources.doors + "when extra export node:module SourceMap\n" });
    const { table } = await linked(String(dir), "none");
    expect(table.conditions).toEqual([{ feature: "extra", kind: "export", name: "node:module SourceMap" }]);
  });

  test("what every stub jumps to stays, though only code behind a door names it", async () => {
    using dir = tempDir("islands-pair", { ...pair, "more.c": `void Bun__trimmedOut(int); int more(int x) { if (x == 12345) Bun__trimmedOut(x); return x; }` });
    const { canGo } = await linked(String(dir), "none", ["behind", "door", "more", "main"]);
    expect({ more: canGo("more"), Bun__trimmedOut: canGo("Bun__trimmedOut") }).toEqual({ more: true, Bun__trimmedOut: false });
  });
});

describe.skipIf(!canLink)("what the executable exports", () => {
  const exporting = {
    ...sources,
    "more.c": `
      __attribute__((noinline)) int only_for_what_is_loaded(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 5; }
      __attribute__((noinline)) int for_what_is_loaded(int x) { for (int i = 0; i < 5; i++) x = x * 7 + i; return only_for_what_is_loaded(x); }
      __attribute__((noinline)) int door_of_another(int x) { for (int i = 0; i < 5; i++) x = x * 11 + i; return x; }
    `,
    "doors": sources.doors + "feature other something else\ndoor other exit ^door_of_another$\n",
  };
  const exports = ["-Wl,--export-dynamic-symbol=for_what_is_loaded", "-Wl,--export-dynamic-symbol=door_of_another"];
  const names = ["for_what_is_loaded", "only_for_what_is_loaded", "door_of_another", "behind_0"];

  test("stays, where nothing says who can call it", async () => {
    using dir = tempDir("islands-exports", exporting);
    const { canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "table", "more", "main"], {}, exports);
    expect(names.map(canGo)).toEqual([false, false, false, true]);
    expect(ranTrimmed.exitCode).toBe(0);
  });

  test("goes with the features that alone can load what calls it; a door of another feature stays", async () => {
    using dir = tempDir("islands-exports", { ...exporting, "doors": exporting.doors + "exported extra\n" });
    const { canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "table", "more", "main"], {}, exports);
    expect(names.map(canGo)).toEqual([true, true, false, true]);
    expect(ranTrimmed.exitCode).toBe(0);
  });
});

describe.skipIf(!canLink)("an operation that compiled code calls through the runtime table", () => {
  const operations = {
    ...sources,
    "door.c": `
      int behind(int);
      int stays(int);
      __attribute__((noinline)) int operationOnlyInTheTable(int x) { for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x; }
      __attribute__((noinline)) int operationCalledDirectlyToo(int x) { for (int i = 0; i < 5; i++) x += stays(x + i) * 3 + stays(x ^ i); return x; }
      __attribute__((noinline)) int operationOfAnotherFeature(int x) { for (int i = 0; i < 7; i++) x += stays(x + i) * 5 + stays(x ^ i); return x; }
    `,
    "main.c": `
      void _exit(int);
      extern const char table_that_stays[62];
      int operationOnlyInTheTable(int);
      int operationCalledDirectlyToo(int);
      int operationOfAnotherFeature(int);
      __attribute__((noinline)) void Bun__trimmedOut(int feature) { _exit(70); }
      __attribute__((noinline)) int stays(int x) { return table_that_stays[x & 31]; }
      int (*volatile entries[3])(int);
      void fill(void) __asm__("_ZN3JSC3AOT12RuntimeTableC2ERNS_2VME");
      __attribute__((noinline)) void fill(void) { entries[0] = operationOnlyInTheTable; entries[1] = operationCalledDirectlyToo; entries[2] = operationOfAnotherFeature; }
      int main(int argc, char **argv) {
        fill();
        if (argc == 2) return entries[0](argc) & 63;
        if (argc == 3) return entries[1](argc) & 63;
        if (argc == 4) return operationCalledDirectlyToo(argc) & 63;
        if (argc == 5) return entries[2](argc) & 63;
        return 0;
      }
    `,
    "doors": `feature extra what lies behind the door\noperations extra ^operation(OnlyInTheTable|CalledDirectlyToo)$\nfeature other a feature with facts of its own\nwhen other global Other\ndoor other exit ^operationOfAnotherFeature$\n`,
  };

  test("is a thin door with a condition of its own name, unless other code names it too; a plain door gets the condition as well", async () => {
    using dir = tempDir("islands-operations", operations);
    const folder = String(dir);
    const { said, table, canGo, isDoor } = await linked(folder, "none", ["behind", "door", "table", "main"]);
    expect(said).toContain("1 operations are named by more than the table that compiled code calls them through and are no doors");
    expect(said).toContain("2 doors are thin");
    expect(table.conditions).toEqual([
      { feature: "extra", kind: "operation", name: "operationOnlyInTheTable" },
      { feature: "other", kind: "global", name: "Other" },
      { feature: "other", kind: "operation", name: "operationOfAnotherFeature" },
    ]);
    expect({ isDoor: isDoor("operationOnlyInTheTable"), canGo: canGo("operationOnlyInTheTable") }).toEqual({ isDoor: true, canGo: true });
    expect({ isDoor: isDoor("operationCalledDirectlyToo"), canGo: canGo("operationCalledDirectlyToo") }).toEqual({ isDoor: false, canGo: false });
    writeFileSync(join(folder, "shut"), shutDoors(readFileSync(join(folder, "program")), table, ["extra"], process.arch === "arm64"));
    chmodSync(join(folder, "shut"), 0o755);
    const exitCodes: number[] = [];
    for (const road of [[], ["through the table"], ["the", "other"], ["the", "other", "directly"], ["that", "of", "another", "feature"]]) exitCodes.push((await run([join(folder, "shut"), ...road], folder)).exitCode);
    expect(exitCodes[0]).toBe(0);
    expect(exitCodes[1]).toBe(70);
    expect(exitCodes.slice(2)).not.toContain(70);
  });
});

describe.skipIf(!canLink)("a link with islands", () => {
  test("what only the door reaches can go, code and constants; what stays cannot", async () => {
    using dir = tempDir("islands-link", sources);
    const { canGo, ran } = await linked(String(dir), "none");
    expect(["behind", "behind_0", "behind_1499", "behind_numbers"].map(canGo)).toEqual([true, true, true, true]);
    expect(["main", "stays", "Bun__trimmedOut"].map(canGo)).toEqual([false, false, false]);
    expect(ran.exitCode).toBe(0);
  });

  test("a constant that stays and was folded into an equal one behind the door cannot go", async () => {
    using dir = tempDir("islands-link", sources);
    const { addressOf, canGo } = await linked(String(dir), "none");
    expect(addressOf.get("table_that_stays")).toBe(addressOf.get("behind_table")!);
    expect(canGo("table_that_stays")).toBe(false);
  });

  test.each([
    ["native code", []],
    ["bitcode", ["-flto=thin"]],
  ])("the strings and constants of an input that is linked unmerged go, each by itself, with what names them: %s", async (_, flags) => {
    const sixteen = (text: string) => `(sixteen){ ${[...text].map(character => `'${character}'`).join(", ")} }`;
    const withStrings = {
      ...sources,
      "both.c": `
        int puts(const char *);
        typedef char sixteen __attribute__((vector_size(16)));
        __attribute__((noinline)) int behind_says(int x) { return puts(x ? "a sentence of the library" : "a sentence that both say"); }
        __attribute__((noinline)) sixteen behind_compares(sixteen x) { return x == ${sixteen("sixteen that go!")}; }
        __attribute__((noinline)) int stays_says(int x) { return puts(x > 1 ? "a sentence that stays" : "a sentence that both say"); }
        __attribute__((noinline)) sixteen stays_compares(sixteen x) { return x == ${sixteen("sixteen stay on!")}; }
      `,
      "door.c": `
        typedef char sixteen __attribute__((vector_size(16)));
        int behind(int);
        int behind_says(int);
        sixteen behind_compares(sixteen);
        __attribute__((noinline)) int the_door(int x) { return behind(x) * 3 + behind_says(x + 1) + behind_compares((sixteen){ x })[0]; }
      `,
      "main.c": `
        typedef char sixteen __attribute__((vector_size(16)));
        extern const char table_that_stays[62];
        int the_door(int);
        int stays_says(int);
        sixteen stays_compares(sixteen);
        __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
        __attribute__((noinline)) int stays(int x) { return table_that_stays[x & 31] + stays_says(x) * 0 + stays_compares((sixteen){ x })[1]; }
        int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays(argc) == '1' ? 0 : 1; }
      `,
    };
    const objects = ["behind", "both", "door", "table", "main"];
    const texts = ["a sentence of the library", "sixteen that go!", "a sentence that both say", "a sentence that stays", "sixteen stay on!"];
    const timesIn = (folder: string) => {
      const trimmed = readFileSync(join(folder, "trimmed")).toString("latin1");
      return texts.map(text => trimmed.split(text).length - 1);
    };
    {
      using dir = tempDir("islands-link", withStrings);
      const { ranTrimmed } = await linked(String(dir), "none", objects, { both: flags });
      expect(timesIn(String(dir))).toEqual([1, 1, 1, 1, 1]);
      expect(ranTrimmed).toEqual({ stdout: "a sentence that both say\n", stderr: "", exitCode: 0 });
    }
    using dir = tempDir("islands-link", { ...withStrings, doors: sources.doors + "unmerged (^|[/.])both\\.o" + "\n" });
    const { ranTrimmed } = await linked(String(dir), "none", objects, { both: flags });
    expect(timesIn(String(dir))).toEqual([0, 0, 1, 1, 1]);
    expect(ranTrimmed).toEqual({ stdout: "a sentence that both say\n", stderr: "", exitCode: 0 });
  }, 60_000);

  test("what only a feature needs is overwritten wherever it has bytes, however small it is", async () => {
    using dir = tempDir("islands-link", {
      ...sources,
      "both.c": `
        int puts(const char *);
        char first_variable_that_stays[] = "the first variable stays";
        char variable_behind[] = "a variable of the library";
        char variable_that_stays[] = "a variable that stays";
        __attribute__((noinline)) int behind_says(int x) { variable_behind[0] += x; return puts(variable_behind); }
        __attribute__((noinline)) int stays_says(int x) { first_variable_that_stays[0] += x; variable_that_stays[0] += x; return puts(first_variable_that_stays) + puts(variable_that_stays); }
      `,
      "door.c": `
        int behind(int);
        int behind_says(int);
        __attribute__((noinline)) int the_door(int x) { return behind(x) * 3 + behind_says(x + 1); }
      `,
      "main.c": `
        extern const char table_that_stays[62];
        int the_door(int);
        int stays_says(int);
        __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
        __attribute__((noinline)) int stays(int x) { return table_that_stays[x & 31] + stays_says(0) * 0; }
        int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays(argc) == '1' ? 0 : 1; }
      `,
    });
    const { said, canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "both", "door", "table", "main"]);
    expect(said).toMatch(/; [1-9]\d* more stretch(es)?, \d+ bytes, can only be overwritten; /);
    expect(["variable_behind", "behind_says", "variable_that_stays", "stays_says"].map(canGo)).toEqual([true, true, false, false]);
    const trimmed = readFileSync(join(String(dir), "trimmed")).toString("latin1");
    const texts = ["a variable of the library", "the first variable stays", "a variable that stays"];
    expect(texts.map(text => trimmed.split(text).length - 1)).toEqual([0, 1, 1]);
    expect(ranTrimmed).toEqual({ stdout: "the first variable stays\na variable that stays\n", stderr: "", exitCode: 0 });
    const report = readFileSync(join(String(dir), "work", "needed-by.txt"), "utf8");
    expect(report).toMatch(/^[0-9a-f]+ 26 \S+ \.data \S*variable_behind$/m);
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

  test("the room is cut to the table; a plan whose table was smaller costs a link and nothing else", async () => {
    using dir = tempDir("islands-link", sources);
    const folder = String(dir);
    const own = await linked(folder, "none");
    expect(own.said).toMatch(/; the table takes \d+ of 1024 bytes: /);
    expect(own.said).not.toContain("linking again");
    const plan = readFileSync(join(folder, "program.plan"), "utf8");
    expect(plan).toMatch(/\ntable \d+\n/);
    writeFileSync(join(folder, "small.plan"), plan.replace(/\ntable \d+\n/, "\ntable 0\n"));
    const again = await linked(folder, "small.plan");
    expect(again.said).toMatch(/the table takes \d+ bytes and there is room for 0: linking again/);
    expect(again.said).toMatch(/; the table takes \d+ of 1024 bytes: /);
    expect(["behind", "behind_1499", "behind_numbers", "table_that_stays", "stays"].map(again.canGo)).toEqual([true, true, true, false, false]);
    expect(again.ran.exitCode).toBe(0);
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

describe.skipIf(!canLink)("ICU's data package in a link with islands", () => {
  const items: [string, number][] = [
    ["icudt99l/af.res", 48],
    ["icudt99l/coll/de.res", 40],
    ["icudt99l/coll/root.res", 64],
    ["icudt99l/ibm-37_P100-1995.cnv", 5000],
    ["icudt99l/zoneinfo64.res", 33],
  ];
  const files = (afterThePackage: string) => ({
    ...sources,
    "package.dat": packageOf(items),
    "data.c": `__asm__(".section .rodata\\n.balign 16\\n.globl icudt99_dat\\nicudt99_dat:\\n.incbin \\"package.dat\\"\\n${afterThePackage}.text\\n");`,
    "main.c": `
      ${start}
      extern const unsigned char icudt99_dat[];
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : icudt99_dat[argc + 1] == 0xda ? 0 : 1; }
    `,
    "doors": sources.doors + "feature collation the order of strings\ndata collation ^coll/\ndata extra ^coll/root\\.res$\ndata extra \\.cnv$\n",
  });
  const runs = [
    { first: 1, count: 1, features: "collation" },
    { first: 2, count: 1, features: "extra,collation" },
    { first: 3, count: 1, features: "extra" },
  ];
  const packagesOf = (folder: string) => decodeTable(readFileSync(join(folder, "table"))).packages ?? [];

  test("is found by its name and ends where the next name in its section begins; its items are listed by the features that claim them", async () => {
    using dir = tempDir("islands-data", files(".balign 16\\n.globl dictionary\\ndictionary:\\n.zero 64\\n"));
    const { said, addressOf, ran } = await linked(String(dir), "none", ["behind", "door", "data", "main"]);
    expect(packagesOf(String(dir))).toEqual([{ start: addressOf.get("icudt99_dat")!, end: addressOf.get("dictionary")!, runs }]);
    expect(addressOf.get("dictionary")! - addressOf.get("icudt99_dat")!).toBe(Math.ceil(packageOf(items).length / 16) * 16);
    expect(said).toContain("ICU's data: 5 items");
    expect(ran.exitCode).toBe(0);
  });

  test("ends where its section ends when no name follows", async () => {
    using dir = tempDir("islands-data", files(""));
    const { addressOf } = await linked(String(dir), "none", ["behind", "door", "data", "main"]);
    expect(packagesOf(String(dir))).toEqual([{ start: addressOf.get("icudt99_dat")!, end: addressOf.get("icudt99_dat")! + packageOf(items).length, runs }]);
  });

  test("what only Windows keeps is listed all the same where the executable is not for Windows", async () => {
    using dir = tempDir("islands-data", { ...files(""), "doors": files("").doors + "windows-keeps ^coll/\n" });
    await linked(String(dir), "none", ["behind", "door", "data", "main"]);
    expect(packagesOf(String(dir)).map(dataPackage => dataPackage.runs)).toEqual([runs]);
  });

  test("a program without it lists none", async () => {
    using dir = tempDir("islands-data", { ...sources, "doors": files("").doors });
    await linked(String(dir), "none");
    expect(packagesOf(String(dir))).toEqual([]);
  });
});
