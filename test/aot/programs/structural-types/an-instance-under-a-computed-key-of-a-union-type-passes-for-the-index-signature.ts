// `{ [key]: dog }` under `Record<string, Barks>`: the member is converted to the type of the index signature also where the type of the key is a union of strings, so a class whose method lies in its prototype passes for the interface at a read out of the dictionary.
// IRT= 0 barkIn testedType=undefined.null.object
interface Barks { barkLoudly(): number }
class Dog { weight = 3; barkLoudly() { return this.weight + 1; } }
function byUnionKey(key: "a" | "b", dog: Dog): Record<string, Barks> { return { [key]: dog }; }
function barkIn(barkers: Record<string, Barks>, key: string) { return barkers[key].barkLoudly(); }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
try { console.log(barkIn(stranger, "a")); } catch { console.log("threw"); }
const barkers = byUnionKey("a", new Dog());
let sum = 0;
for (let i = 0; i < 6000; i++) sum += barkIn(barkers, "a");
console.log(sum, Object.keys(barkers).join());
