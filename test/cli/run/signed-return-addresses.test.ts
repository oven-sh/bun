// A library writes over the return address that a compiled function has saved. A build that does not sign goes where it says,
// which shows that the library has found the word.
// It is not in test/aot, whose files CI runs on one distribution alone and without showing what they print.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { locksEnvironment } from "../../aot/hardened";
import { cCompiler, without } from "../../aot/harness/capabilities";
import { withoutCoreDump } from "../../aot/harness/commands";
import { run } from "../../aot/harness/run";
import { withoutDebugInformation } from "../../aot/harness/without-debug-information";
import { describe, test } from "../../aot/supported";

const signs =
  isLinux &&
  Bun.spawnSync([
    "grep",
    "-q",
    "-a",
    "return addresses: what a compiled program saves of them is signed",
    process.execPath,
  ]).exitCode === 0;
const processorAuthenticates = isLinux && /^Features\b.*\bpaca\b/m.test(readFileSync("/proc/cpuinfo", "utf8"));

const library = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

enum { wanted = 32 };
enum Change { Nothing, Address, WordOfAnotherFrame, SignedAddress };
static const uintptr_t bitsOfAddress = ((uintptr_t)1 << 48) - 1;

#if defined(__x86_64__)
__attribute__((force_align_arg_pointer))
#endif
static void landed(void)
{
    _exit(write(1, "landed\\n", 7) != 7);
}

static uintptr_t signedFor(uintptr_t *word, uintptr_t address)
{
#if defined(__aarch64__)
    register uintptr_t x16 __asm__("x16") = (uintptr_t)(word + 1);
    register uintptr_t x17 __asm__("x17") = address;
    __asm__("hint #10" : "+r"(x17) : "r"(x16)); // PACIB1716
    return x17;
#else
    return address;
#endif
}

static uintptr_t endOfMapping(uintptr_t address, int *isExecutable)
{
    char line[4096], access[8];
    unsigned long start, end, found = 0;
    FILE *maps = fopen("/proc/self/maps", "r");
    while (!found && fgets(line, sizeof line, maps)) {
        if (sscanf(line, "%lx-%lx %7s", &start, &end, access) == 3 && start <= address && address < end) {
            found = end;
            *isExecutable = access[2] == 'x';
        }
    }
    fclose(maps);
    return found;
}

// The loader knows nothing of the mapping of compiled code.
static int isCompiledCode(uintptr_t address)
{
    Dl_info info;
    int isExecutable = 0;
    return endOfMapping(address, &isExecutable) && isExecutable && !dladdr((void *)address, &info);
}

