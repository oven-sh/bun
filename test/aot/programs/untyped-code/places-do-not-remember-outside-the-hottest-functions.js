// Most of a large program is not among its hottest functions: there a read, a store and a method call by name go through the shared stub and the table, in ten bytes. places-remember-in-the-hottest-functions.js is the same program as a user's build compiles it.
// CALLS- readsData FillSiteCache
// CALLS- storesData FillSiteCache
// CALLS- callsMethod FillSiteCache
// CALLS- readsHostName FillSiteCache
// CALLS- storesHostName FillSiteCache
const functions = [
  function readsData(o) { return o.alpha; },
  function storesData(o) { o.alpha = 1; return o; },
  function callsMethod(o) { const got = o.method(1); return got + 1; },
  function readsHostName(o) { return o.pathname; },
  function storesHostName(o) { o.pathname = "/"; return o; },
];
const makers = [() => ({ alpha: 0, pathname: "", method(x) { return x + this.alpha; } }), () => ({ pathname: "/", alpha: 2, method(x) { return x - this.alpha; } })];
let text = "";
for (let turn = 0; turn < 4; turn++) for (const each of functions) text += JSON.stringify(each(makers[turn % 2]())) + " ";
console.log(text);
