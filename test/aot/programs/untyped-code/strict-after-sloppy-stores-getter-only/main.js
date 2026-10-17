// A store to an accessor without a setter is ignored in sloppy code and a TypeError in strict code, whichever of the two has stored first.
import storeSloppily from "./sloppy.cjs";
const lines = [];
function storeStrictly(object, value) { object.value = value; return object; }
function attempt(label, action) { try { lines.push(label + " " + String(action())); } catch (error) { lines.push(label + " THROWN " + (error instanceof TypeError ? "TypeError" : String(error))); } }
const inherited = Object.create({ get value() { return 7; } });
for (let i = 0; i < 40; i++) attempt("inherited, sloppy " + i, () => storeSloppily(inherited, i).value);
for (let i = 0; i < 6; i++) attempt("inherited, strict " + i, () => storeStrictly(inherited, i).value);
const own = { get value() { return 8; } };
for (let i = 0; i < 40; i++) attempt("own, sloppy " + i, () => storeSloppily(own, i).value);
for (let i = 0; i < 6; i++) attempt("own, strict " + i, () => storeStrictly(own, i).value);
class OnlyGetter { get value() { return 9; } }
const instance = new OnlyGetter;
for (let i = 0; i < 40; i++) attempt("class, sloppy " + i, () => storeSloppily(instance, i).value);
for (let i = 0; i < 6; i++) attempt("class, strict " + i, () => storeStrictly(instance, i).value);
for (let i = 0; i < 6; i++) { attempt("mixed, sloppy " + i, () => storeSloppily(instance, i).value); attempt("mixed, strict " + i, () => storeStrictly(instance, i).value); }
console.log(lines.filter((line, index) => !/sloppy [0-9]+ [789]$/.test(line) || index % 10 === 0).join("\n"));
