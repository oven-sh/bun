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
            "PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.72 (437140d149d9c977ffc8b09dbaf9b0f5a02db190), 32-bit",
        },
      ],
      fields: [{ name: "version", dataTypeID: 25 }],
      affectedRows: 0,
    });
  });
});
