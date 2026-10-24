// What a program stores on `process` under a name that native code never looks up stays in the program. The table lists the names that are looked up, and the sources say which those are.
import { expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const root = join(import.meta.dir, "..", "..");
const bindings = join(root, "src", "jsc", "bindings");

function listedNames(): string[] {
  const table = readFileSync(join(root, "src", "codegen", "builtins", "host", "process.builtins.ts"), "utf8");
  const list = /const lookedUpByNativeCode = \[([^\]]*)\]/.exec(table);
  expect(list).not.toBeNull();
  return Array.from(list![1].matchAll(/"([^"]+)"/g), match => match[1]);
}

type Lookup = { where: string; name: string | undefined };

function lookupsIn(file: string): Lookup[] {
  const text = readFileSync(join(bindings, file), "utf8");
  const receiver =
    file === "BunProcess.cpp"
      ? String.raw`(?:(?:\bprocess|processObject\(\)|\bthis)->|\breturn )`
      : String.raw`(?:\bprocess|processObject\(\))->`;
  const lookup = new RegExp(
    String.raw`${receiver}(?:get|getIfPropertyExists)\(\w+, (?:Identifier::fromString\((?:vm|\w+->vm\(\)), "([^"]+)"_s\)|(\w+))\)`,
    "g",
  );
  return Array.from(text.matchAll(lookup), match => {
    const line = text.slice(0, match.index).split("\n").length;
    const variable =
      match[2] && new RegExp(String.raw`\b${match[2]} = Identifier::fromString\(vm, "([^"]+)"_s\)`).exec(text);
    return { where: `${file}:${line}`, name: match[1] ?? (variable ? variable[1] : undefined) };
  });
}

test("the table lists every name that native code looks up on process", () => {
  const sources = (readdirSync(bindings, { recursive: true }) as string[]).filter(file => /\.(cpp|h)$/.test(file));
  const lookups = sources.flatMap(lookupsIn);
  expect(lookups.length).toBeGreaterThan(8);
  expect(lookups.filter(lookup => lookup.name === undefined)).toEqual([]);

  const listed = listedNames();
  expect(lookups.filter(lookup => !listed.includes(lookup.name!))).toEqual([]);
  const lookedUp = new Set(lookups.map(lookup => lookup.name));
  expect(listed.filter(name => !lookedUp.has(name))).toEqual([]);
});
