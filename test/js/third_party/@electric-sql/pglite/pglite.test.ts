import { PGlite } from "@electric-sql/pglite";
import { isCI, isLinux } from "harness";

describe("pglite", () => {
  // TODO(@190n) linux-x64 sometimes fails due to JavaScriptCore bug
  // https://github.com/oven-sh/bun/issues/17841#issuecomment-2695792567
  // https://bugs.webkit.org/show_bug.cgi?id=289009
  it.todoIf(isCI && isLinux && process.arch == "x64")("can initialize successfully", async () => {
    const db = new PGlite();
    expect(await db.query("SELECT version()")).toEqual({
      rows: [
        {
          version:
            // since pglite is wasm, there is only one binary for all platforms. it always thinks it
            // is x86_64-pc-linux-gnu.
            "PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.74 (1092ec30a3fb1d46b1782ff1b4db5094d3d06ae5), 32-bit",
        },
      ],
      fields: [{ name: "version", dataTypeID: 25 }],
      affectedRows: 0,
    });
  });
});
