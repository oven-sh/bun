import { isArchitectureMatch, isOperatingSystemMatch } from "bun:internal-for-testing";
import "harness";

import { describe, expect, test } from "bun:test";

describe("isArchitectureMatch", () => {
  const trues = [
    ["wombo.com", "any"],
    ["wombo.com", process.arch],
    [],
    ["any"],
    ["any", process.arch],
    [process.arch],
    ["!ia32"],
    ["!ia32", process.arch],
    ["ia32", process.arch],
    ["!mips", "!ia32"],
  ];
  const falses = [
    ["wombo.com"],
    ["ia32"],
    ["any", "!" + process.arch],
    ["!" + process.arch],
    ["!ia32", "!" + process.arch],
    ["!" + process.arch, process.arch],
  ];
  for (let arch of trues) {
    test(`${arch} === true`, () => {
      expect(isArchitectureMatch(arch)).toBe(true);
    });
  }
  for (let arch of falses) {
    test(`${arch} === false`, () => {
      expect(isArchitectureMatch(arch)).toBe(false);
    });
  }
});

describe("isOperatingSystemMatch", () => {
  const trues = [
    [],
    ["any"],
    ["any", process.platform],
    [process.platform],
    ["!sunos"],
    ["!sunos", process.platform],
    ["sunos", process.platform],
    ["!aix", "!sunos"],
    ["wombo.com", "!aix"],
  ];
  const falses = [
    ["aix"],
    ["any", "!" + process.platform],
    ["!" + process.platform],
    ["!sunos", "!" + process.platform],
    ["!" + process.platform, process.platform],
  ];
  for (let os of trues) {
    test(`${os} === true`, () => {
      expect(isOperatingSystemMatch(os)).toBe(true);
    });
  }
  for (let os of falses) {
    test(`${os} === false`, () => {
      expect(isOperatingSystemMatch(os)).toBe(false);
    });
  }
});
