// Which lines can throw is decided function by function, from the types as written. type-rules/throwing-lines-beside-another-file has the same `lines.ts` and one more file that uses its functions in other ways: the lines of `lines.ts` print the same in both programs.
import { run } from "./lines";
run(JSON.parse('{"x":"1","y":2}'), "text");
