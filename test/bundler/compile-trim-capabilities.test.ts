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