int change(int how)
{
    int unused;
    uintptr_t *bottom = __builtin_frame_address(0);
    uintptr_t *top = (uintptr_t *)endOfMapping((uintptr_t)bottom, &unused);
    for (uintptr_t *first = bottom; first < top; first++) {
        uintptr_t address = *first & bitsOfAddress, *words[wanted];
        int count = 0, withSignature = 0, signedForTheirPlace = 0;
        for (uintptr_t *word = first; word < top && count < wanted; word++) {
            if ((*word & bitsOfAddress) == address)
                words[count++] = word;
        }
        if (count < wanted || !isCompiledCode(address))
            continue;
        for (int i = 0; i < wanted; i++) {
            withSignature += *words[i] != address;
            signedForTheirPlace += *words[i] == signedFor(words[i], address);
        }
        if (how == Nothing)
            dprintf(1, "%d with a signature, %d signed for their place\\n", withSignature, signedForTheirPlace);
        // One signature in 128 is the one that is forged.
        int at = wanted / 2;
        while (withSignature && at < wanted - 1 && ((how == Address && signedFor(words[at], (uintptr_t)landed) == (uintptr_t)landed) || (how == WordOfAnotherFrame && *words[at] == *words[0])))
            at++;
        if (how == Address)
            *words[at] = (uintptr_t)landed;
        if (how == WordOfAnotherFrame)
            *words[at] = *words[0];
        if (how == SignedAddress)
            *words[at] = signedFor(words[at], (uintptr_t)landed);
        return 0;
    }
    dprintf(1, "no return address found\\n");
    return 0;
}
`;

const program = `import { dlopen, FFIType } from "bun:ffi";
const { change } = dlopen(process.argv[2], { change: { args: [FFIType.i32], returns: FFIType.i32 } }).symbols;
function descend(left: number): number {
  return left === 0 ? change(Number(process.argv[3])) : descend(left - 1) + 1;
}
console.log("returned", descend(process.argv.length * 64));
`;

test("a step that tests a build that signs has a processor that authenticates", () => {
  if (signs && process.env.EXPECTED_PLATFORM_OS) expect(processorAuthenticates).toBe(true);
});

test("the builds for arm64 sign as their steps say", () => {
  const { EXPECTED_PLATFORM_PROFILE: profile, EXPECTED_PLATFORM_OS: os } = process.env;
  if (!os) return;
  expect(signs).toBe(process.arch === "arm64" && (profile === "hardened" || profile === "hardened-unlocked"));
});

describe.skipIf(!isLinux || !!without("a C compiler"))("the return address that a compiled function has saved", () => {
  test("is followed only if it is signed for its place, where the build signs", async () => {
    using dir = tempDir("aot-hardened-return-addresses", { "library.c": library, "program.ts": program });
    const [shared, executable] = [join(String(dir), "library.so"), join(String(dir), "program")];
    const [compiled, built] = await Promise.all([
      run([cCompiler!, "-shared", "-fPIC", "-O1", "-o", shared, join(String(dir), "library.c"), "-ldl"]),
      run([bunExe(), "build", "--compile", "--aot", join(String(dir), "program.ts"), "--outfile", executable]),
    ]);
    expect(compiled).toMatchObject({ stderr: "", exitCode: 0 });
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

    const after = async (how: number) => {
      const { stdout, stderr, exitCode } = await run(withoutCoreDump([executable, shared, String(how)]), undefined, {
        ...bunEnv,
        ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }),
        BUN_ENABLE_CRASH_REPORTING: "0",
      });
      console.log(JSON.stringify({ how, signs, processorAuthenticates, stdout, exitCode }));
      if (exitCode) console.log(stderr);
      return { stdout, end: exitCode > 128 ? "a signal" : exitCode };
    };
    const [nothing, address, wordOfAnotherFrame] = [await after(0), await after(1), await after(2)];
    const [, withSignature, signedForTheirPlace] =
      /^(\d+) with a signature, (\d+) signed for their place\nreturned 256\n$/.exec(nothing.stdout)?.map(Number) ?? [];

    if (!signs || !processorAuthenticates) {
      expect({ withSignature, address, wordOfAnotherFrame }).toEqual({
        withSignature: 0,
        address: { stdout: "landed\n", end: 0 },
        wordOfAnotherFrame: { stdout: "returned 256\n", end: 0 },
      });
      return;
    }
    expect(withSignature).toBeGreaterThan(24);
    expect({ signedForTheirPlace, address, wordOfAnotherFrame, signedAddress: await after(3) }).toEqual({
      signedForTheirPlace: 32,
      address: { stdout: "", end: "a signal" },
      wordOfAnotherFrame: { stdout: "", end: "a signal" },
      signedAddress: { stdout: "landed\n", end: 0 },
    });
  });
});

describe.skipIf(!isLinux)("--aot-symbols", () => {
  async function buildWithSymbols(dir: string) {
    const executable = join(dir, "program");
    const flags = ["--compile", "--aot", "--aot-symbols", ...withoutDebugInformation];
    const { stderr, exitCode } = await run([bunExe(), "build", ...flags, "program.ts", "--outfile", executable], dir);
    expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    return executable;
  }
  const files = {
    "program.ts": `function descend(left: number): number {
  return left === 0 ? process.argv.length : descend(left - 1) + 1;
}
console.log(descend(process.argv.length * 64));
`,
  };

  test("says whether return addresses are signed", async () => {
    using dir = tempDir("aot-hardened-rules-of-frames", files);
    const file = readFileSync(await buildWithSymbols(String(dir)));
    const [framePointer, returnAddress] = process.arch === "arm64" ? [29, 30] : [6, 16];
    const rules = Buffer.from([
      ...[20, 0, 0, 0, 255, 255, 255, 255, 1, 0, 1, 0x78, returnAddress, 0x0c, framePointer, 16],
      ...[0x80 | returnAddress, 1, 0x80 | framePointer, 2],
    ]);
    const DW_CFA_AARCH64_negate_ra_state = 0x2d;
    expect(file.includes(rules)).toBe(true);
    expect(file[file.lastIndexOf(rules) + rules.length]).toBe(signs ? DW_CFA_AARCH64_negate_ra_state : 0);
  });

  test.skipIf(!Bun.which("gdb"))("lets a debugger find the callers of a compiled function", async () => {
    using dir = tempDir("aot-hardened-backtrace", files);
    const commands = ["handle all nostop noprint pass", "starti", "hbreak *'descend program.ts:1'", "continue", "bt 3"];
    const { stdout, stderr } = await run([
      ...["gdb", "-nx", "-batch", ...commands.flatMap(command => ["-ex", command])],
      await buildWithSymbols(String(dir)),
    ]);
    console.log(stdout, stderr);
    const frames = [...stdout.matchAll(/^#\d+ +0x([0-9a-f]+) (?:\[PAC\] )?in (\S+)/gm)];
    expect(frames.map(([, address]) => BigInt("0x" + address) >> 48n)).toEqual([0n, 0n, 0n]);
    expect(frames.slice(0, 2).map(([, , name]) => name)).toEqual(["descend", expect.stringMatching(/^\w/)]);
  });
});
