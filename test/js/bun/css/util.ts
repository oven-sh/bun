import { describe, expect, test } from "bun:test";
import { cssInternals } from "bun:internal-for-testing";
import dedent from "./dedent";
const {
  minifyTestWithOptions,
  testWithOptions,
  _test,
  prefixTestWithOptions,
  prefixTest,
  minifyTest,
  attrTest: __attrTest,
  minifyErrorTestWithOptions: __minifyErrorTestWithOptions,
} = cssInternals;

export type Browsers = {
  android?: number;
  chrome?: number;
  edge?: number;
  firefox?: number;
  ie?: number;
  ios_saf?: number;
  opera?: number;
  safari?: number;
  samsung?: number;
};

export type ParserOptions = {
  css_modules?: {
    pure: boolean;
  };
  flags?: ParserFlags[];
};

export enum ParserFlags {
  DEEP_SELECTOR_COMBINATOR = "DEEP_SELECTOR_COMBINATOR",
}

export function minify_error_test_with_options(source: string, expectedError: string, options: ParserOptions) {
  test.skip(source, () => {
    let error_string: string | undefined = undefined;
    try {
      __minifyErrorTestWithOptions(source, expectedError, options);
    } catch (err: any) {
      error_string = err.toString();
    }
    expect(error_string).toEqual(expectedError);
  });
}

export function minify_test(source: string, expected: string) {
  test(source, () => {
    expect(minifyTestWithOptions(source, expected)).toEqual(expected);
  });
}

export function prefix_test(source: string, expected: string, targets: Browsers, skip?: boolean) {
  const testf = skip ? test.skip : test;
  testf(source, () => {
    expect(prefixTest(source, expected, targets)).toEqualIgnoringWhitespace(expected);
  });
}

export function css_test(source: string, expected: string, browsers?: Browsers) {
  return cssTest(source, expected, browsers);
}
export function cssTest(source: string, expected: string, browsers?: Browsers, skip?: boolean) {
  const testf = skip ? test.skip : test;
  testf(source, () => {
    const output = _test(source, expected, browsers);
    console.log("Output", output);
    expect(output).toEqualIgnoringWhitespace(expected);
  });
}

export function cssTestTodo(source: string, expected: string, browsers?: Browsers) {
  test.todo(source, () => {
    expect(_test(source, expected, browsers)).toEqualIgnoringWhitespace(expected);
  });
}

export function attrTest(source: string, expected: string, minify: boolean, targets?: Browsers) {
  return __attrTest(source, expected, minify, targets);
}

//
export function indoc(...args: Parameters<typeof dedent>) {
  return dedent(...args);
}

/** Every list of one to `length` of the `atoms`, shorter lists first. */
export function blocks_up_to(atoms: string[], length: number): string[][] {
  const blocks: string[][] = [];
  for (let size = 1, last: string[][] = [[]]; size <= length; size++) {
    last = last.flatMap(block => atoms.map(atom => [...block, atom]));
    blocks.push(...last);
  }
  return blocks;
}

/**
 * Builds the rules of each case with one selector and a rule of another selector between them. Returns the cases where
 * the output changes the declaration that one of these browsers applies: one that reads only `name`, one that reads
 * both names, one that reads only `prefixed`, one for each name in `watch`. A case of one rule also has to keep every
 * written declaration. (Of two rules, Bun removes the first one when the second one sets the same properties.)
 */
export function changed_winners(
  cases: string[][][],
  targets: Browsers,
  { name, prefixed, watch = [] }: { name: string; prefixed: string; watch?: string[] },
): string[] {
  const parse = (declaration: string) => {
    const important = /\s*!important$/.test(declaration);
    const text = declaration.replace(/\s*!important$/, "");
    return {
      name: text.slice(0, text.indexOf(":")).trim(),
      value: text.slice(text.indexOf(":") + 1).trim(),
      important,
    };
  };
  type Declaration = ReturnType<typeof parse>;
  const output = prefixTest(
    cases.map((rules, i) => rules.map(rule => `.r${i}{${rule.join(";")}}`).join(`\n.q${i}{top:0}\n`)).join("\n"),
    "",
    targets,
  );
  const printed = new Map<string, Declaration[]>();
  for (const [, selectors, body] of output.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = body
      .split(";")
      .filter(declaration => declaration.trim())
      .map(parse);
    for (const selector of selectors.split(",")) {
      printed.set(selector.trim(), [...(printed.get(selector.trim()) ?? []), ...declarations]);
    }
  }
  // The declaration that a browser applies: the last `!important` one that it reads, or else the last one.
  // Every browser reads `all`.
  const winner = (declarations: Declaration[], names: string[]) => {
    const read = declarations.filter(declaration => declaration.name === "all" || names.includes(declaration.name));
    return read.findLast(({ important }) => important) ?? read.at(-1);
  };
  const show = (declaration?: Declaration) =>
    declaration && `${declaration.name === "all" ? "all" : declaration.value}${declaration.important ? "!" : ""}`;
  // From each rule, the browser that reads only `prefixed` applies a written prefixed declaration that wins there.
  // Without one, it applies the declaration that wins in that rule for `name`.
  const forPrefixOnly = (rule: Declaration[]) => {
    const written = winner(rule, [prefixed]);
    const applied = written?.name === prefixed ? written : winner(rule, [name]);
    return applied ? [{ ...applied, name: applied.name === "all" ? "all" : prefixed }] : [];
  };
  return cases.flatMap((rules, i) => {
    const source = rules.map(rule => rule.map(parse));
    const out = printed.get(`.r${i}`) ?? [];
    const same =
      [[name], [name, prefixed], ...watch.map(other => [other])].every(
        names => show(winner(out, names)) === show(winner(source.flat(), names)),
      ) &&
      show(winner(out, [prefixed])) === show(winner(source.flatMap(forPrefixOnly), [prefixed])) &&
      (source.length > 1 ||
        source[0].every(written =>
          out.some(
            kept => kept.name === written.name && kept.value === written.value && kept.important === written.important,
          ),
        ));
    return same ? [] : [rules.map(rule => rule.join(";")).join(" | ")];
  });
}

export { minifyTestWithOptions, prefixTest };
