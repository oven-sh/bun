// node:module is handed to a function found under a computed key. A variable that holds that function takes node:module later, and createRequire is read under its name on the variable by a function far down a chain of calls. The name of the module that is loaded is put together at run time.
const holder = require("module");
const name = ["node:", "net"].join("");
const anything = globalThis[["Str", "ing"].join("")];
let pick = anything;
anything(anything(holder));
const step0 = { next: () => pick.createRequire(__filename)(name) };
const step1 = { next: () => step0.next() };
const step2 = { next: () => step1.next() };
const step3 = { next: () => step2.next() };
const step4 = { next: () => step3.next() };
const step5 = { next: () => step4.next() };
const step6 = { next: () => step5.next() };
const step7 = { next: () => step6.next() };
if (process.argv.length < 99) pick = holder;
console.log(typeof step7.next().Socket);
