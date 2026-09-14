import { cc } from "bun:ffi";
import { resolve } from "node:path";
import * as ours from "./structures-exchanged-with-another-compiler.c";
// As a file, the shapes are not compiled by the import: they are the other compiler's to compile.
import shapes from "./structures-exchanged-with-another-compiler.shapes.c" with { type: "file" };

// The other compiler: TinyCC, which bun:ffi's cc() is.
const theirs = cc({
  source: resolve(import.meta.dir, shapes),
  define: { THEIR_SIDE: "1" },
  symbols: {
    their_table: { args: [], returns: "ptr" },
  },
});
// This side calls into the other with every shape.
const wrong = ours.check_against(theirs.symbols.their_table());
theirs.close();
process.exit(wrong ? 1 : 0);
