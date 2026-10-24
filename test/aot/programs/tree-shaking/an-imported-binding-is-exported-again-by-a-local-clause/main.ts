// middle.ts imports names and exports them with clauses and statements of its own, without `from`.
import defaultOfMiddle, { same, other, held, viaConst } from "./middle";

console.log(same(), other(), defaultOfMiddle(), held.inObject(), viaConst());
