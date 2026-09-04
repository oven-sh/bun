/**
 * cmake-lists.ts is how the direct WebKit build (scripts/build/deps/
 * webkit-direct.ts) learns which files to compile: it evaluates WebKit's own
 * CMakeLists.txt with the platform variables the build would have, instead of
 * keeping a copy of ~2,500 paths that drifts on every WebKit bump. If it
 * mis-evaluates a conditional, the wrong platform's sources go into libWTF and
 * the link fails with duplicate or missing symbols — so the subset of CMake it
 * claims to implement is pinned down here.
 */
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

import { cmakeVars, evaluateCMake } from "../../scripts/build/cmake-lists.ts";

function run(
  files: Record<string, string>,
  vars: Record<string, string | string[] | boolean>,
  entry = "CMakeLists.txt",
) {
  const dir = tempDir("cmake-lists", files);
  const v = cmakeVars(vars);
  const unknown: string[] = [];
  evaluateCMake(join(String(dir), entry), v, {
    resolveInclude: (arg, from) => (arg.endsWith(".cmake") ? join(from, "..", arg) : undefined),
    onCommand: name => unknown.push(name),
  });
  return { vars: v, unknown };
}

test("set / list(APPEND|REMOVE_ITEM) / ${} expansion / comments", () => {
  const { vars } = run(
    {
      "CMakeLists.txt": `
        set(DIR "\${ROOT}/wtf") # trailing comment
        set(SRCS
            a.cpp
            b.cpp   # inline
        )
        #[[ bracket
            comment ]]
        list(APPEND SRCS "\${DIR}/c.cpp" d.cpp;e.cpp)
        list(REMOVE_ITEM SRCS b.cpp)
        set(EMPTY)
      `,
    },
    { ROOT: "/r" },
  );
  expect(vars.get("SRCS")).toEqual(["a.cpp", "/r/wtf/c.cpp", "d.cpp", "e.cpp"]);
  expect(vars.has("EMPTY")).toBe(false);
});

test("if / elseif / else with variables, constants, NOT/AND/OR and parentheses", () => {
  const src = `
    set(OUT)
    if (WIN32)
        list(APPEND OUT win)
    elseif (APPLE)
        list(APPEND OUT apple)
    elseif (CMAKE_SYSTEM_NAME MATCHES "Linux")
        list(APPEND OUT linux)
    else ()
        list(APPEND OUT other)
    endif ()
    if (NOT ENABLE_A AND (ENABLE_B OR ENABLE_C))
        list(APPEND OUT combo)
    endif ()
    if (UNDEFINED_THING)
        list(APPEND OUT undefined-was-true)
    endif ()
    if (ON)
        if (0)
            list(APPEND OUT zero-was-true)
        else ()
            list(APPEND OUT nested)
        endif ()
    endif ()
  `;
  expect(
    run(
      { "CMakeLists.txt": src },
      { WIN32: false, APPLE: false, CMAKE_SYSTEM_NAME: "Linux", ENABLE_A: false, ENABLE_B: "OFF", ENABLE_C: "1" },
    ).vars.get("OUT"),
  ).toEqual(["linux", "combo", "nested"]);
  expect(
    run(
      { "CMakeLists.txt": src },
      { WIN32: true, APPLE: false, CMAKE_SYSTEM_NAME: "Windows", ENABLE_A: true, ENABLE_B: true, ENABLE_C: true },
    ).vars.get("OUT"),
  ).toEqual(["win", "nested"]);
  expect(
    run(
      { "CMakeLists.txt": src },
      { WIN32: false, APPLE: false, CMAKE_SYSTEM_NAME: "FreeBSD", ENABLE_A: false, ENABLE_B: false, ENABLE_C: false },
    ).vars.get("OUT"),
  ).toEqual(["other", "nested"]);
});

test("STREQUAL auto-dereferences unquoted variable names; quoted strings are literals", () => {
  const src = `
    set(OUT)
    if (PORT STREQUAL "JSCOnly")
        list(APPEND OUT port)
    endif ()
    if ("\${PORT}" STREQUAL "JSCOnly")
        list(APPEND OUT quoted-expansion)
    endif ()
    if (NOT "\${PORT}" STREQUAL "Cocoa")
        list(APPEND OUT not-cocoa)
    endif ()
    if (\${TYPE} STREQUAL "OBJECT")
        list(APPEND OUT unquoted-expansion)
    endif ()
    if (X_NOTFOUND)
        list(APPEND OUT notfound-was-true)
    endif ()
  `;
  expect(
    run({ "CMakeLists.txt": src }, { PORT: "JSCOnly", TYPE: "STATIC", X_NOTFOUND: "lib-NOTFOUND" }).vars.get("OUT"),
  ).toEqual(["port", "quoted-expansion", "not-cocoa"]);
});

test("foreach, include(), macro/function bodies skipped, unknown commands reported", () => {
  const { vars, unknown } = run(
    {
      "CMakeLists.txt": `
        macro(HELPER _x)
            list(APPEND OUT should-not-run-\${_x})
        endmacro()
        function(helper2)
            list(APPEND OUT nor-this)
        endfunction()
        set(OUT)
        set(NAMES a b)
        foreach (_i \${NAMES})
            list(APPEND OUT item-\${_i})
        endforeach ()
        foreach (_j IN LISTS NAMES)
            list(APPEND OUT list-\${_j})
        endforeach ()
        include(Platform.cmake)
        WEBKIT_FRAMEWORK(WTF)
        add_custom_command(OUTPUT x COMMAND y)
      `,
      "Platform.cmake": `
        if (DEFINED OUT)
            list(APPEND OUT from-include)
        endif ()
      `,
    },
    {},
  );
  expect(vars.get("OUT")).toEqual(["item-a", "item-b", "list-a", "list-b", "from-include"]);
  expect(unknown).toEqual(["webkit_framework", "add_custom_command"]);
});
