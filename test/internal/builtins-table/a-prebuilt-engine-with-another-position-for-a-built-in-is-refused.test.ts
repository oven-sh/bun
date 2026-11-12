import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyOfEngine, generateAgainst, hasNoPrebuiltEngine, timeLimitOfOneRun } from "./prebuilt-engine.ts";

test.skipIf(hasNoPrebuiltEngine)(
  "an engine compiled with another position for one built-in that it names is refused by name",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const ids = join(generatedCopy, "AOTBuiltinIDs.h");
    const text = readFileSync(ids, "utf8");
    const line = /inline constexpr NamedTableID<BuiltinID> ArrayPrototypePush \{ (\d+) \};/.exec(text)!;
    writeFileSync(
      ids,
      text.replace(line[0], `inline constexpr NamedTableID<BuiltinID> ArrayPrototypePush { ${Number(line[1]) + 1} };`),
    );
    const { exitCode, errors } = await generateAgainst(generatedCopy);
    expect(errors).toContain("AOTBuiltinIDs.h");
    expect(errors).toContain(line[0]);
    expect(errors).toContain("another list of the built-ins");
    expect(exitCode).toBe(1);
  },
  timeLimitOfOneRun,
);
