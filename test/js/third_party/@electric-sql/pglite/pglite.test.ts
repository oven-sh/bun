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
          // since pglite is wasm, there is only one binary for all platforms. it always says
          // wasm32-unknown-emscripten.
          version: expect.stringMatching(/^PostgreSQL \d+\.\d+ \(PGlite [\d.]+\) on wasm32-unknown-emscripten, /),
        },
      ],
      fields: [{ name: "version", dataTypeID: 25 }],
      affectedRows: 0,
      command: "SELECT",
      rowCount: 1,
    });
  });
});
