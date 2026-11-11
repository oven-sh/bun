/**
 * scripts/build/cmake.ts: reading the file lists out of a project's CMake files without running cmake, which is how a
 * local WebKit checkout tells the build what to compile (scripts/build/deps/webkit.ts).
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

import { evaluateCMake, parseCMake } from "../../scripts/build/cmake.ts";

const parse = (src: string) => parseCMake(src, "test.cmake");
const texts = (src: string) => parse(src).map(i => [i.name, ...i.args.map(a => `${a.kind[0]}:${a.text}`)]);

describe("parseCMake", () => {
  test("unquoted, quoted and bracket arguments", () => {
    expect(texts(`set(A b "c d" [=[e]f]=] g;h)`)).toEqual([["set", "u:A", "u:b", "q:c d", "b:e]f", "u:g;h"]]);
  });

  test("escapes, line continuation, embedded quotes, $(VAR)", () => {
    expect(texts('x(a\\ b "1\\n2" "tab\\t" "no\\\nbreak" -DX="a b" $(MAKE) a\\;b)')).toEqual([
      ["x", "u:a b", "q:1\n2", "q:tab\t", "q:nobreak", 'u:-DX="a b"', "u:$(MAKE)", "u:a\\;b"],
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
    const [inv] = parse("SET(X ${Y} ${A_${B}})");
    expect(inv!.name).toBe("set");
    expect(inv!.args.map(a => a.text)).toEqual(["X", "${Y}", "${A_${B}}"]);
  });

  test("errors carry file:line", () => {
    expect(() => parse("set(A\n")).toThrow(/test.cmake:2: unterminated argument list of set/);
    expect(() => parse('set(A "x)\n')).toThrow(/unterminated quoted/);
    expect(() => parse("set A")).toThrow(/expected '\(' after set/);
  });
});

describe("evaluateCMake", () => {
  /** Evaluates the `CMakeLists.txt` among `files`: the variable `L` as a list, and the files read. */
  function evaluate(files: Record<string, string>, variables: Record<string, string> = {}) {
    using dir = tempDir("build-cmake-lists", files);
    const result = evaluateCMake(join(String(dir), "CMakeLists.txt"), {
      variables,
      includeMacros: { project_include_platform_file: "Platform.cmake" },
    });
    return { L: result.list("L"), files: result.files.map(f => f.slice(String(dir).length + 1).replaceAll("\\", "/")) };
  }
  const listOf = (src: string, variables?: Record<string, string>) => evaluate({ "CMakeLists.txt": src }, variables).L;

  test("set, list(APPEND), list(REMOVE_ITEM), unset", () => {
    expect(listOf(`set(L a.cpp b.cpp)\nlist(APPEND L c.cpp d.cpp)\nlist(REMOVE_ITEM L b.cpp)`)).toEqual([
      "a.cpp",
      "c.cpp",
      "d.cpp",
    ]);
    expect(listOf(`list(APPEND L a)`)).toEqual(["a"]);
    expect(listOf(`set(L a)\nunset(L)`)).toEqual([]);
    expect(listOf(`set(L a)\nset(L)`)).toEqual([]);
    expect(listOf(`set(L "")\nlist(APPEND L a)`)).toEqual(["a"]);
  });

  test("references expand, an unquoted list becomes several arguments, an unset variable is empty", () => {
    expect(
      listOf('set(A 1 2)\nset(L ${DIR}/x.h ${A} "${A}" ${NOPE} ${${NAME}_TAIL})', {
        DIR: "/src",
        NAME: "X",
        X_TAIL: "t",
      }),
    ).toEqual(["/src/x.h", "1", "2", "1", "2", "t"]);
  });

  test("takes the branch cmake would", () => {
    const src = `
      if (WIN32)
          list(APPEND L win)
      elseif (APPLE)
          list(APPEND L mac)
      elseif (CMAKE_SYSTEM_NAME MATCHES "Linux")
          list(APPEND L linux)
          if (ANDROID)
              list(APPEND L android)
          else ()
              list(APPEND L glibc)
          endif ()
      else ()
          list(APPEND L other)
      endif ()`;
    expect(listOf(src, { WIN32: "ON", APPLE: "ON" })).toEqual(["win"]);
    expect(listOf(src, { APPLE: "1" })).toEqual(["mac"]);
    expect(listOf(src, { CMAKE_SYSTEM_NAME: "Linux" })).toEqual(["linux", "glibc"]);
    expect(listOf(src, { CMAKE_SYSTEM_NAME: "Linux", ANDROID: "ON" })).toEqual(["linux", "android"]);
    expect(listOf(src, { CMAKE_SYSTEM_NAME: "FreeBSD" })).toEqual(["other"]);
  });

  test.each([
    ["A", { A: "ON" }, true],
    ["A", { A: "0" }, false],
    ["A", { A: "OFF" }, false],
    ["A", { A: "x-NOTFOUND" }, false],
    ["A", { A: "anything" }, true],
    ["A", {}, false],
    ["true", {}, true],
    ["NOT A", {}, true],
    ["NOT A AND NOT B", { B: "1" }, false],
    ["A OR B AND C", { A: "1" }, true],
    ["(A OR B) AND C", { A: "1" }, false],
    ["A AND (B OR C)", { A: "1", C: "1" }, true],
    ['A STREQUAL "bun"', { A: "bun" }, true],
    ['A STREQUAL "bun"', { A: "glib" }, false],
    ['NOT "${A}" STREQUAL "Cocoa"', { A: "JSCOnly" }, true],
    ["${A} STREQUAL B", { A: "x", B: "x" }, true],
    ["DEFINED A", { A: "0" }, true],
    ["DEFINED A", {}, false],
    ["TARGET Some_Target", {}, false],
  ] as Array<[string, Record<string, string>, boolean]>)("if (%s) with %o", (condition, variables, expected) => {
    expect(listOf(`if (${condition})\nset(L yes)\nendif ()`, variables)).toEqual(expected ? ["yes"] : []);
  });

  test("a condition it does not implement is an error where it is reached, and only there", () => {
    const src = `if (GNU)\nif (V VERSION_LESS 14)\nset(L a)\nendif ()\nendif ()\nset(L b)`;
    expect(listOf(src)).toEqual(["b"]);
    expect(() => listOf(src, { GNU: "1" })).toThrow(/CMakeLists.txt:2: cannot evaluate if\(V VERSION_LESS 14\)/);
  });

  test("loops and definitions are skipped whole; other commands are ignored", () => {
    expect(
      listOf(`
        macro(ADD _x)
            list(APPEND L in-macro)
        endmacro()
        function(F)
            foreach (i 1 2)
                list(APPEND L nested)
            endforeach ()
        endfunction()
        foreach (f a b)
            list(APPEND L in-loop)
        endforeach ()
        ADD(1)
        add_custom_command(OUTPUT x COMMAND y)
        list(APPEND L kept)`),
    ).toEqual(["kept"]);
  });

  test("follows include() of a file beside it and the project's include macros, and reports every file read", () => {
    const run = evaluate({
      "CMakeLists.txt": `set(L a)\ninclude(sub/More.cmake)\ninclude(SomeCMakeModule)\nPROJECT_INCLUDE_PLATFORM_FILE()\nlist(APPEND L z)`,
      "sub/More.cmake": `list(APPEND L more)`,
      "Platform.cmake": `list(APPEND L platform)`,
    });
    expect(run.L).toEqual(["a", "more", "platform", "z"]);
    expect(run.files).toEqual(["CMakeLists.txt", "sub/More.cmake", "Platform.cmake"]);
  });

  test("unbalanced blocks are errors", () => {
    expect(() => listOf("if (A)\nset(L a)")).toThrow(/if\(\) without endif\(\)/);
    expect(() => listOf("endif ()")).toThrow(/stray endif/);
    expect(() => listOf("foreach (x a)\n")).toThrow(/foreach\(\) without endforeach\(\)/);
  });
});
