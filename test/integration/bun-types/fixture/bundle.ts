/**
 * Type tests for the "bun:bundle" module.
 */

import { feature } from "bun:bundle";
import { expectType } from "./utilities";

// feature() returns boolean
expectType(feature("DEBUG")).is<boolean>();

// Import alias works
import { feature as checkFeature } from "bun:bundle";
expectType(checkFeature("FLAG")).is<boolean>();

// Bun.build features option accepts string array
Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./dist",
  features: ["FEATURE_A", "FEATURE_B"],
});

// Error cases:

// @ts-expect-error - feature() requires exactly one argument
feature();

// @ts-expect-error - feature() requires a string argument
feature(123);

// @ts-expect-error - feature() requires a string argument
feature(true);

// @ts-expect-error - feature() requires a string argument
feature(null);

// @ts-expect-error - feature() requires a string argument
feature(undefined);

// @ts-expect-error - feature() doesn't accept multiple arguments
feature("A", "B");

// @ts-expect-error - feature() doesn't accept objects
feature({ flag: "DEBUG" });

// @ts-expect-error - feature() doesn't accept arrays
feature(["DEBUG"]);
