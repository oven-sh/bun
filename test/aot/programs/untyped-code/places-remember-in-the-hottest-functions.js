// As a user's build compiles it, every function of a small program is among the hottest of its program: a read, a store and a method call by name remember at their place where the property was found. A name that is an accessor of a host class's locked prototype is not remembered: no place could serve a host object.
// CALLS+ readsData GetByIdAndFillSiteCache
// CALLS+ storesData PutByIdAndFillSiteCache
// CALLS+ callsMethod FindMethodByIdAndFillSiteCache
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
