/**
 * sourceStamp() in src/codegen/helpers.ts computes the stamp that identifies the
 * builtin module sources in InternalModuleRegistryConstants.bin. It must run with
 * the Bun APIs disabled (see without-bun-apis.ts).
 */
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runWithoutBunApis } from "./without-bun-apis.ts";

const helpers = pathToFileURL(join(import.meta.dirname, "..", "..", "..", "src", "codegen", "helpers.ts")).href;

test("sourceStamp() is the first four bytes of the SHA-256 digest, big-endian, with the Bun APIs disabled", async () => {
  using dir = tempDir("source-stamp", {
    "stamp-fixture.ts": `
      import { sourceStamp } from ${JSON.stringify(helpers)};
      console.log(sourceStamp(["a", "b"]), sourceStamp([]));
    `,
  });

  const { stdout, stderr, exitCode } = await runWithoutBunApis([join(String(dir), "stamp-fixture.ts")]);

  expect(stderr).toBe("");
  // The SHA-256 digest of "ab" starts with fb8e20fc. The digest of "" starts with e3b0c442.
  expect(stdout).toBe(`${0xfb8e20fc} ${0xe3b0c442}\n`);
  expect(exitCode).toBe(0);
});
