import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { doorsPath, readTrimFeatures } from "../../scripts/build/trim-features";
import { spawned } from "../aot/run-programs";
import { placesThatCall, placesThatMakeSystemCalls } from "./what-an-executable-can-call";

const doors = readFileSync(doorsPath, "utf8");
const commandLine = readTrimFeatures(doors).names.find(each => each.name === "cli")!.features;
const features = doors
  .split("\n")
  .filter(line => line.startsWith("feature "))
  .map(line => line.split(" ")[1]!);

const startsAProgram = {
  functions: ["fork", "vfork", "execve", "execvp", "execv", "execvpe", "fexecve", "posix_spawn", "posix_spawnp", "pidfd_spawn", "pidfd_spawnp", "system", "popen", "clone", "daemon", "forkpty"],
  systemCalls: process.arch === "arm64" ? [220, 221, 281, 435] : [56, 57, 58, 59, 322, 435],
  features: ["child_process", "hot_reload", "crash_report", "process_execve"],
  users: [...commandLine, "testing", "spawn", "shell", "cron", "webview", "open_in_editor", "terminal", "node_cluster", "ffi", "napi"],
};

async function build(folder: string, outfile: string, without: string[]) {
  const trim = without.length > 0 ? ["--compile-trim-runtime"] : [];
  const built = await spawned([bunExe(), "build", "--compile", ...trim, "hello.ts", "--outfile", outfile], folder, { ...bunEnv, BUN_TRIM_RUNTIME_WITHOUT: without.join(",") });
  return { ...built, file: built.exitCode === 0 ? readFileSync(join(folder, outfile)) : new Uint8Array() };
}

const namesOf = (places: { name: string }[]) => [...new Set(places.map(place => place.name))].sort();
const numbersOf = (places: { number: number }[]) => [...new Set(places.map(place => place.number))].sort((a, b) => a - b);

describe.skipIf(isWindows || !startsAProgram.features.every(feature => features.includes(feature)))("an executable without what starts programs", () => {
  test("holds no place that calls a function, or makes a system call, that starts one", async () => {
    using dir = tempDir("compile-trim-capabilities", { "hello.ts": `console.log("hello world");` });
    const folder = String(dir);

    const whole = await build(folder, "whole", []);
    expect(whole).toMatchObject({ exitCode: 0 });
    expect(namesOf(placesThatCall(whole.file, startsAProgram.functions))).toEqual(expect.arrayContaining(["execve", "fork"]));
    if (isLinux) expect(numbersOf(placesThatMakeSystemCalls(whole.file, startsAProgram.systemCalls))).toContain(435);

    const cut = await build(folder, "cut", [...startsAProgram.features, ...startsAProgram.users].filter(feature => features.includes(feature)));
    if (cut.stderr.includes("nothing can be left out of this Bun")) return;
    expect(cut).toMatchObject({ exitCode: 0 });
    expect(placesThatCall(cut.file, startsAProgram.functions)).toEqual([]);
    expect(placesThatMakeSystemCalls(cut.file, startsAProgram.systemCalls)).toEqual([]);
    expect(await spawned([join(folder, "cut")], folder, bunEnv)).toMatchObject({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });

  test("so does one built with compile.trim's names for it", async () => {
    using dir = tempDir("compile-trim-capabilities", { "hello.ts": `console.log("hello world");` });
    const folder = String(dir);
    try {
      await Bun.build({ entrypoints: [join(folder, "hello.ts")], compile: { outfile: join(folder, "named"), trim: ["cli", "spawn", "native-code"] } });
    } catch (error) {
      expect((error as AggregateError).errors[0].message).toContain("nothing can be left out of this Bun");
      return;
    }
    const file = readFileSync(join(folder, "named"));
    expect(placesThatCall(file, startsAProgram.functions)).toEqual([]);
    expect(placesThatMakeSystemCalls(file, startsAProgram.systemCalls)).toEqual([]);
    expect(await spawned([join(folder, "named")], folder, bunEnv)).toMatchObject({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  });
});
