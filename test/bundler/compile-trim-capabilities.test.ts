import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawned, unsupported } from "../aot/run-programs";
import {
  featureNamed,
  featureOf,
  tempDirForAotBuilds,
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

async function build(folder: string, outfile: string, without: string[]) {
  const trim = without.length > 0 ? ["--trim", ...withoutFeatures([...new Set(without)])] : [];
  const built = await spawned(
    [bunExe(), "build", "--compile", ...trim, "hello.ts", "--outfile", outfile],
    folder,
    bunEnv,
  );
  return { ...built, file: built.exitCode === 0 ? readFileSync(join(folder, outfile)) : new Uint8Array() };
}

const namesOf = (places: { name: string }[]) => [...new Set(places.map(place => place.name))].sort();
const numbersOf = (places: { number: number }[]) =>
  [...new Set(places.map(place => place.number))].sort((a, b) => a - b);

if (isASAN)
  console.error(
    "SKIPPED: compile-trim-capabilities.test.ts: a Bun built with AddressSanitizer can't trim, and calls the sanitizer's own dlopen",
  );

describe.skipIf(isWindows || isASAN)("an executable without what starts programs", () => {
  test("holds no place that calls a function, or makes a system call, that starts one", async () => {
    using dir = tempDir("compile-trim-capabilities", { "hello.ts": `console.log("hello world");` });
    const folder = String(dir);

    const whole = await build(folder, "whole", []);
    expect(whole).toMatchObject({ exitCode: 0 });
    expect(namesOf(placesThatCall(whole.file, startsAProgram.functions))).toEqual(
      expect.arrayContaining(["execve", "fork"]),
    );
    if (isLinux) expect(numbersOf(placesThatMakeSystemCalls(whole.file, startsAProgram.systemCalls))).toContain(435);

    const cut = await build(folder, "cut", startsAProgram.features);
    if (cut.stderr.includes("this build of Bun doesn't support --trim")) return;
    expect(cut).toMatchObject({ exitCode: 0 });
    expect(placesThatCall(cut.file, startsAProgram.functions)).toEqual([]);
    expect(placesThatMakeSystemCalls(cut.file, startsAProgram.systemCalls)).toEqual([]);
    expect(await spawned([join(folder, "cut")], folder, bunEnv)).toMatchObject({
      stdout: "hello world\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!!unsupported)(
    "a program that starts none, built with compile: { aot: true, trim: true }, keeps only what sends a crash report",
    async () => {
      using dir = tempDirForAotBuilds("compile-trim-capabilities", { "hello.ts": `console.log("hello world");` });
      const folder = String(dir);
      try {
        await Bun.build({
          entrypoints: [join(folder, "hello.ts")],
          compile: { outfile: join(folder, "named"), aot: true, trim: true },
        });
      } catch (error) {
        expect((error as AggregateError).errors[0].message).toContain("this build of Bun doesn't support --trim");
        return;
      }
      const file = readFileSync(join(folder, "named"));
      expect(
        namesOf(placesThatCall(file, startsAProgram.functions)).filter(name => !sendsACrashReport.includes(name)),
      ).toEqual([]);
      expect(placesThatMakeSystemCalls(file, startsAProgram.systemCalls)).toEqual([]);
      expect(await spawned([join(folder, "named")], folder, bunEnv)).toMatchObject({
        stdout: "hello world\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );
});

describe.skipIf(isWindows || isASAN)("an executable without what loads native code", () => {
  test("holds no place that calls dlopen", async () => {
    using dir = tempDir("compile-trim-capabilities", { "hello.ts": `console.log("hello world");` });
    const folder = String(dir);

    const whole = await build(folder, "whole", []);
    expect(whole).toMatchObject({ exitCode: 0 });
    expect(namesOf(placesThatCall(whole.file, loadsNativeCode.functions))).toEqual(["dlopen"]);

    const cut = await build(folder, "cut", loadsNativeCode.features);
    if (cut.stderr.includes("this build of Bun doesn't support --trim")) return;
    expect(cut).toMatchObject({ exitCode: 0 });
    expect(placesThatCall(cut.file, loadsNativeCode.functions)).toEqual([]);
    expect(await spawned([join(folder, "cut")], folder, bunEnv)).toMatchObject({
      stdout: "hello world\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
