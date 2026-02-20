import { $ } from "bun";
import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/17244
// Shell template literals leaked __bunstr_N when the first interpolated value
// contained a space and a subsequent value contained a multi-byte UTF-8 character.

test("shell interpolation with space and multi-byte UTF-8", async () => {
  const a = " ";
  const b = "Í";

  const result = await $`echo ${a} ${b}`.text();
  expect(result.trim()).toBe("Í");
  expect(result).not.toContain("__bunstr");
});

test("shell interpolation with trailing-space string and 2-byte UTF-8", async () => {
  const a = "a ";
  const b = "Í";

  const result = await $`echo ${a} ${b}`.text();
  // "a " (with trailing space preserved) + " " (template separator) + "Í"
  expect(result.trim()).toBe("a  Í");
  expect(result).not.toContain("__bunstr");
});

test("shell interpolation with space and 3-byte UTF-8", async () => {
  const a = " ";
  const b = "€";

  const result = await $`echo ${a} ${b}`.text();
  expect(result.trim()).toBe("€");
  expect(result).not.toContain("__bunstr");
});

test("shell interpolation with embedded space and multi-byte UTF-8", async () => {
  const a = "a b";
  const b = "Í";

  const result = await $`echo ${a} ${b}`.text();
  expect(result.trim()).toBe("a b Í");
  expect(result).not.toContain("__bunstr");
});
