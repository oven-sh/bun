import { describe, expect, test } from "bun:test";
import { isASAN, isLinux, isMacOS, isWindows } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "../aot/harness/compiler";
import { run } from "../aot/harness/run";
import { sharedBuilds } from "../aot/harness/shared-builds";
import { copyWithoutDebugInformation as executablePath } from "../aot/harness/without-debug-information";
import {
  canTrim,
  featureNamed,
  featureOf,
  featuresThatKeep,
  trimFeatureNamed,
  withoutFeatures,
} from "./compile-trim-features";
import { placesThatCall, placesThatMakeSystemCalls } from "./what-an-executable-can-call";

const featuresOf = (...names: string[]) => names.flatMap(name => trimFeatureNamed(name).features);

const startsAProgram = {
  functions: [
    "fork",
    "vfork",
    "execve",
    "execvp",
    "execv",
    "execvpe",
    "fexecve",
    "posix_spawn",
    "posix_spawnp",
    "pidfd_spawn",
    "pidfd_spawnp",
    "system",
    "popen",
    "clone",
    "daemon",
    "forkpty",
  ],
  systemCalls: process.arch === "arm64" ? [220, 221, 281, 435] : [56, 57, 58, 59, 322, 435],
  features: featuresOf("cli", "spawn", "native-code"),
};

const sendsACrashReport = ["fork", "execve"];

const loadsNativeCode = {
  functions: ["dlopen", "dlmopen"],
  features: [
    ...featuresOf("cli", "native-code", "sqlite", "secrets", "terminal", "webview", "image", "dns", "bundler"),
    featureNamed("NodeFs"),
    featureOf("process.versions"),
    // macOS reads the system's certificates through Security.framework, which it opens by name.
    ...(isMacOS
      ? [
          ...featuresOf("sql", "redis", "s3", "fetch", "sockets", "http3", "websocket"),
          featureNamed("Tls"),
          featureNamed("TlsSockets"),
        ]
      : []),
  ],
};

const shared = sharedBuilds("compile-trim-capabilities", {
  "tsconfig.json": `{ "compilerOptions": { "types": ["bun"] } }`,
  "hello.ts": `console.log("hello world");`,
});
const { folder } = shared;
const saysHello = { stdout: "hello world\n", stderr: "", exitCode: 0 };

async function build(without: string[]) {
  const trim = without.length > 0 ? ["--trim", ...withoutFeatures([...new Set(without)])] : [];
  const built = await shared.build("hello.ts", ...trim);
  return { executable: built.executable, file: readFileSync(built.file) };
}

const namesOf = (places: { name: string }[]) => [...new Set(places.map(place => place.name))].sort();
const numbersOf = (places: { number: number }[]) =>
  [...new Set(places.map(place => place.number))].sort((a, b) => a - b);

if (isASAN)
  console.error(
    "SKIPPED: compile-trim-capabilities.test.ts: a Bun built with AddressSanitizer can't trim, and calls the sanitizer's own dlopen",
  );

