import { describe, expect, test } from "bun:test";
import { parseCMake, renderArg, renderInvocation, variableReferences } from "../../scripts/build/cmake.ts";

const parse = (src: string) => parseCMake(src, "test.cmake");
const texts = (src: string) => parse(src).map(i => [i.name, ...i.args.map(a => `${a.kind[0]}:${a.text}`)]);

describe("cmake parser", () => {
  test("unquoted, quoted and bracket arguments", () => {
    expect(texts(`set(A b "c d" [=[e]f]=] g;h)`)).toEqual([["set", "u:A", "u:b", "q:c d", "b:e]f", "u:g;h"]]);
  });

  test("escapes, line continuation, embedded quotes, $(VAR)", () => {
    expect(texts('x(a\\ b "1\\n2" "tab\\t" "no\\\nbreak" -DX="a b" $(MAKE) a\;b)')).toEqual([
      ["x", "u:a b", "q:1\n2", "q:tab\t", "q:nobreak", 'u:-DX="a b"', "u:$(MAKE)", "u:a\;b"],
    ]);
  });

  test("comments: line, bracket, inside argument lists", () => {
    const src = `# c1\n#[[ multi\nline ]] set(A #[==[inline]==] 1 # trailing\n  2)\n`;
    expect(texts(src)).toEqual([["set", "u:A", "u:1", "u:2"]]);
    expect(parse(src)[0]!.line).toBe(3);
  });

  test("nested parentheses stay as tokens", () => {
    expect(texts(`check(A AND (B OR C))`)).toEqual([["check", "u:A", "u:AND", "u:(", "u:B", "u:OR", "u:C", "u:)"]]);
  });

  test("command names are case-insensitive; variable refs are not expanded", () => {
    const [inv] = parse("SET(X \${Y} $ENV{Z} \${A_\${B}})");
    expect(inv!.name).toBe("set");
    expect(inv!.args.map(a => a.text)).toEqual(["X", "${Y}", "$ENV{Z}", "${A_${B}}"]);
    expect(inv!.args.flatMap(variableReferences)).toEqual(["Y", "Z", "A_", "B"]);
  });

  test("context: if/elseif/else, foreach, macro nesting", () => {
    const src = `
      macro(GEN _in _out)
        if(WIN32)
          add_custom_command(OUTPUT \${_out} COMMAND a)
        elseif(APPLE)
          foreach(f \${L})
            add_custom_command(OUTPUT \${f} COMMAND b)
          endforeach()
        else()
          add_custom_command(OUTPUT x COMMAND c)
        endif()
      endmacro()
      GEN(1 2)`;
    const cmds = parse(src).filter(i => i.name === "add_custom_command" || i.name === "gen");
    expect(cmds.map(i => i.context)).toEqual([
      ["macro(GEN _in _out)", "if(WIN32)"],
      ["macro(GEN _in _out)", "elseif(APPLE) # if(WIN32)", "foreach(f ${L})"],
      ["macro(GEN _in _out)", "else() # if(WIN32)"],
      [],
    ]);
  });

  test("errors carry file:line", () => {
    expect(() => parse("set(A\n")).toThrow(/test.cmake:2: unterminated argument list of set/);
    expect(() => parse('set(A "x)\n')).toThrow(/unterminated quoted/);
    expect(() => parse("if(A)\nset(B)\n")).toThrow(/unterminated block: if\(A\)/);
    expect(() => parse("endif()")).toThrow(/stray endif/);
    expect(() => parse("set A")).toThrow(/expected '\(' after set/);
  });

  test("rendering is canonical and re-parseable", () => {
    const src = `add_custom_command(OUTPUT  a   b\n  COMMAND "x y" [[z]] VERBATIM)`;
    const [inv] = parse(src);
    const rendered = renderInvocation(inv!, new Set(["OUTPUT", "COMMAND", "VERBATIM"]));
    expect(rendered).toBe('add_custom_command(\n    OUTPUT a b\n    COMMAND "x y" [[z]]\n    VERBATIM\n)');
    expect(texts(rendered)).toEqual(texts(src));
    expect(renderArg({ kind: "quoted", text: 'a"b\\' })).toBe('"a\\"b\\\\"');
    expect(renderArg({ kind: "bracket", text: "has ]] inside" })).toBe("[=[has ]] inside]=]");
  });
});
