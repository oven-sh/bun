import { Glob } from "bun";
import { describe, expect, test } from "bun:test";

describe("Glob.match negation", () => {
  test("negation basic", () => {
    const glob = new Glob("!foo");
    expect(glob.match("foo")).toBeFalse();
    expect(glob.match("bar")).toBeTrue();
  });

  test("negation with wildcard", () => {
    const glob = new Glob("!*.ts");
    expect(glob.match("foo.ts")).toBeFalse();
    expect(glob.match("foo.js")).toBeTrue();
  });
});
