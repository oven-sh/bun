// A typed record gets another prototype right after it is created. The record is nobody's prototype, so nothing that is cached about prototype chains changes: untyped code that then calls an inherited method and reads fields that were initialized to `undefined` does not enter the runtime every time.
import { dispatch } from "./record.ts";
const count = globalThis.aotOperationCount ?? (() => 0);
let total = 0;
function handler(r) {
  r.status = 201;
  if (r.later3 === undefined && r.later7 === undefined && r.later11 === undefined && r.message === undefined && r.limit === undefined) total++;
  r.finish();
}
for (let i = 0; i < 100; i++) total += dispatch(handler, "/");
const before = count("operationAOTGetByIdAndCache");
for (let i = 0; i < 20000; i++) total += dispatch(handler, "/");
console.log(total, count("operationAOTGetByIdAndCache") - before < 100);
function late(r) { r.later7 = { seen: true }; r.message = "m"; r.limit = 1.5; total += (r.later7.seen ? 1 : 0) + r.message.length + r.limit + (r.later3 === undefined ? 1 : 0) + Object.keys(r).length; }
dispatch(late, "/");
console.log(total);
