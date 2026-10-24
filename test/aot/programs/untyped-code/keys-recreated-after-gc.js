const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lookups = () => count("operationAOTGetByValGeneric");
const visits = () => lookups() + count("operationAOTGetByVal");

const keys = ["alpha", "beta", "gamma", "missing", "inherited", "computed"];
const read = (object, key) => object[key];
const readAll = object => keys.map(key => String(read(object, key))).join(" ");
const byName = object => [object.alpha, object.beta, object.gamma, object.missing, object.inherited, object.computed].map(String).join(" ");

const grandparent = {};
const parent = Object.setPrototypeOf({ inherited: "from the parent", get computed() { return "computed for " + this.alpha; } }, grandparent);
function make(n) {
    const made = Object.create(parent);
    if (n & 1) made.first = 0;
    if (n & 2) made.second = 0;
    if (n & 4) made.third = 0;
    if (n & 8) made.fourth = 0;
    if (n & 16) made.fifth = 0;
    made.alpha = n;
    made.beta = n + 1;
    made.gamma = n + 2;
    return made;
}
const all = [];
for (let n = 0; n < 32; n++) all.push(make(n));
const agree = label => {
    let same = 0;
    for (const object of all) {
        if (readAll(object) === byName(object)) same++;
    }
    console.log(label + ":", same, "of", all.length, "|", readAll(all[5]));
};

for (let i = 0; i < 20; i++) for (const object of all) byName(object);
agree("known by name first");
collect();
for (let i = 0; i < 60; i++) for (const object of all) readAll(object);
agree("after a collection");

all[5].inherited = "its own";
agree("an own value in front of the parent's");
parent.inherited = "changed in the parent";
agree("the parent's value changes");
parent.missing = "no longer missing";
agree("the parent gains a name");
delete parent.missing;
agree("and loses it again");
grandparent.missing = "in the grandparent";
agree("the grandparent gains it");
delete grandparent.missing;
agree("and loses it");
Object.defineProperty(parent, "computed", { get() { return "another getter for " + this.beta; }, configurable: true });
agree("another getter");
Object.defineProperty(parent, "computed", { value: "a value now", configurable: true, writable: true });
agree("a value in place of the getter");
delete all[5].beta;
agree("an own name deleted");
all[5].beta = "again";
agree("and set again");
Object.setPrototypeOf(all[6], { inherited: "from a new parent" });
console.log("an object given a new parent:", readAll(all[6]), "|", byName(all[6]));
Object.setPrototypeOf(all[6], null);
console.log("and none:", readAll(all[6]), "|", byName(all[6]));
collect();
for (let i = 0; i < 60; i++) for (const object of all) readAll(object);
agree("after one more collection");

const stores = [];
for (let n = 0; n < 32; n++) stores.push(make(n));
const own = ["alpha", "beta", "gamma"];
let total = 0;
const round = () => {
    for (const store of stores) {
        for (const key of own) total += read(store, key);
    }
};
collect();
for (const store of stores) {
    for (const key of Object.keys({ alpha: 0, beta: 0, gamma: 0 })) total += read(store, key);
}
for (let i = 0; i < 400; i++) round();
const before = visits();
round();
const missed = visits() - before;
for (let i = 1; i < 1000; i++) round();
const asked = visits() - before;
console.log("the sum:", total);
console.log("each of the 96 pairs of a structure and a key was looked up at least once:", typeof aotOperationCount !== "function" || lookups() >= 96);
console.log("at least 90 of the 96 pairs are cached after 400 rounds:", typeof aotOperationCount !== "function" || missed <= 6);
console.log("the run time is asked at most 960 times for 96000 reads under 3 keys that come again:", typeof aotOperationCount !== "function" || asked <= 960);