describe("in x64 code, the scan reports a call only where an instruction begins", () => {
  const header = 0x105e30000;
  const stub = 0x105e37000;
  const pointer = 0x107dce840;

  // A Mach-O file for x64 that imports `execvp`: the stub of `execvp` is at `stub`, and the pointer that the stub jumps
  // through at `pointer`. `code` is a segment of its own that begins at `at`, like each piece of __TEXT in a file that
  // --trim wrote. `functions` is what LC_FUNCTION_STARTS says of the file, and `dataInCode` what LC_DATA_IN_CODE says.
  function machO(at: number, code: string, functions: number[] = [], dataInCode: [number, number][] = []): Uint8Array {
    const file = new Uint8Array(0x700);
    const view = new DataView(file.buffer);
    let to = 32;
    const u32 = (...values: number[]) => values.forEach(value => (view.setUint32(to, value, true), (to += 4)));
    const u64 = (...values: number[]) =>
      values.forEach(value => (view.setBigUint64(to, BigInt(value), true), (to += 8)));
    const name = (value: string) => (file.set(Buffer.from(value), to), (to += 16));
    // LC_SEGMENT_64, with no section or with one that is all of it.
    const segment = (
      segmentName: string,
      [address, offset, size, protection]: number[],
      section?: [string, ...number[]],
    ) => {
      u32(0x19, section ? 152 : 72);
      name(segmentName);
      u64(address, size, offset, size);
      u32(protection, protection, section ? 1 : 0, 0);
      if (!section) return;
      const [sectionName, flags, indirect, each] = section;
      name(sectionName);
      name(segmentName);
      u64(address, size);
      u32(offset, 0, 0, 0, flags, indirect, each, 0);
    };
    segment("__TEXT", [header, 0, 0x400, 5]);
    segment("__TEXT.1", [at, 0x400, code.length / 2, 5], ["__text", 0x80000400, 0, 0]);
    segment("__TEXT.2", [stub, 0x600, 6, 5], ["__stubs", 0x80000408, 0, 6]);
    segment("__DATA_CONST", [pointer, 0x608, 8, 3], ["__got", 6, 1, 0]);
    segment("__LINKEDIT", [0x108000000, 0x610, 0xf0, 1]);
    // LC_SYMTAB: one symbol at 0x610, its name at 0x620. LC_DYSYMTAB: it is undefined, and at 0x630 the stub and the
    // pointer name it. LC_FUNCTION_STARTS: at 0x638. LC_DATA_IN_CODE: at 0x650.
    u32(2, 24, 0x610, 1, 0x620, 16);
    u32(11, 80, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x630, 2, 0, 0, 0, 0);
    u32(0x26, 16, 0x638, 24);
    u32(0x29, 16, 0x650, 8 * dataInCode.length);
    const sizeOfCommands = to - 32;
    // In the file, `nop`s are in front of the code. They are in the segment of the header, so in memory they are not,
    // and the scan must not read the code from them.
    file.fill(0x90, to, 0x400);
    to = 0;
    u32(0xfeedfacf, 0x01000007, 3, 2, 9, sizeOfCommands, 0, 0);
    file.set(Buffer.from(code, "hex"), 0x400);
    file.set(Buffer.from("ff25" + le32(pointer - (stub + 6)), "hex"), 0x600); // jmp *pointer(%rip)
    to = 0x610;
    u32(1, 1, 0, 0);
    file.set(Buffer.from("\0_execvp\0"), 0x620);
    // Each function as its distance from the one before it, the first one from the header, in ULEB128.
    to = 0x638;
    functions.forEach((address, index) => {
      let distance = address - (functions[index - 1] ?? header);
      for (; distance >= 128; distance = Math.floor(distance / 128)) file[to++] = (distance % 128) | 0x80;
      file[to++] = distance;
    });
    // Each range of data by where it begins and how long it is. 4 is DICE_KIND_JUMP_TABLE32.
    to = 0x650;
    for (const [from, end] of dataInCode) u32(from - header, (4 << 16) | (end - from));
    return file;
  }

  function le32(value: number): string {
    const bytes = Buffer.alloc(4);
    bytes.writeInt32LE(value);
    return bytes.toString("hex");
  }

  // The bytes of `parts` at `at`. A part with an address is an opcode and the distance to that address, as `call` and
  // `jmp` have it. The scan reports the place of that distance, unless the part says that it is no instruction.
  type Part = string | [opcode: string, to: number, isInstruction?: boolean];
  function assemble(at: number, parts: Part[]): { code: string; places: number[] } {
    let code = "";
    const places: number[] = [];
    for (const part of parts) {
      if (typeof part === "string") {
        code += part;
        continue;
      }
      const [opcode, to, isInstruction = true] = part;
      const place = at + (code.length + opcode.length) / 2;
      if (isInstruction) places.push(place);
      code += opcode + le32(to - (place + 4));
    }
    return { code, places };
  }

  const addressesOf = (file: Uint8Array) => placesThatCall(file, ["execvp"]).map(place => place.address);

  // The first 79 bytes of WTF::Vector<Bun::NodeData>::expandCapacity() and a `ret`. Build 137163 of CI had the function
  // at 0x105e364c0 in the executable for macOS x64, and the pointer to `execvp` at 0x107dce840. Read from the second
  // byte of `shr ecx, 1` on, the bytes are a `jmp` to that pointer. CI printed the 40 bytes around the place. The 36
  // bytes in front of them are from the canary of main, which has the same function 0x100 bytes further on.
  const expandCapacity =
    "55" + // push rbp
    "4889e5" + // mov rbp, rsp
    "4156" + // push r14
    "53" + // push rbx
    "4889d3" + // mov rbx, rdx
    "488b07" + // mov rax, [rdi]
    "4989d6" + // mov r14, rdx
    "4929c6" + // sub r14, rax
    "724a" + // jb
    "8b4f0c" + // mov ecx, [rdi + 12]
    "488d0c49" + // lea rcx, [rcx + rcx * 2]
    "48c1e104" + // shl rcx, 4
    "4801c8" + // add rax, rcx
    "4839c3" + // cmp rbx, rax
    "7337" + // jae
    "8b4708" + // mov eax, [rdi + 8]
    "25ffffff7f" + // and eax, 0x7fffffff
    "89c1" + // mov ecx, eax
    "d1e9" + // shr ecx, 1
    "4883f901" + // cmp rcx, 1
    "4811c8" + // adc rax, rcx
    "4839f0" + // cmp rax, rsi
    "480f46c6" + // cmovbe rax, rsi
    "4883f811" + // cmp rax, 17
    "be10000000" + // mov esi, 16
    "480f43f0" + // cmovae rsi, rax
    "c3"; // ret

  test("not inside `shr ecx, 1`, which CI read as a jump to execvp", () => {
    const at = 0x105e364c0;
    const filled = Buffer.alloc(80, 0xcc).toString("hex");
    // vaddph xmm0, xmm0, xmm1, which the scan cannot read, and 32 times `nop`.
    const unknown = "62f57c0858c1" + Buffer.alloc(32, 0x90).toString("hex");
    // This is what CI printed.
    const place = {
      name: "execvp",
      address: 4393755892,
      code: "39c373378b470825ffffff7f89c1d1e94883f9014811c84839f0480f46c64883f811be1000000048",
    };
    expect({
      "the file says where the function begins": placesThatCall(machO(at, expandCapacity, [at]), ["execvp"]),
      "80 bytes that --trim filled are in front": placesThatCall(machO(at - 80, filled + expandCapacity), ["execvp"]),
      // With nothing to read the function from, the place is reported.
      "neither": placesThatCall(machO(at, expandCapacity), ["execvp"]),
      // Where the file says where the function begins, only reading it from there can show that a place is none.
      "the function begins with an instruction that the scan cannot read": placesThatCall(
        machO(at - 38, unknown + expandCapacity, [at - 38]),
        ["execvp"],
      ),
      // `add al, al` begins with a zero byte. Read from the start of a function, that is an instruction and no padding.
      "the function begins with `add al, al`": placesThatCall(machO(at - 2, "00c0" + expandCapacity, [at - 2]), [
        "execvp",
      ]),
    }).toEqual({
      "the file says where the function begins": [],
      "80 bytes that --trim filled are in front": [],
      "neither": [place],
      "the function begins with an instruction that the scan cannot read": [place],
      "the function begins with `add al, al`": [],
    });
  });

  test("not in a jump table, and at the start of the function behind one", () => {
    // A function, its jump table of two entries, a function that is one `jmp` to the stub, and a `ret`. The bytes of
    // the table are a `jmp` to the stub too, then `xor eax, eax`, then a `mov eax` that takes the first four bytes
    // of the function behind the table as its operand. So only the file says that a function begins there.
    const at = 0x105e36400;
    const { code, places } = assemble(at, [
      expandCapacity,
      ["e9", stub, false],
      "31c0b8",
      ["e9", stub],
      "909090",
      "c3",
    ]);
    expect(addressesOf(machO(at, code, [at, at + 88, at + 96], [[at + 80, at + 88]]))).toEqual(places);
  });

  test("each kind of instruction that names an import, and not its bytes inside `mov rax, imm64`", () => {
    // `mov rax, imm64` whose operand begins with `opcode` and the distance to `to`.
    const inAMov = (opcode: string, to: number): Part[] => [
      "48b8",
      [opcode, to, false],
      Buffer.alloc(4 - opcode.length / 2).toString("hex"),
    ];
    const at = 0x105e36400;
    const { code, places } = assemble(at, [
      expandCapacity.slice(0, -2),
      ["e8", stub], // call
      ...inAMov("e8", stub),
      ["e9", stub], // jmp
      ...inAMov("e9", stub),
      ["0f84", stub], // je
      ...inAMov("0f84", stub),
      ["ff15", pointer], // call [rip + pointer]
      ...inAMov("ff15", pointer),
      ["488b05", pointer], // mov rax, [rip + pointer]
      ...inAMov("8b05", pointer),
      ["67e8", stub], // addr32 call, which a linker writes in place of `call [rip + pointer]`
      // vaddph xmm0, xmm0, xmm1. The scan does not know how long it is, so it cannot tell what the bytes behind it
      // are, and reports the call.
      "62f57c0858c1",
      ["e8", stub],
      "c3", // ret
    ]);
    expect(addressesOf(machO(at, code))).toEqual(places);
  });

  // The processor takes any number of REX and legacy prefixes in any order, and uses a REX prefix only directly in
  // front of the opcode. Read with one REX prefix behind the legacy ones, the bytes of each `mov` are other
  // instructions, and the last of them takes the `e8` of the call as its operand.
  test.each<[string, Part[]]>([
    ["a call behind `mov rax, imm64` with two REX prefixes", ["4848b8" + "00000000b8000000", ["e8", stub]]],
    ["a call behind `mov ax, imm16` with a REX prefix in front of its `66` prefix", ["4866b8" + "0000", ["e8", stub]]],
    ["a call with two REX prefixes", [["4848e8", stub]]],
  ])("%s", (_, parts) => {
    const at = 0x105e36400;
    const { code, places } = assemble(at, [expandCapacity.slice(0, -2), ...parts, "c3"]);
    expect(addressesOf(machO(at, code))).toEqual(places);
  });

  // Read as an instruction, a zero byte is the opcode of `add r/m8, r8`, and it takes the `e8` of the call behind it
  // as its operand. A compiler seldom writes that instruction, and padding and data are mostly zero bytes. So the scan
  // cannot tell what the bytes behind a zero byte are, and reports the call.
  test.each([
    ["one zero byte", "00"],
    ["three zero bytes", "000000"],
  ])("a call behind %s", (_, zeros) => {
    const at = 0x105e36400;
    const { code, places } = assemble(at, [expandCapacity, zeros, ["e8", stub], "c3"]);
    expect(addressesOf(machO(at, code))).toEqual(places);
  });
});

