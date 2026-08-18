import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunExe, isLinux } from "harness";

// The css math function parser (src/css/values/calc.rs) takes its identifier
// resolver as a `&dyn Fn` (`ParseIdent`), so the mutually recursive
// parse_sum/parse_product/parse_value are compiled once per value type.
// Threading a generic closure through them again compiles the whole parser once
// per call site instead (61 copies of each function, a few hundred KB of the
// binary) and nothing else notices, so this pins the instance count.
//
// Reads the static symbol table, which the stripped release `bun` does not
// have; debug, asan and bun-profile binaries do.
const nm = isLinux ? Bun.which("nm") || Bun.which("llvm-nm") : null;
const calcSymbols =
  nm === null
    ? []
    : (await $`${nm} -C --defined-only ${bunExe()} | grep 'values::calc::Calc<'`.nothrow().text())
        .split("\n")
        .filter(Boolean);

test.skipIf(calcSymbols.length === 0)("the math function parser is compiled once per value type", () => {
  const instances: Record<string, number> = {};
  for (const line of calcSymbols) {
    // `<address> <type> <demangled name>`; the name itself can contain spaces.
    const name = line.replace(/^\S*\s+\S\s+/, "");
    // A generic method demangles with its type arguments after the name
    // (`::parse_sum::<(), {closure}>`), one symbol per distinct closure.
    const match = /^<bun_css::values::calc::Calc<(.+?)>>::(parse_sum|parse_product|parse_value)(::<.*>)?$/.exec(name);
    if (match === null) continue;
    const [, valueType, method] = match;
    const key = `${method} for Calc<${valueType.replaceAll(/bun_css::values::\w+::/g, "")}>`;
    instances[key] = (instances[key] ?? 0) + 1;
  }

  const methods = new Set(Object.keys(instances).map(key => key.split(" ")[0]));
  expect([...methods].sort()).toEqual(["parse_product", "parse_sum", "parse_value"]);
  expect(instances).toEqual(Object.fromEntries(Object.keys(instances).map(key => [key, 1])));
});
