// What `Object.assign({}, record, { .. })` returns stands in an array literal beside a spread copy of the record.
import * as base from "./base";
const copy = { ...base.B3 };
const list = [base.D3_0, copy];
console.log(JSON.stringify(list));
