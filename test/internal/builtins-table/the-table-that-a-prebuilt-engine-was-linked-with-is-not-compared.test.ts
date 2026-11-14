import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyOfEngine, generateAgainst, hasNoPrebuiltEngine, timeLimitOfOneRun } from "./prebuilt-engine.ts";

test.skipIf(hasNoPrebuiltEngine)(
  "the table that the engine's own programs were linked with is not compared",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    writeFileSync(join(generatedCopy, "AOTBuiltinTableBuiltins.cpp"), "// Written from other natives.\n");
    const { exitCode, errors } = await generateAgainst(generatedCopy);
    expect(errors).not.toContain("AOTBuiltinTableBuiltins.cpp");
    expect(exitCode).toBe(0);
  },
  timeLimitOfOneRun,
);
