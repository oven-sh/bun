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

// What every executable calls, whatever --trim removed. A scan that finds neither has not read the code of the file.
const alwaysCalled = ["mmap", "write"];

function placesLeftThatCall(trimmed: Uint8Array, names: readonly string[]) {
  const places = placesThatCall(trimmed, [...names, ...alwaysCalled]);
  expect(namesOf(places.filter(place => alwaysCalled.includes(place.name)))).toEqual(alwaysCalled);
  return places.filter(place => !alwaysCalled.includes(place.name));
}

const numbersOf = (places: { number: number }[]) =>
  [...new Set(places.map(place => place.number))].sort((a, b) => a - b);

if (isASAN)
  console.error(
    "SKIPPED: compile-trim-capabilities.test.ts: a Bun built with AddressSanitizer can't trim, and calls the sanitizer's own dlopen",
  );

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
      expect(placesLeftThatCall(cut.file, startsAProgram.functions)).toEqual([]);
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
          namesOf(placesLeftThatCall(file, startsAProgram.functions)).filter(name => !sendsACrashReport.includes(name)),
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
        placesLeftThatCall(cut.file, loadsNativeCode.functions).map(place => ({
          ...place,
          keptBy: featuresThatKeep(place.address, loadsNativeCode.features),
        })),
      ).toEqual([]);
      expect(await run([cut.executable], folder)).toEqual(saysHello);
    });
  },
);

// A Mach-O file that imports `execve`. __TEXT is its one executable segment: __text is at 0x100000400 (up to 16 bytes),
// __stubs at 0x100000410 and __const, with the flags given, at 0x100000480 (up to 128 bytes). The sections of __DATA are
// the three kinds that have no bytes in the file.
function machO(cpu: number, text: string, stub: string, constants: string, flagsOfConstants: number): Uint8Array {
  type Section = [name: string, address: number, size: number, offset: number, flags: number, indirect?: number];
  const file = new Uint8Array(0x530);
  const view = new DataView(file.buffer);
  let at = 32;
  const u32 = (...values: number[]) => values.forEach(value => (view.setUint32(at, value, true), (at += 4)));
  const u64 = (...values: number[]) => values.forEach(value => (view.setBigUint64(at, BigInt(value), true), (at += 8)));
  const name = (value: string) => (file.set(Buffer.from(value), at), (at += 16));
  const segment = (segmentName: string, [address, size, offset, bytes, protection]: number[], sections: Section[]) => {
    u32(0x19, 72 + 80 * sections.length);
    name(segmentName);
    u64(0x100000000 + address, size, offset, bytes);
    u32(protection, protection, sections.length, 0);
    for (const [sectionName, sectionAddress, sectionSize, sectionOffset, flags, indirect = 0] of sections) {
      name(sectionName);
      name(segmentName);
      u64(0x100000000 + sectionAddress, sectionSize);
      u32(sectionOffset, 0, 0, 0, flags, indirect, sectionName === "__stubs" ? sectionSize : 0, 0);
    }
  };
  segment(
    "__TEXT",
    [0, 0x4000, 0, 0x500, 5],
    [
      ["__text", 0x400, text.length / 2, 0x400, 0x80000400],
      ["__stubs", 0x410, stub.length / 2, 0x410, 0x80000408],
      ["__const", 0x480, constants.length / 2, 0x480, flagsOfConstants],
    ],
  );
  segment("__DATA_CONST", [0x4000, 0x4000, 0x500, 8, 3], [["__got", 0x4000, 8, 0x500, 6, 1]]);
  segment(
    "__DATA",
    [0x8000, 0xc000, 0, 0, 3],
    [
      ["__bss", 0x8000, 0x4000, 0, 1],
      ["__huge", 0xc000, 0x4000, 0, 12],
      ["__thread_bss", 0x10000, 0x4000, 0, 18],
    ],
  );
  segment("__LINKEDIT", [0x14000, 0x4000, 0x508, 0x28, 1], []);
  // LC_SYMTAB: one symbol at 0x508, its name at 0x520. LC_DYSYMTAB: it is undefined, and at 0x518 the stub and the slot
  // of __got name it.
  u32(2, 24, 0x508, 1, 0x520, 9);
  u32(11, 80, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x518, 2, 0, 0, 0, 0);
  const sizeOfCommands = at - 32;
  at = 0;
  u32(0xfeedfacf, cpu, cpu === 0x01000007 ? 3 : 0, 2, 6, sizeOfCommands, 0, 0);
  file.set(Buffer.from(text, "hex"), 0x400);
  file.set(Buffer.from(stub, "hex"), 0x410);
  file.set(Buffer.from(constants, "hex"), 0x480);
  at = 0x508;
  u32(1, 1, 0, 0);
  file.set(Buffer.from("\0_execve\0"), 0x520);
  return file;
}

describe("a Mach-O file", () => {
  test.each([
    {
      cpu: "arm64",
      cpuType: 0x0100000c,
      text: "04000094" + "c0035fd6", // bl 0x100000410; ret
      stub: "30000090" + "100240f9" + "00021fd6", // adrp x16, 0x100004000; ldr x16, [x16]; br x16
      constants: "e4ffff97" + "f1db0110", // as instructions: bl 0x100000410; adr x17, 0x100004000
      call: 0x100000400,
      callsInConstants: [0x100000480, 0x100000484],
    },
    {
      cpu: "x64",
      cpuType: 0x01000007,
      text: "e80b000000" + "c3" + "9090", // call 0x100000410; ret; nop; nop
      stub: "ff25ea3b0000", // jmp *0x100004000(%rip)
      constants: "e98bffffff" + "000000", // as an instruction: jmp 0x100000410
      call: 0x100000401,
      callsInConstants: [0x100000481],
    },
  ])(
    "for $cpu is read as instructions only where a section says that it holds them",
    ({ cpuType, text, stub, constants, call, callsInConstants }) => {
      const callsWith = (flagsOfConstants: number) =>
        placesThatCall(machO(cpuType, text, stub, constants, flagsOfConstants), ["execve"]).map(place => place.address);
      // S_ATTR_PURE_INSTRUCTIONS is 0x80000000, S_ATTR_SOME_INSTRUCTIONS 0x400.
      expect({ data: callsWith(0), pure: callsWith(0x80000000), some: callsWith(0x400) }).toEqual({
        data: [call],
        pure: [call, ...callsInConstants],
        some: [call, ...callsInConstants],
      });
    },
  );
});
