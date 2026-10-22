// tsconfig.json turns unused locals into errors. Each constant, class and enum here is used, but only by an exported declaration that nobody imports and that is left out. A build that does not look at what it leaves out must not call them unused.
import { helper } from "./lib";

const inner = 1;
const list = [inner];
class Base {}
enum Kind { A }
const arrow = () => helper();
export const unusedExport = { list, Base, kind: Kind.A, arrow };
export class UnusedClass extends Base { static kind = Kind.A; }

console.log("built and ran");
