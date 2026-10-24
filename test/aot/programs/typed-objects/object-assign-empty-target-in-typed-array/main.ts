// An exported constant holds what `Object.assign({}, record, { .. })` returns. Another file reads it through a namespace import and puts it into an array of the record type.
import * as base from "./base";
import type { Rec } from "./base";
const list: Rec[] = [base.B3, base.D3_0];
let sum = 0;
for (const each of list) sum += each.a + each.b + each.n.v;
console.log(JSON.stringify(list), sum);
