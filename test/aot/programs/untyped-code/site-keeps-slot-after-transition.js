// One long-lived object gets properties now and then. A site that reads what it has had from the start sees it under many structures. A new structure costs at most one lookup in the run time for each name, and the reads after that cost none.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
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
const entries = () => count("operationAOTGetById") + count("operationAOTGetByIdAndCache");
const enteredBefore = entries();
// It goes on changing while the sites are in use: 60 structures, four names, 1000 reads of each name under each structure.
for (let i = 0; i < 60; i++) { host["late" + i] = i; for (let k = 0; k < 1000; k++) sum += read(host); }
const entered = entries() - enteredBefore;
console.log(sum, entered < 500 ? "the run time was entered under 500 times" : "the run time was entered " + entered + " times");
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
