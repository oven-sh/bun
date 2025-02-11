import { PGlite } from "@electric-sql/pglite";

describe("pglite", () => {
  it("can initialize successfully", async () => {
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
