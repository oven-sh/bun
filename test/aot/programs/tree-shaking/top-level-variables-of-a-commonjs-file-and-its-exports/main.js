// The constants, classes and functions of these CommonJS files are named only where they are put into exports, each in another way. Beside them stand ones that nothing names.
import direct from "./direct.cjs";
import { named } from "./direct.cjs";
import whole from "./whole.cjs";
import late from "./late.cjs";
import viaThis from "./via-this.cjs";

console.log(direct.constant, direct.Klass.name, direct.list.join(), named);
console.log(whole.constant, whole.nested.inner, new whole.Klass().value());
console.log(late.read(), late.later);
console.log(viaThis.constant, viaThis.computed);
