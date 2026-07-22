// Guards against regressing InternalModuleRegistryConstants.h back into a
// multi-megabyte `static constexpr const char FooBytes[] = {40,102,...}` dump.
// That form costs clang's frontend ~15s to parse on the release critical path;
// the header is now just an {offset, length} table into a linked `.incbin` blob.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { bunEnv, bunExe } from "harness";

const codegenDir = join(dirname(bunExe()), "codegen");
const header = join(codegenDir, "InternalModuleRegistryConstants.h");

// CI test lanes run a downloaded binary with no adjacent codegen/ dir; this
// check is for local `bun bd test` and the gate, which build from source.
const hasBuildArtifacts = existsSync(header);

test.skipIf(!hasBuildArtifacts)(
  "InternalModuleRegistryConstants.h is an offset table, not a byte-array dump",
  () => {
    const size = statSync(header).size;
    const text = readFileSync(header, "utf8");

    expect(text).toContain("bun_internal_modules_data");
    expect(text).not.toMatch(/static constexpr const char \w+Bytes\[/);
    // Old release header was ~6 MB of comma-separated decimals.
    expect(size).toBeLessThan(100 * 1024);
  },
);

// Functional check: a representative set of JS-backed builtins (the modules
// whose sources live in the linked blob in release builds) load and evaluate.
test("JS-backed internal modules load", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const specs = [
          "node:assert", "node:events", "node:fs", "node:stream",
          "node:net", "node:http", "node:util", "bun:sqlite",
        ];
        for (const s of specs) {
          const m = require(s);
          if (typeof m !== "object" && typeof m !== "function") throw new Error(s);
        }
        require("node:assert").strictEqual(require("node:path").posix.join("a", "b"), "a/b");
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
