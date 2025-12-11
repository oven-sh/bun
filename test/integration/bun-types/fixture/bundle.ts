/**
 * Type tests for the "bun:bundle" module.
 *
 * This module provides compile-time utilities for dead-code elimination
 * via feature flags. The `feature()` function is replaced with boolean
 * literals at bundle time.
 */

import { feature } from "bun:bundle";
import { expectType } from "./utilities";

// Basic feature() call returns boolean
{
  const result = feature("DEBUG");
  expectType(result).is<boolean>();
}

// Feature flags in conditional statements
{
  if (feature("FEATURE_A")) {
    // This branch is included when --feature=FEATURE_A is passed
    console.log("Feature A enabled");
  }

  if (feature("FEATURE_B")) {
    console.log("Feature B enabled");
  } else {
    console.log("Feature B disabled");
  }
}

// Feature flags with ternary operator
{
  const value = feature("PREMIUM") ? "premium" : "free";
  expectType(value).is<string>();

  const numericValue = feature("V2") ? 2 : 1;
  expectType(numericValue).is<number>();
}

// Feature flags with logical operators
{
  const andResult = feature("A") && feature("B");
  expectType(andResult).is<boolean>();

  const orResult = feature("A") || feature("B");
  expectType(orResult).is<boolean>();

  const notResult = !feature("A");
  expectType(notResult).is<boolean>();
}

// Feature flags used in function contexts
{
  function getConfig() {
    return {
      debug: feature("DEBUG"),
      verbose: feature("VERBOSE"),
      experimental: feature("EXPERIMENTAL"),
    };
  }

  const config = getConfig();
  expectType(config.debug).is<boolean>();
  expectType(config.verbose).is<boolean>();
  expectType(config.experimental).is<boolean>();
}

// Feature flags as object property values
{
  const features = {
    enableLogs: feature("LOGS"),
    enableMetrics: feature("METRICS"),
    enableTracing: feature("TRACING"),
  };

  expectType(features).is<{ enableLogs: boolean; enableMetrics: boolean; enableTracing: boolean }>();
}

// Feature flags in array contexts
{
  const flagResults = [feature("A"), feature("B"), feature("C")];
  expectType(flagResults).is<boolean[]>();
}

// Feature flags with string literal argument
{
  // These should all type-check correctly
  feature("lowercase");
  feature("UPPERCASE");
  feature("Mixed_Case_123");
  feature("with-dashes");
  feature("with.dots");
  feature("with:colons");
}

// Feature flags in conditional type narrowing
{
  function conditionalLogic(): string {
    if (feature("EXPERIMENTAL")) {
      return "experimental path";
    }
    return "stable path";
  }
  expectType(conditionalLogic()).is<string>();
}

// Feature flags in switch statements (though typically used with if)
{
  const flagValue = feature("MODE");
  // The value is always boolean, so switch is unusual but valid
  switch (flagValue) {
    case true:
      console.log("enabled");
      break;
    case false:
      console.log("disabled");
      break;
  }
}

// Combining feature flags with other Bun.build options
{
  Bun.build({
    entrypoints: ["./index.ts"],
    outdir: "./dist",
    features: ["FEATURE_A", "FEATURE_B", "DEBUG"],
    minify: feature("PRODUCTION"), // Can use feature() in build config too
  });
}

// Feature flags in class contexts
{
  class FeatureGatedClass {
    isDebug = feature("DEBUG");
    isProduction = feature("PRODUCTION");

    getMode() {
      return feature("VERBOSE") ? "verbose" : "normal";
    }
  }

  const instance = new FeatureGatedClass();
  expectType(instance.isDebug).is<boolean>();
  expectType(instance.isProduction).is<boolean>();
  expectType(instance.getMode()).is<string>();
}

// Feature flags with template literals
{
  const message = `Debug mode: ${feature("DEBUG")}`;
  expectType(message).is<string>();
}

// Feature flags stored in variables and reused
{
  const isDebug = feature("DEBUG");
  const isVerbose = feature("VERBOSE");

  if (isDebug && isVerbose) {
    console.log("Full debug output");
  } else if (isDebug) {
    console.log("Debug output");
  }

  expectType(isDebug).is<boolean>();
  expectType(isVerbose).is<boolean>();
}

// Feature flags in async contexts
{
  async function asyncFeatureCheck() {
    if (feature("ASYNC_FEATURE")) {
      return await Promise.resolve("async enabled");
    }
    return "async disabled";
  }
  expectType(asyncFeatureCheck()).is<Promise<string>>();
}

// Feature flags in generator functions
{
  function* featureGenerator(): Generator<string, void, unknown> {
    if (feature("GENERATOR_FEATURE")) {
      yield "feature enabled";
    }
    yield "default";
  }
  const gen = featureGenerator();
  expectType(gen).is<Generator<string, void, unknown>>();
}

// Import alias should also work
import { feature as checkFeature } from "bun:bundle";
{
  const aliasResult = checkFeature("ALIASED_CHECK");
  expectType(aliasResult).is<boolean>();
}

// Feature flags with complex boolean expressions
{
  const complexCondition = (feature("A") && feature("B")) || (!feature("C") && (feature("D") || feature("E")));
  expectType(complexCondition).is<boolean>();
}

// Feature flags for conditional exports pattern
{
  const publicAPI = {
    version: "1.0.0",
    ...(feature("INTERNAL") && { _internal: "secret" }),
  };
  // The spread with && can add properties conditionally
  expectType(publicAPI.version).is<string>();
}

// Feature flags with nullish coalescing (edge case - boolean never nullish)
{
  const withNullish = feature("FLAG") ?? false;
  expectType(withNullish).is<boolean>();
}

// Error cases - these should produce type errors:

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
