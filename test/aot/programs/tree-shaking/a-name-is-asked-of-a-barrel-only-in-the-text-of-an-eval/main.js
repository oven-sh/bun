// The file imports two names and a namespace from the barrel of a pure package and names them only in text that it gives to eval. What the text will name nobody knows, so the imports count as used, and the namespace as used whole. `bun run` also evaluates never-imported.js; an executable of `bun build --compile` fails, because the bundler has renamed what the text names (ReferenceError: first is not defined). So the output is stored.
import { first, second } from "evaluated";
import * as whole from "evaluated/other.js";

console.log(eval("first()"), eval("sec" + "ond()"), eval("whole.third()"));
