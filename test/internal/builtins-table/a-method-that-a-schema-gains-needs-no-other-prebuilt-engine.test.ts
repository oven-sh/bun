import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bunRoot,
  copyOfEngine,
  generateAgainst,
  hasNoPrebuiltEngine,
  schemas,
  timeLimitOfOneRun,
} from "./prebuilt-engine.ts";

test.skipIf(hasNoPrebuiltEngine)(
  "a native method that a schema gains needs no other engine",
  async () => {
    const { root, generatedCopy } = copyOfEngine();
    using _ = root;
    const schema = schemas.find(path => path.endsWith("sourcemap.bind.ts"))!;
    const text = readFileSync(schema, "utf8");
    const member = "    findEntry: {";
    expect(text).toContain(member);
    using changed = tempDir("schema-with-one-more-method", {
      "sourcemap.bind.ts": text
        // It lands in a string literal, where a backslash begins an escape.
        .replace(
          "../../codegen/bindgen-lib.ts",
          join(bunRoot, "src", "codegen", "bindgen-lib.ts").replaceAll("\\", "/"),
        )
        .replace(member, `    aMethodNobodyHasYet: { ...find, args: { lineOffset: b.any } },\n${member}`),
    });
    const sources = schemas.map(path => (path === schema ? join(String(changed), "sourcemap.bind.ts") : path));
    const { exitCode, errors, tableOfBuiltins } = await generateAgainst(generatedCopy, sources);
    expect(errors).not.toContain("another list of the built-ins");
    expect(exitCode).toBe(0);
    expect(tableOfBuiltins).toContain("aMethodNobodyHasYet");
  },
  timeLimitOfOneRun,
);
