// An identifier may be written with escapes: `foo` is `foo`. Here the declaration, the reference, the import, the export, a shorthand property or a member is written that way and its partner is not.
import { plain, escapedExport, \u{62}oth } from "./lib.js";
import * as lib from "./lib.js";

function foo() { return "foo"; }
function bar() { return "bar"; }
const \u{62}az = () => "baz";
class Klass { method() { return "Klass"; } }
function shorthand() { return "shorthand"; }

console.log(foo(), bar(), baz(), new Klass().method());
console.log({ shorthand }.shorthand(), plain(), escapedExport(), both());
console.log(lib.member(), lib["member"] === lib.member);
