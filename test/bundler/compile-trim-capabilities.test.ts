import { describe, expect, test } from "bun:test";
import { bunEnv, isASAN, isLinux, isMacOS, isWindows, tempDir } from "harness";
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
          featureNamed("SystemCaCertificates"),
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
const numbersOf = (places: { number: number | "unknown" }[]) =>
  [...new Set(places.map(place => place.number))].sort((a, b) => Number(a) - Number(b));

// None of this code ever runs.
const makesSystemCalls = (() => {
  const [clone, fork, vfork, execve, execveat, clone3] =
    process.arch === "arm64" ? [220, 220, 220, 221, 281, 435] : [56, 57, 58, 59, 322, 435];
  const raw = (name: string, load: string) =>
    `void ${name}(void) { __asm__ volatile("${load}\\n\\t${process.arch === "arm64" ? "svc #0" : "syscall"}" ::: "memory"); }\n`;
  const loads = (number: number) => (process.arch === "arm64" ? `mov w8, #${number}` : `mov $${number}, %%eax`);
  return {
    "starts.c": `#define _GNU_SOURCE
#include <unistd.h>
${raw("raw_clone", loads(clone))}${raw("raw_fork", process.arch === "arm64" ? loads(fork) : `push $${fork}\\n\\tpop %%rax`)}${raw("raw_vfork", loads(vfork))}${raw("raw_execve", loads(execve))}
long through_libc(void) { return syscall(${execveat}, 0, 0); }
// The number is loaded before a branch.
long after_a_branch(long flags) {
  register long number __asm__("${process.arch === "arm64" ? "x8" : "rax"}") = ${clone3};
  __asm__ volatile("" : "+r"(number));
  if (flags) __asm__ volatile("nop" : "+r"(number));
  __asm__ volatile("${process.arch === "arm64" ? "svc #0" : "syscall"}" : "+r"(number) :: "memory");
  return number;
}
`,
    // The number is loaded after the address of syscall(): a compiler may order them so.
    "number-last.c": `__asm__(".text\\n.globl number_last\\nnumber_last:\\n\\tadrp x3, :got:syscall\\n\\tldr x3, [x3, :got_lo12:syscall]\\n\\tmov w0, #281\\n\\tbr x3");
`,
    "any.c": `long any(long number) {
  register long passed __asm__("rax") = number;
  __asm__ volatile("syscall" : "+r"(passed) :: "rcx", "r11", "memory");
  return passed;
}
`,
    // Three bytes of data that read on as `mov $0x050f0000, %ecx`, which covers the instruction that the jump goes to.
    "behind-data.c": `void behind_data(void) { __asm__ volatile("mov $56, %%eax\\n\\tjmp 1f\\n\\t.byte 0xb9, 0, 0\\n1:\\tsyscall" ::: "rax", "rcx", "r11", "memory"); }
`,
    // The bytes of `syscall` inside an immediate, after a register was given the number of clone; and getpid() after that.
    "harmless.c": `void bytes_in_an_immediate(void) { __asm__ volatile("mov $56, %%eax\\n\\tmov $0x050f, %%ecx" ::: "eax", "ecx"); }
void another_number(void) { __asm__ volatile("mov $56, %%eax\\n\\tmov $56, %%edi\\n\\tmov $39, %%eax\\n\\tsyscall" ::: "rax", "rdi", "rcx", "r11", "memory"); }
`,
  };
})();
const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

describe.skipIf(!isLinux || !systemCC)("the search for system calls", () => {
  async function search(source: keyof typeof makesSystemCalls) {
    using dir = tempDir("compile-trim-capabilities", makesSystemCalls);
    const compiled = await run(
      [systemCC!, "-O1", "-shared", "-fPIC", "-fno-plt", source, "-o", "library.so"],
      String(dir),
      bunEnv,
    );
    expect(compiled).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    return placesThatMakeSystemCalls(readFileSync(join(String(dir), "library.so")), startsAProgram.systemCalls);
  }

  test("finds each way to start a program", async () => {
    expect(numbersOf(await search("starts.c"))).toEqual(startsAProgram.systemCalls);
  });

  test.skipIf(process.arch !== "arm64")("finds a number that is loaded after the address of syscall()", async () => {
    expect(numbersOf(await search("number-last.c"))).toEqual([281]);
  });

  test.skipIf(process.arch !== "x64")("reports a system call whose number is not a constant", async () => {
    expect(await search("any.c")).toEqual([
      { number: "unknown", address: expect.any(Number), bytes: expect.stringMatching(/0f05$/) },
    ]);
  });

  test.skipIf(process.arch !== "x64")("reports a system call that data in front of it covers", async () => {
    expect(await search("behind-data.c")).toEqual([
      { number: "unknown", address: expect.any(Number), bytes: expect.stringMatching(/b900000f05$/) },
    ]);
  });

  test.skipIf(process.arch !== "x64")(
    "takes no bytes inside an instruction, and no stale number, for a system call",
    async () => {
      expect(await search("harmless.c")).toEqual([]);
    },
  );
});

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
      if (isLinux) expect(placesThatMakeSystemCalls(cut.file, startsAProgram.systemCalls)).toEqual([]);
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
        if (isLinux) expect(placesThatMakeSystemCalls(file, startsAProgram.systemCalls)).toEqual([]);
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
