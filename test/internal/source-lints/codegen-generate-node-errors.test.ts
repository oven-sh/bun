/**
 * src/codegen/generate-node-errors.ts turns src/jsc/bindings/ErrorCode.ts into
 * C++, Rust, and .d.ts sources. It must run with the Bun APIs disabled (see
 * without-bun-apis.ts).
 */
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runWithoutBunApis } from "./without-bun-apis.ts";

const script = join(import.meta.dirname, "..", "..", "..", "src", "codegen", "generate-node-errors.ts");

test("generate-node-errors.ts writes its outputs with the Bun APIs disabled", async () => {
  using dir = tempDir("generate-node-errors", {});

  const { stderr, exitCode } = await runWithoutBunApis([script, String(dir)]);

  expect(stderr).toBe("");
  expect(readdirSync(String(dir)).sort()).toEqual([
    "ErrorCode+Data.h",
    "ErrorCode+List.h",
    "ErrorCode.d.ts",
    "ErrorCode.generated.rs",
  ]);
  expect(readFileSync(join(String(dir), "ErrorCode+List.h"), "utf8")).toContain("ERR_INVALID_ARG_TYPE");
  expect(exitCode).toBe(0);
});
