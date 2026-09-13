import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join } from "node:path";
import { run, runFixtures, supported } from "./run-fixtures";

// Macros, conditionals, includes, the predefined macros and the corners of the source text.
runFixtures("preprocessor");

describe.skipIf(!supported)("preprocessor: where #include looks", () => {
  const tree = {
    "inc/a.h": '#pragma once\n#include "b.h"\nint a_value = B_VALUE;\n',
    "inc/b.h": "#ifndef B_H\n#define B_H\n#define B_VALUE 40\n#endif\n",
    "sys/chain.h": "#define CHAIN 1\n#include_next <chain.h>\n",
    "sys2/chain.h": "#define CHAIN2 (CHAIN + 1)\n",
    "sys2/stddef.h": "#error the builtin stddef.h must win\n",
    "src/local.h": "#define LOCAL 2\n#include <a.h>\n",
    "inc/bad.h": "\n\nint bad = ;\n",
    "inc/loop.h": '#include "loop.h"\n',
    "inc/where.h": "const char *where = __FILE__; int level = __INCLUDE_LEVEL__;\n",
  };
  // (The compiler's own headers come first, then the system's, then C_INCLUDE_PATH in order.)
  const env = (dir: string) => ({
    ...bunEnv,
    C_INCLUDE_PATH: ["inc", "sys", "sys2"].map(d => join(dir, d)).join(":"),
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
    expect(stdout, stderr).toBe("53\nwhere.h 1\n");
    expect(exitCode).toBe(0);
  });

  const broken: [string, string, string][] = [
    ["an error in a header names the header", "#include <bad.h>\nint main(void) { return 0; }\n", "bad.h:3:11: error: expected an expression before ';'"],
    ["a header that is not there", "int x;\n#include <missing.h>\nint main(void) { return 0; }\n", "main.c:2:2: error: 'missing.h' file not found"],
    ["a header that includes itself", '#include "loop.h"\nint main(void) { return 0; }\n', "#include nested too deeply"],
    ["#include without a name", "#include\nint main(void) { return 0; }\n", "#include expects"],
    ["a token from a macro body is reported where the macro was used", "#define BAD int y = ;\n\n  BAD\nint main(void) { return 0; }\n", "main.c:3:3: error: expected an expression before ';'"],
  ];
  for (const [name, source, message] of broken) {
    test.concurrent(name, async () => {
      using dir = tempDir("bir-include-error", { ...tree, "src/main.c": source });
      const { stdout, stderr, exitCode } = await run(join(String(dir), "src"), ["main.c"], env(String(dir)));
      expect(stderr).toContain(message);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }
});
