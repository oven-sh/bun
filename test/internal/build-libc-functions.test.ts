import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { definesLibcFunctions } from "../../scripts/build/flags.ts";

const source = readFileSync(join(import.meta.dir, "../../src/jsc/bindings/BunSignalActions.cpp"), "utf8");

function conditionOf(macro: string): string {
  const condition = new RegExp(`^#if (.*)\\n#define ${macro} 1$`, "m").exec(source)?.[1];
  if (condition === undefined) throw new Error(`BunSignalActions.cpp has no "#if .." in front of "#define ${macro} 1"`);
  return condition;
}

interface Target {
  aot: boolean;
  os: "linux" | "freebsd" | "darwin";
  abi: "gnu" | "musl" | "android" | undefined;
  asan: boolean;
}

function evaluate(condition: string, target: Target): boolean {
  const values: Record<string, boolean> = {
    "ENABLE(AOT)": target.aot,
    "OS(LINUX)": target.os === "linux",
    "OS(FREEBSD)": target.os === "freebsd",
    "OS(ANDROID)": target.abi === "android",
    "ASAN_ENABLED": target.asan,
  };
  const words = condition.replace(
    /HANDLES_ACCESS_FAULTS_BY_SIGNAL/g,
    `(${conditionOf("HANDLES_ACCESS_FAULTS_BY_SIGNAL")})`,
  );
  const text = words.replace(/[A-Z_]+(\([A-Z_]+\))?/g, word => {
    if (!(word in values)) throw new Error(`the test does not know ${word}`);
    return String(values[word]);
  });
  expect(text).toMatch(/^[a-z()!&| ]+$/);
  return new Function(`return ${text};`)();
}

test("the link exports the functions of libc exactly where BunSignalActions.cpp defines them", () => {
  const targets: Target[] = [true, false].flatMap(aot =>
    [true, false].flatMap(asan => [
      { aot, asan, os: "linux", abi: "gnu" },
      { aot, asan, os: "linux", abi: "musl" },
      { aot, asan, os: "linux", abi: "android" },
      { aot, asan, os: "freebsd", abi: undefined },
      { aot, asan, os: "darwin", abi: undefined },
    ]),
  );
  const condition = conditionOf("DEFINES_SIGNAL_FUNCTIONS_OF_LIBC");
  for (const target of targets) {
    const { aot, asan, abi } = target;
    expect({ ...target, exports: definesLibcFunctions({ aot, asan, abi, linux: target.os === "linux" }) }).toEqual({
      ...target,
      exports: evaluate(condition, target),
    });
  }
  expect(targets.filter(target => evaluate(condition, target))).toEqual([
    { aot: true, asan: false, os: "linux", abi: "gnu" },
    { aot: true, asan: false, os: "linux", abi: "musl" },
  ]);
});
