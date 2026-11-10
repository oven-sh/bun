import { describe, expect, test } from "bun:test";
import { isASAN, isLinux, isMacOS, isMusl, isWindows } from "harness";
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
import { addressesOf, placesThatCall, placesThatMakeSystemCalls } from "./what-an-executable-can-call";

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
    test.skipIf(!isLinux || isMusl)(
      "a word of the data is a place only where the address of the import is taken",
      async () => {
        const { file } = await build([]);
        const free = (file.indexOf(Buffer.alloc(24), 1 << 20) + 15) & ~7;
        const newPlaces = (name: string) => {
          const before = placesThatCall(file, [name]).length;
          return addressesOf(file, name).map(address => {
            const changed = Buffer.from(file);
            changed.writeBigUInt64LE(BigInt(address), free);
            return placesThatCall(changed, [name]).length - before;
          });
        };
        // Bun takes the address of dlopen. It only calls execve.
        expect(newPlaces("dlopen")).toEqual([1, 1]);
        expect(newPlaces("execve")).toEqual([0, 0]);
      },
    );

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

// A Mach-O file for arm64 of 1.5 KB: a stub for posix_spawn, a section of code that calls it, and a section of constants
// with the same four bytes. All three lie in __TEXT, the segment that is mapped for execution.
function machOWithOneStub() {
  const file = Buffer.alloc(0x600);
  const base = 0x1_0000_0000;
  const [text, stubs, constants, symbols, strings, indirect] = [0x200, 0x300, 0x400, 0x500, 0x520, 0x540];
  const segment = 32;
  const section = (index: number, offset: number, size: number, flags: number, stubSize = 0) => {
    const at = segment + 72 + index * 80;
    file.writeBigUInt64LE(BigInt(base + offset), at + 32);
    file.writeBigUInt64LE(BigInt(size), at + 40);
    file.writeUInt32LE(offset, at + 48);
    file.writeUInt32LE(flags, at + 64);
    file.writeUInt32LE(stubSize, at + 72);
  };
  file.writeUInt32LE(0xfeedfacf, 0);
  file.writeUInt32LE(0x0100000c, 4);
  file.writeUInt32LE(3, 16);
  // LC_SEGMENT_64: __TEXT, read and execute.
  file.writeUInt32LE(0x19, segment);
  file.writeUInt32LE(72 + 3 * 80, segment + 4);
  file.writeBigUInt64LE(BigInt(base), segment + 24);
  file.writeBigUInt64LE(BigInt(file.length), segment + 48);
  file.writeUInt32LE(5, segment + 60);
  file.writeUInt32LE(3, segment + 64);
  section(0, text, 16, 0x80000400); // __text: S_ATTR_PURE_INSTRUCTIONS | S_ATTR_SOME_INSTRUCTIONS
  section(1, stubs, 12, 0x80000408, 12); // __stubs: the same, and S_SYMBOL_STUBS
  section(2, constants, 16, 0); // __const
  // LC_SYMTAB, LC_DYSYMTAB: the one stub is for symbol 0, whose name is at 1 in the strings.
  const symtab = segment + 72 + 3 * 80;
  file.writeUInt32LE(2, symtab);
  file.writeUInt32LE(24, symtab + 4);
  file.writeUInt32LE(symbols, symtab + 8);
  file.writeUInt32LE(strings, symtab + 16);
  file.writeUInt32LE(11, symtab + 24);
  file.writeUInt32LE(80, symtab + 28);
  file.writeUInt32LE(indirect, symtab + 24 + 56);
  file.writeUInt32LE(1, symbols);
  file.write("_posix_spawn", strings + 1, "latin1");
  const callOfStub = (from: number) => (0x94000000 | (((stubs - from) / 4) & 0x03ffffff)) >>> 0; // bl
  file.writeUInt32LE(callOfStub(text + 4), text + 4);
  file.writeUInt32LE(callOfStub(constants + 4), constants + 4);
  return { file, call: base + text + 4 };
}

test("in a Mach-O file a word of the constants that reads as a call of a stub is no place", () => {
  const { file, call } = machOWithOneStub();
  expect(placesThatCall(file, ["posix_spawn"]).map(place => place.address)).toEqual([call]);
});
