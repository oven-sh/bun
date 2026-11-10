import { expect, test } from "bun:test";
import { copyOfEngine, generateAgainst, hasNoPrebuiltEngine, timeLimitOfOneRun } from "./prebuilt-engine.ts";

test.skipIf(hasNoPrebuiltEngine)(
  "an engine compiled with this tree's table is accepted",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const { exitCode, errors } = await generateAgainst(generatedCopy);
    expect(errors).not.toContain("another list of the built-ins");
    expect(exitCode).toBe(0);
  },
  timeLimitOfOneRun,
);
