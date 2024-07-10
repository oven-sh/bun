// helper utility for manually running the syntax highlighter on a file
import { readFileSync } from "fs";

// @ts-expect-error
// don't actually use this API!!
const highlighter: (code: string) => string = globalThis[Symbol.for("Bun.lazy")]("unstable_syntaxHighlight");

console.write(highlighter(readFileSync(process.argv[2], "utf8")));
