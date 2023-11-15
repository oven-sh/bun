"use strict";
/* eslint max-len: 0 */
import { test, describe, it, expect } from "bun:test";
import { parseArgs } from "node:util";

// The use of `-` as a positional is specifically mentioned in the Open Group Utility Conventions.
// The interpretation is up to the utility, and for a file positional (operand) the examples are
// '-' may stand for standard input (or standard output), or for a file named -.
// https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html
//
// A different usage and example is `git switch -` to switch back to the previous branch.

test("dash: when args include '-' used as positional then result has '-' in positionals", t => {
  const args = ["-"];
  const expected = { values: { __proto__: null }, positionals: ["-"] };

  const result = parseArgs({ allowPositionals: true, args });

  expect(result).toEqual(expected);
});

// If '-' is a valid positional, it is symmetrical to allow it as an option value too.
test("dash: when args include '-' used as space-separated option value then result has '-' in option value", t => {
  const args = ["-v", "-"];
  const options = { v: { type: "string" } };
  const expected = { values: { __proto__: null, v: "-" }, positionals: [] };

  const result = parseArgs({ args, options });

  t.deepEqual(result, expected);
  t.end();
});
