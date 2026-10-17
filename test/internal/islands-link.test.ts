import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeTable } from "../../scripts/build/islands-layout.ts";
import { packageOf } from "./icu-data-package.ts";
import { shutDoors } from "./islands-shut-doors.ts";

const wrapper = join(import.meta.dir, "../../scripts/build/islands.ts");
const tools = Object.fromEntries(
  ["clang", "ld.lld", "llvm-cxxfilt", "llvm-nm", "llvm-objcopy"].map(name => [name, Bun.which(name)]),
);
const canLink = isLinux && Object.values(tools).every(path => path !== null);
const hasCxxRuntime =
  canLink &&
  Bun.spawnSync({
    cmd: [tools.clang!, "-x", "c++", "-fuse-ld=lld", "-lstdc++", "-o", "/dev/null", "-"],
    stdin: Buffer.from("int main() { try { throw 1; } catch (int) {} }"),
    env: bunEnv,
  }).exitCode === 0;

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const manyFunctions = (prefix: string) =>
  Array.from(
    { length: 1500 },
    (_, index) =>
      `__attribute__((noinline)) int ${prefix}${index}(int x) { for (int i = 0; i < ${index + 3}; i++) x = x * ${index + 7} + i; return x ^ ${index}; }`,
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

async function wrapped(
  folder: string,
  plan: string,
  objects: string[],
  compileFlags: Record<string, string[]>,
  linkFlags: string[],
) {
  for (const name of objects) {
    const flags = ["-O1", "-ffunction-sections", "-fdata-sections", "-fno-pic", ...(compileFlags[name] ?? [])];
    const compiled = await run([tools.clang!, ...flags, "-c", `${name}.c`, "-o", `${name}.o`], folder);
    expect(compiled).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  }
  writeFileSync(join(folder, "in.rsp"), objects.map(name => `${name}.o\n`).join(""));
  const flags = ["-fuse-ld=lld", "-no-pie", "-Wl,--gc-sections", "-Wl,--icf=all", "-Wl,-Map=program.map", ...linkFlags];
  return await run(
    [
      bunExe(),
      wrapper,
      "doors",
      tools["llvm-cxxfilt"]!,
      "work",
      plan,
      "program.plan",
      "--",
      tools.clang!,
      "@in.rsp",
      ...flags,
      "-o",
      "program",
    ],
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
  const addressOf = new Map(
    names.stdout.split("\n").map(line => [line.split(" ")[2]!, parseInt(line.split(" ")[0]!, 16)]),
  );
  await run([tools["llvm-objcopy"]!, "-O", "binary", "--only-section=.bun_islands", "program", "table"], folder);
  const table = decodeTable(readFileSync(join(folder, "table")));
  const islands = table.islands.map(({ start, end }) => [start, end] as const);
  const isDoor = (name: string) => table.doors.some(door => door.address === addressOf.get(name));
  const canGo = (name: string) =>
    islands.some(([start, end]) => start <= addressOf.get(name)! && addressOf.get(name)! < end);
  fillWithTraps(folder, islands);
  return {
    said: said.stdout,
    table,
    addressOf,
    canGo,
    isDoor,
    ran: await run([join(folder, "program")], folder),
    ranTrimmed: await run([join(folder, "trimmed")], folder),
  };
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

const twin = (name: string) =>
  `__attribute__((noinline)) int ${name}(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 77; }`;
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
    compileFlags: {
      more: ["-x", "c++", "-fno-exceptions", "-fno-rtti"],
      main: ["-x", "c++", "-fno-exceptions", "-fno-rtti"],
    },
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
      const { said, canGo, ran, ranTrimmed } = await linked(
        String(dir),
        "none",
        ["behind", "door", "more", "main"],
        road.compileFlags,
        road.linkFlags,
      );
      expect(Object.fromEntries(road.stay.map(name => [name, canGo(name)]))).toEqual(
        Object.fromEntries(road.stay.map(name => [name, false])),
      );
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
    const { said, canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"], {}, [
      "-Wl,-O2",
    ]);
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
    const { isDoor, canGo, ranTrimmed } = await linked(String(dir), "none", ["behind", "door", "more", "main"], {
      more: flags,
      main: flags,
    });
    expect({ entered: isDoor("_ZN4gone7enteredEi"), moved: isDoor("_Z5movedIiEPN4gone5ThingES2_T_") }).toEqual({
      entered: true,
      moved: false,
    });
    expect(["_Z5movedIiEPN4gone5ThingES2_T_", "touched"].map(canGo)).toEqual([false, false]);
    expect(ranTrimmed.exitCode).toBe(0);
  });

  test("references written in a way that is not read stop the link", async () => {
    using dir = tempDir("islands-road", { ...sources });
    const said = await wrapped(
      String(dir),
      "none",
      ["behind", "door", "table", "main"],
      { main: ["-Wa,--crel,--allow-experimental-crel"] },
      [],
    );
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
    writeFileSync(
      join(folder, "shut"),
      shutDoors(readFileSync(join(folder, "program")), table, ["extra"], process.arch === "arm64"),
    );
    chmodSync(join(folder, "shut"), 0o755);
    expect(await exitCodes(folder, "shut")).toEqual([0, 70, 70, 70, 70]);
  });

  test("stays fat when the executable exports it", async () => {
    using dir = tempDir("islands-thin", thin);
    const { said, table, canGo, addressOf } = await linked(
      String(dir),
      "none",
      ["behind", "door", "table", "main"],
      {},
      ["-Wl,--export-dynamic-symbol=the_door"],
    );
    expect(said).toContain("0 doors are thin");
    expect(canGo("the_door")).toBe(false);
    expect(table.doors.find(door => door.address === addressOf.get("the_door"))?.places ?? []).toEqual([]);
  });
});

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
    expect(["behind", "behind_1499", "behind_numbers", "table_that_stays", "stays"].map(once.canGo)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
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
    expect(["behind", "behind_1499", "behind_numbers", "table_that_stays", "stays"].map(again.canGo)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
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
    "doors":
      sources.doors +
      "feature collation the order of strings\ndata collation ^coll/\ndata extra ^coll/root\\.res$\ndata extra \\.cnv$\n",
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
    expect(packagesOf(String(dir))).toEqual([
      { start: addressOf.get("icudt99_dat")!, end: addressOf.get("dictionary")!, runs },
    ]);
    expect(addressOf.get("dictionary")! - addressOf.get("icudt99_dat")!).toBe(
      Math.ceil(packageOf(items).length / 16) * 16,
    );
    expect(said).toContain("ICU's data: 5 items");
    expect(ran.exitCode).toBe(0);
  });

  test("ends where its section ends when no name follows", async () => {
    using dir = tempDir("islands-data", files(""));
    const { addressOf } = await linked(String(dir), "none", ["behind", "door", "data", "main"]);
    expect(packagesOf(String(dir))).toEqual([
      { start: addressOf.get("icudt99_dat")!, end: addressOf.get("icudt99_dat")! + packageOf(items).length, runs },
    ]);
  });

  test("a program without it lists none", async () => {
    using dir = tempDir("islands-data", { ...sources, "doors": files("").doors });
    await linked(String(dir), "none");
    expect(packagesOf(String(dir))).toEqual([]);
  });
});
