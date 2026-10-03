// https://github.com/oven-sh/bun/issues/29681
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMusl, tempDir } from "harness";
import { join } from "node:path";

const cc = process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");
const cxx = process.env.CXX || Bun.which("c++") || Bun.which("clang++") || Bun.which("g++");
const readelf = Bun.which("readelf");

function hasOptionalCxxRuntimeProvider(): boolean {
  if (!isMusl) return false;

  try {
    const probe = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `import { dlopen } from "bun:ffi"; const library = dlopen("libstdc++.so.6", { _Znwm: { args: ["usize"], returns: "ptr" } }); library.close();`,
      ],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    return probe.exitCode === 0;
  } catch {
    return false;
  }
}

const hasCxxRuntimeProvider = hasOptionalCxxRuntimeProvider();

test.skipIf(!isMusl || !readelf)("bun does not depend on the host C++ runtime", () => {
  const dynamic = Bun.spawnSync([readelf!, "-d", bunExe()]);
  const stdout = dynamic.stdout.toString();
  const forbiddenDependency = stdout.match(/NEEDED.*(?:libstdc\+\+\.so\.6|libgcc_s\.so\.1)/)?.[0] ?? "";
  expect({ forbiddenDependency, stderr: dynamic.stderr.toString(), exitCode: dynamic.exitCode }).toEqual({
    forbiddenDependency: "",
    stderr: "",
    exitCode: 0,
  });
});

interface AddonFixture {
  compiler: string;
  compilerFlags?: string[];
  expectedResult: boolean | number;
  expectedSymbols: string[];
  resultProperty: string;
  source: string;
}

async function compileAndLoadAddon(fixture: AddonFixture) {
  using dir = tempDir("issue-29681", {
    "load.js": `
      const { readFileSync } = require("node:fs");
      const runtimeMaps = () => readFileSync("/proc/self/maps", "utf8")
        .split("\\n")
        .filter(line => line.includes("libstdc++.so.6") || line.includes("libgcc_s.so.1"));

      const before = runtimeMaps();
      const addon = require("./addon.node");
      const result = addon[${JSON.stringify(fixture.resultProperty)}];
      const after = runtimeMaps();
      console.log(JSON.stringify({ before, result, after }));
    `,
  });
  const dirPath = String(dir);
  const addonPath = join(dirPath, "addon.node");
  const fixturePath = join(import.meta.dir, fixture.source);
  const napiInclude = join(import.meta.dir, "..", "..", "..", "src", "runtime", "napi");

  await using compile = Bun.spawn({
    cmd: [
      fixture.compiler,
      ...(fixture.compilerFlags ?? []),
      "-shared",
      "-fPIC",
      "-nostdlib",
      "-Wl,-z,now",
      "-I",
      napiInclude,
      "-o",
      addonPath,
      fixturePath,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [compileStdout, compileStderr, compileExitCode] = await Promise.all([
    compile.stdout.text(),
    compile.stderr.text(),
    compile.exited,
  ]);
  expect({ stdout: compileStdout, stderr: compileStderr, exitCode: compileExitCode }).toEqual({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });

  const dynamic = Bun.spawnSync([readelf!, "-d", addonPath]);
  const symbols = Bun.spawnSync([readelf!, "-Ws", addonPath]);
  expect({ stderr: dynamic.stderr.toString(), exitCode: dynamic.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect({ stderr: symbols.stderr.toString(), exitCode: symbols.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(dynamic.stdout.toString()).not.toContain("NEEDED");
  for (const symbol of fixture.expectedSymbols) {
    expect(symbols.stdout.toString()).toContain(`UND ${symbol}`);
  }

  await using run = Bun.spawn({
    cmd: [bunExe(), join(dirPath, "load.js")],
    cwd: dirPath,
    env: { ...bunEnv, LD_PRELOAD: undefined },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  let parsedStdout: unknown = stdout;
  try {
    parsedStdout = JSON.parse(stdout);
  } catch {}
  expect({ parsedStdout, stderr, exitCode }).toEqual({
    parsedStdout: {
      before: [],
      result: fixture.expectedResult,
      after: expect.arrayContaining([expect.stringContaining("libstdc++.so.6")]),
    },
    stderr: "",
    exitCode: 0,
  });
}

// The compatibility provider is optional, so clean musl developer images may not have it.
test.skipIf(!isMusl || !cc || !readelf || !hasCxxRuntimeProvider)(
  "a legacy new/delete addon can use the optional host C++ runtime",
  () =>
    compileAndLoadAddon({
      compiler: cc!,
      expectedResult: true,
      expectedSymbols: ["_Znwm", "_ZdlPv"],
      resultProperty: "loaded",
      source: "29681-cxx-runtime-addon.c",
    }),
);

test.skipIf(!isMusl || !cxx || !readelf || !hasCxxRuntimeProvider)(
  "a legacy exception addon can use the optional host C++ runtime",
  () =>
    compileAndLoadAddon({
      compiler: cxx!,
      compilerFlags: ["-O0", "-fexceptions"],
      expectedResult: 42,
      expectedSymbols: [
        "__cxa_allocate_exception",
        "__cxa_throw",
        "__cxa_begin_catch",
        "__cxa_end_catch",
        "__gxx_personality_v0",
        "_Unwind_Resume",
        "_ZTVN10__cxxabiv117__class_type_infoE",
      ],
      resultProperty: "caught",
      source: "29681-cxx-exception-addon.cpp",
    }),
);
