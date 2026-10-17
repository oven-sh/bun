// One long-lived object gets properties now and then. A site that reads what it has had from the start sees it under many structures, and keeps one slot.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const counts = typeof aotOperationCount === "function";
const count = counts ? aotOperationCount : () => 0;
function Host() { for (let i = 0; i < 30; i++) this["early" + i] = i; this.settings = { mode: "quiet" }; this.depth = 1; }
Host.prototype.describe = function () { return this.settings.mode + this.depth; };
const host = new Host();
// Kept outside the object; inherited; absent.
function settings(o) { return o.settings; }
function depth(o) { return o.depth; }
function describe(o) { return o.describe; }
function missing(o) { return o.missing; }
const read = o => settings(o).mode.length + depth(o) + describe(o).call(o).length + (missing(o) === undefined ? 1 : 0);
let sum = 0;
for (let k = 0; k < 100; k++) sum += read(host);
const movedBefore = count("cacheGetById:moved-on"), enteredBefore = count("operationAOTGetById");
// It goes on changing while the sites are in use.
for (let i = 0; i < 60; i++) { host["late" + i] = i; for (let k = 0; k < 1000; k++) sum += read(host); }
const moved = count("cacheGetById:moved-on") - movedBefore, entered = count("operationAOTGetById") - enteredBefore;
console.log(sum, !counts || moved >= 200 || count("operationAOTGetByNameAndCache") ? "the sites moved on with the object" : "the sites moved on " + moved + " times", entered < 500 ? "and the operation was entered under 500 times" : "and the operation was entered " + entered + " times");
// Others of its kind at an earlier stage arrive at the same sites: both are served.
const young = new Host();
for (let k = 0; k < 200; k++) sum += read(host) + read(young);
young.depth = 5; host.depth = 7;
console.log(sum, read(young), read(host));
// What was true of the earlier structure is not assumed of the later one.
const other = new Host();
for (let k = 0; k < 50; k++) sum += read(other);
other.missing = "now here";
Object.defineProperty(other, "describe", { value() { return "own"; } });
console.log(read(other), missing(other), describe(other).call(other), missing(host), describe(host).call(host));
delete other.depth;
console.log(depth(other), depth(host), depth(young));
