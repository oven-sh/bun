import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

// `JSValue::for_each` runs the iteration protocol: `Symbol.iterator`, `next`
// and `return`. On a Map or Set iterator that the program holds, it uses the
// iterator up and runs what a script put on it. A printer must not do that:
// `console.log(it)` left `it` done.
//
// `formatter::for_each_listed` is the door for a printer. It reads a Map or
// Set iterator from its collection and hands every other value to
// `JSValue::for_each`.
//
//   value.for_each(global, ctx, callback)   → formatter::for_each_listed(value, global, ctx, callback)

const root = path.resolve(import.meta.dir, "..", "..", "..");

const PRINTERS = ["src/jsc/ConsoleObject.rs", "src/jsc/VirtualMachine.rs"];

// The door, and the two walks of a Map or a Set itself: each of those makes an
// iterator of its own, which nobody else holds.
const ALLOWED = new Set(["for_each_listed", "print_map_like", "print_set"]);

// A call with a closure is `Iterator::for_each`, not `JSValue::for_each`.
const jsValueForEach = /\.for_each\((?!\s*(?:\||move\b))|JSValue::for_each\(/;
const functionStart = /^\s*(?:pub(?:\([a-z]+\))?\s+)?(?:unsafe\s+)?(?:extern\s+"C"\s+)?fn\s+(\w+)/;

test("a printer walks a value through formatter::for_each_listed", () => {
  const found: string[] = [];
  for (const file of PRINTERS) {
    let enclosing = "";
    readFileSync(path.join(root, file), "utf8")
      .split("\n")
      .forEach((line, index) => {
        enclosing = functionStart.exec(line)?.[1] ?? enclosing;
        if (line.trimStart().startsWith("//")) return;
        if (jsValueForEach.test(line) && !ALLOWED.has(enclosing)) {
          found.push(`${file}:${index + 1}: ${enclosing} calls JSValue::for_each: use formatter::for_each_listed`);
        }
      });
  }
  expect(found).toEqual([]);
});