(isWindows || isASAN || !canTrim ? describe.skip : describe.concurrent)(
  "an executable without what starts programs",
  () => {
    test("holds no place that calls a function, or makes a system call, that starts one", async () => {
      const whole = await build([]);
      expect(namesOf(placesThatCall(whole.file, startsAProgram.functions))).toEqual(
        expect.arrayContaining(["execve", "fork"]),
      );
      if (isLinux) expect(numbersOf(placesThatMakeSystemCalls(whole.file, startsAProgram.systemCalls))).toContain(435);

      const cut = await build(startsAProgram.features);
      expect(placesThatCall(cut.file, startsAProgram.functions)).toEqual([]);
      expect(placesThatMakeSystemCalls(cut.file, startsAProgram.systemCalls)).toEqual([]);
      expect(await run([cut.executable], folder)).toEqual(saysHello);
    });

    test.skipIf(!!unsupported)(
      "a program that starts none, built with compile: { aot: true, trim: true }, keeps only what sends a crash report",
      async () => {
        await Bun.build({
          entrypoints: [join(folder, "hello.ts")],
          compile: { outfile: join(folder, "named"), aot: true, trim: true, ...(executablePath && { executablePath }) },
        });
        const file = readFileSync(join(folder, "named"));
        expect(
          namesOf(placesThatCall(file, startsAProgram.functions)).filter(name => !sendsACrashReport.includes(name)),
        ).toEqual([]);
        expect(placesThatMakeSystemCalls(file, startsAProgram.systemCalls)).toEqual([]);
        expect(await run([join(folder, "named")], folder)).toEqual(saysHello);
      },
    );
  },
);

(isWindows || isASAN || !canTrim ? describe.skip : describe.concurrent)(
  "an executable without what loads native code",
  () => {
    test("holds no place that calls dlopen", async () => {
      const whole = await build([]);
      expect(namesOf(placesThatCall(whole.file, loadsNativeCode.functions))).toEqual(["dlopen"]);

      const cut = await build(loadsNativeCode.features);
      expect(
        placesThatCall(cut.file, loadsNativeCode.functions).map(place => ({
          ...place,
          keptBy: featuresThatKeep(place.address, loadsNativeCode.features),
        })),
      ).toEqual([]);
      expect(await run([cut.executable], folder)).toEqual(saysHello);
    });
  },
);
