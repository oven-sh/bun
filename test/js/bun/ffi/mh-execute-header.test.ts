// Regression: when the macOS link moved from Apple ld64 to ld64.lld, the
// `__mh_execute_header` symbol stopped appearing in the export trie because
// lld honors `-exported_symbols_list` strictly (Apple ld64 always injected it
// regardless). Any dylib or node-gyp addon built with `-undefined
// dynamic_lookup` that references `_mh_execute_header` (via <mach-o/ldsyms.h>,
// getsectbyname, or profiling/introspection helpers) then fails to load with
// "symbol not found in flat namespace '__mh_execute_header'".
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { join } from "path";

const cc = Bun.which("cc") || Bun.which("clang");

test.skipIf(!isMacOS || !cc)("dylib referencing _mh_execute_header loads via flat-namespace lookup", async () => {
  using dir = tempDir("mh-execute-header", {
    "probe.c": `
      #include <mach-o/ldsyms.h>
      __attribute__((visibility("default")))
      const void* probe(void) { return (const void*)&_mh_execute_header; }
    `,
  });
  const dirPath = String(dir);
  const dylib = join(dirPath, "probe.dylib");

  await using compile = Bun.spawn({
    cmd: [cc!, "-dynamiclib", "-o", dylib, join(dirPath, "probe.c"), "-undefined", "dynamic_lookup"],
    env: bunEnv,
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
  if (ccExit !== 0) {
    console.error("cc stdout:", ccOut);
    console.error("cc stderr:", ccErr);
  }
  expect(ccExit).toBe(0);

  // Load in a subprocess so a dlopen failure surfaces as test output rather
  // than poisoning this process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { dlopen } = require("bun:ffi");
        const lib = dlopen(${JSON.stringify(dylib)}, { probe: { args: [], returns: "ptr" } });
        const p = lib.symbols.probe();
        console.log("probe:" + (p !== null && p !== 0));
      `,
    ],
    env: bunEnv,
    cwd: dirPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: "probe:true",
    stderr: "",
    exitCode: 0,
  });
});
