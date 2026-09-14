import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join, sep } from "node:path";
import { includePath, lines, run, runFixtures, supported } from "./run-fixtures";

// Macros, conditionals, includes, the predefined macros and the corners of the source text.
runFixtures("preprocessor");

describe.skipIf(!supported)("preprocessor: where #include looks", () => {
  const tree = {
    "inc/a.h": '#pragma once\n#include "b.h"\nint a_value = B_VALUE;\n',
    "inc/b.h": "#ifndef B_H\n#define B_H\n#define B_VALUE 40\n#endif\n",
    "sys/chain.h": "#define CHAIN 1\n#include_next <chain.h>\n",
    "sys2/chain.h": "#define CHAIN2 (CHAIN + 1)\n",
    // The compiler's own <stddef.h> is the one found. For Microsoft C it only adds to the one the search path has
    // (cl has no headers of its own, only INCLUDE), and this directory is on the path ahead of Visual Studio's.
    "sys2/stddef.h":
      "#ifndef _MSC_VER\n#error the builtin stddef.h must win\n#endif\n#define FOUND_ON_THE_SEARCH_PATH 1\n#include_next <stddef.h>\n",
    "src/local.h": "#define LOCAL 2\n#include <a.h>\n",
    "inc/bad.h": "\n\nint bad = ;\n",
    "inc/loop.h": '#include "loop.h"\n',
    "inc/where.h": "const char *where = __FILE__; int level = __INCLUDE_LEVEL__;\n",
  };
  // (The compiler's own headers come first, then C_INCLUDE_PATH in order, then the system's, as with gcc and clang.)
  const env = (dir: string) => ({
    ...bunEnv,
    C_INCLUDE_PATH: includePath(...["inc", "sys", "sys2"].map(d => join(dir, d))),
  });

  test.concurrent("quoted and angled forms, #include_next, macros that name a header, __has_include", async () => {
    using dir = tempDir("bir-include-search", {
      ...tree,
      "src/main.c": `#include "local.h"
#include <a.h>
#include "a.h"
#include <chain.h>
#include <stddef.h>
#include <limits.h>
#include <where.h>
#define HEADER <b.h>
#include HEADER
#define QUOTED "b.h"
#include QUOTED
int printf(const char *, ...);
#if defined(_MSC_VER) != defined(FOUND_ON_THE_SEARCH_PATH)
#error which <stddef.h> is found
#endif
#if __has_include(<chain.h>) && __has_include("local.h") && !__has_include(<local.h>) && __has_include_next(<limits.h>)
int total(void) { return a_value + LOCAL + CHAIN2 + (INT_MAX == 2147483647) + (int)sizeof(size_t); }
#endif
int main(void) {
  printf("%d\\n", total());
  const char *tail = where;
  for (const char *p = where; *p; p++) if (*p == '/') tail = p + 1;
  printf("%s %d\\n", tail, level);
  return 0;
}
`,
    });
    const { stdout, stderr, exitCode } = await run(join(String(dir), "src"), ["main.c"], env(String(dir)));
    expect(lines(stdout), stderr).toBe("53\nwhere.h 1\n");
    expect(exitCode).toBe(0);
  });

  const broken: [string, string, string][] = [
    [
      "an error in a header names the header",
      "#include <bad.h>\nint main(void) { return 0; }\n",
      "error: expected an expression before ';'\n    at inc/bad.h:3:11\n\n1 | #include <bad.h>\n     ^\nnote: included from here\n   at src/main.c:1:2\n",
    ],
    [
      "a header that is not there",
      "int x;\n#include <missing.h>\nint main(void) { return 0; }\n",
      "error: 'missing.h' file not found\n    at src/main.c:2:2\n",
    ],
    [
      "a header that includes itself",
      '#include "loop.h"\nint main(void) { return 0; }\n',
      "#include is nested too deeply",
    ],
    ["#include without a name", "#include\nint main(void) { return 0; }\n", "#include expects"],
    [
      "a token from a macro body is reported where the macro was used",
      "#define BAD int y = ;\n\n  BAD\nint main(void) { return 0; }\n",
      "error: expected an expression before ';'\n    at src/main.c:3:3\n",
    ],
  ];
  for (const [name, source, message] of broken) {
    test.concurrent(name, async () => {
      using dir = tempDir("bir-include-error", { ...tree, "src/main.c": source });
      const { stdout, stderr, exitCode } = await run(join(String(dir), "src"), ["main.c"], env(String(dir)));
      expect(
        lines(stderr)
          .replaceAll(String(dir) + sep, "")
          .replaceAll("\\", "/"),
      ).toContain(message);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }
});
