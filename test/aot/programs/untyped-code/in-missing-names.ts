// `key in object` where no object of the program has ever had a property of that name, asked over and over with the same string. The answer is remembered, and it follows as soon as the object, or an object it inherits from, gets such a property.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTInByValGeneric") + counted("operationAOTInByValAndCache") : 0;
const join = (...parts: string[]) => parts.join("");
function asks(o: any, k: any): boolean { return k in o; }
function asksWritten(o: any): number { return ("nobodyHasThisOne" in o ? 1 : 0) + ("norThisOne" in o ? 1 : 0); }
const parent: any = JSON.parse('{"inherited":1}');
const child: any = Object.create(parent); child.own = 1;
const plain: any = JSON.parse('{"a":1,"b":2}');
const keys = [join("first", "Unknown"), join("second", "Unknown"), join("third", "Unknown")];
const row = () => [plain, child, parent].map(o => keys.map(k => asks(o, k) ? "1" : "0").join("")).join(" ");
for (let i = 0; i < 4; i++) console.log(row(), asksWritten(plain), asksWritten(child));
const before = entered();
let yes = 0;
for (let i = 0; i < 3000; i++) yes += (asks(plain, keys[i % 3]) ? 1 : 0) + (asks(child, keys[(i + 1) % 3]) ? 1 : 0) + asksWritten(plain) + asksWritten(child);
console.log(yes, counted ? entered() - before < 100 : true);
parent[join("first", "Unknown")] = 1;
console.log(row());
child[join("second", "Unknown")] = 1;
console.log(row());
plain[join("third", "Unknown")] = 1;
console.log(row());
delete parent[keys[0]]; delete child[keys[1]]; delete plain[keys[2]];
console.log(row());
parent[join("nobody", "HasThisOne")] = 1; plain[join("nor", "ThisOne")] = 1;
console.log(asksWritten(plain), asksWritten(child), asksWritten(parent));
Object.setPrototypeOf(child, JSON.parse('{"firstUnknown":1}'));
console.log(row(), asksWritten(child));
let fresh = 0;
for (let i = 0; i < 300; i++) fresh += asks(plain, join("made", "Anew", String(i % 7))) ? 1 : 0;
console.log(fresh);
