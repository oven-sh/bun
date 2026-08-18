import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, isLinux } from "harness";

// The css math function parser (src/css/values/calc.rs) takes its identifier
// resolver as a `&dyn Fn` (`ParseIdent`), so the mutually recursive
// parse_sum/parse_product/parse_value are compiled once per value type.
// Threading a generic closure through them again compiles the whole parser once
// per call site instead (61 copies of each function, a few hundred KB of the
// binary) and nothing else notices, so this pins the instance count.
//
// Reads the symbol table, which only the unstripped debug and asan binaries
// have; the release `bun` is stripped.
test.skipIf(!isLinux || !(isDebug || isASAN))("the math function parser is compiled once per value type", async () => {
  const nm = Bun.which("nm") || Bun.which("llvm-nm");
  if (!nm) {
    throw new Error("nm executable not found. Please install binutils or llvm.");
  }

  // grep exits 1 when nothing matches; that case fails the assertions below.
  const symbols = await $`${nm} -C --defined-only ${bunExe()} | grep 'values::calc::Calc<'`.nothrow().text();

  const instances: Record<string, Record<string, number>> = {};
  for (const line of symbols.split("\n")) {
    // `<address> <type> <demangled name>`; the name itself can contain spaces.
    const name = line.replace(/^\S*\s+\S\s+/, "");
    // A generic method demangles with its type arguments after the name
    // (`::parse_sum::<(), {closure}>`), one symbol per distinct closure.
    const match = /^<bun_css::values::calc::Calc<(.+?)>>::(parse_sum|parse_product|parse_value)(::<.*>)?$/.exec(name);
    if (match === null) continue;
    const valueType = match[1].replaceAll(/bun_css::values::\w+::/g, "");
    const methods = (instances[valueType] ??= {});
    methods[match[2]] = (methods[match[2]] ?? 0) + 1;
  }

  expect(Object.keys(instances)).toContain("f32");
  expect(instances).toEqual(
    Object.fromEntries(
      Object.keys(instances).map(valueType => [valueType, { parse_sum: 1, parse_product: 1, parse_value: 1 }]),
    ),
  );
});
