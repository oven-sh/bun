const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const operations = [
    "operationAOTGetByValGeneric", "operationAOTInByValGeneric", "operationAOTPutByValGeneric",
    "operationAOTGetByValAndCache", "operationAOTInByValAndCache", "operationAOTPutByValAndCache", "operationAOTPutByValAndCacheSloppy",
    "operationAOTDeleteByVal", "operationAOTDeleteByValSloppy",
];
const visits = () => operations.reduce((sum, operation) => sum + count(operation), 0);

const log = [];
const handler = {
    get(target, key, receiver) { if (typeof key === "symbol") return target[key]; return key in target ? target[key] : "no " + key; },
    has(target, key) { return key in target; },
    set(target, key, value) { target[key] = value; return true; },
    deleteProperty(target, key) { log.push("delete " + key); return delete target[key]; },
    getOwnPropertyDescriptor(target, key) { log.push("describe " + typeof key); return Reflect.getOwnPropertyDescriptor(target, key); },
    defineProperty(target, key, descriptor) { log.push("define " + key); return Reflect.defineProperty(target, key, descriptor); },
};
const make = n => new Proxy({ alpha: n, beta: n + 1, gamma: n + 2 }, handler);

const one = make(1);
console.log("by name:", one.alpha, one.beta, one.gamma, one.missing);
const names = ["alpha", "beta", "gamma", "missing"];
console.log("by key:", names.map(name => one[name]).join());
console.log("in:", "alpha" in one, "missing" in one, names.map(name => name in one).join());
one.alpha = 10; one.added = 11; one[names[1]] = 12;
console.log("stored:", one.alpha, one.added, one.beta, Object.keys(one).join());
console.log("deleted:", delete one.added, delete one[names[2]], Object.keys(one).join());
Object.defineProperty(one, "defined", { value: 5, configurable: true, enumerable: true, writable: true });
console.log("defined:", one.defined, JSON.stringify(Object.getOwnPropertyDescriptor(one, "defined")), Object.hasOwn(one, "alpha"), log.join(" | "));

const kinds = [];
const curious = new Proxy({}, { get(target, key) { kinds.push(typeof key + ":" + String(key) + ":" + (typeof key === "string" ? key.length : "")); return key; } });
const sameText = curious.alpha === "alpha" && curious["al" + "pha"] === "alpha" && curious.alpha === curious.alpha;
console.log("what the trap is given:", sameText, curious[Symbol.iterator] === Symbol.iterator, curious[7], curious["7"], curious[""], curious.a, curious["é中"], kinds.join(" "));
const held = [];
const keeper = new Proxy({}, { get(target, key) { held.push(key); return 1; } });
for (let i = 0; i < 6; i++) { keeper.alpha; keeper.beta; if (i % 2) collect(); }
collect();
console.log("keys kept across collections:", held.join());
const changed = new Proxy({}, { get(target, key) { return key + "!"; } });
console.log("a key put together with more:", changed.alpha, changed.alpha, changed.beta);

const many = new Proxy({}, { get(target, key) { return key.length; } });
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += many["name" + i] + many["name" + (i % 7)];
console.log("hundreds of names:", lengths);

let total = 0;
const proxies = [make(1), make(2), new Proxy({ beta: 1, alpha: 2 }, handler)];
const round = () => {
    for (const proxy of proxies) {
        total += proxy.alpha + proxy.beta;
        if (proxy.missing !== "no missing") total += 1000000;
        proxy.alpha = total & 7;
    }
};
for (let i = 0; i < 300; i++) round();
const before = visits();
for (let i = 0; i < 2000; i++) round();
const visited = visits() - before;
console.log("the sum:", total);
console.log("the run time is asked at most 300 times under the keys of 24000 traps:", typeof aotOperationCount !== "function" || visited <= 300);
