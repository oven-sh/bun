// What a program is said to name although it names nothing: the names in the built-in JavaScript that is compiled into every executable.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
});

async function factsOf(text: string) {
  using dir = tempDir("aot-runtime-use-of-built-in-code", {
    "tsconfig.json": tsconfig,
    "main.ts": `declare const console: any, process: any, require: any;\n${text}`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=runtime-use", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const prefix = "aot: runtime use: ";
  const lines = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  expect({ exitCode, world: lines[0] }).toEqual({ exitCode: 0, world: "closed" });
  return new Set(lines);
}

const onlyWithNodeUtil = [
  "module node:util",
  "module node:os",
  "module internal:promisify",
  "module internal:streams/state",
  "module internal:streams/utils",
  "module internal:tty",
  "module internal:util/colors",
  "module internal:util/comparisons",
  "module internal:util/deprecate",
  "module internal:util/mime",
  "native JSMIMEParams.cpp:createJSMIMEBinding",
  "native node_os.bind.ts:cpus",
  "native node_os.bind.ts:networkInterfaces",
  "native parse_args.rs:parseArgs",
  "native node_util_binding.rs:internalErrorEntries",
  "global AbortSignal",
  "global FinalizationRegistry",
  "global TextEncoder",
  "global navigator",
];

describe.concurrent("the built-in code that is part of every program", () => {
  test("does not bring node:util and what it requires", async () => {
    const facts = await factsOf(`console.log("hello");`);
    expect(onlyWithNodeUtil.filter(fact => facts.has(fact))).toEqual([]);
    expect(facts.has("module internal:fixed_queue")).toBe(false);
  });

  test("a program that requires node:util names all of it", async () => {
    const facts = await factsOf(`console.log(require("node:util").format("%s", 1));`);
    expect(onlyWithNodeUtil.filter(fact => !facts.has(fact))).toEqual([]);
  });

  test("a program that requires node:events names its queue", async () => {
    const facts = await factsOf(`console.log(require("node:events").on);`);
    expect(facts.has("module internal:fixed_queue")).toBe(true);
  });
});
