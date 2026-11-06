// The first interpreter of the process is a ShadowRealm's, and nothing refers to the realm any more.
// argv: the directory of the libraries, how many other realms there are, whether Python begins in the main realm too.
// The first eight global objects of a VM are swept by the collection that finds them dead. A later one lies in a block, and stays there, dead, until somebody gets to it.
import { dlopen } from "bun:ffi";
import { fullGC } from "bun:jsc";

const [libraries, numberOfOthers, mainToo] = process.argv.slice(2);
const c = dlopen(`${libraries}/libeverything.so`, {
  call_everything_with: { args: ["int"], returns: "cstring" },
  leave_a_str_in_the_indicator: {},
}).symbols;
const { is_initialized } = dlopen(`${libraries}/libwithout_gil.so`, { is_initialized: { returns: "int" } }).symbols;
const others = Array.from({ length: Number(numberOfOthers) }, () => new ShadowRealm());
const turn = () => new Promise(resolve => setImmediate(resolve));

// What C is told, each answer once.
const told = new Set();
async function inRealm() {
  const realm = new ShadowRealm();
  const has_the_api = await realm.importValue(new URL("./in_two.py", import.meta.url).pathname, "has_the_api");
  console.log("realm has the API:", String(has_the_api(libraries)));
  told.add(String(c.call_everything_with(0)));
  // While the first is there.
  if (mainToo) return await import("./in_two.py");
}
const main = await inRealm();
if (mainToo) console.log("main has the API:", String(main.has_the_api(libraries)));
// Nobody looks at what C has raised when JS has called it: it stays in the thread's indicator. An exception there would hold the realm, as whatever C owns a reference to does. A str
// belongs to no realm: the pointer is still there when the interpreter has gone and the str has died.
c.leave_a_str_in_the_indicator();
// C is served until a collection finds the realm dead, and refused from then on. These collections sweep no blocks.
for (let turns = 0; turns < 3; turns++) await turn();
for (let collections = 0; is_initialized() && collections < (mainToo ? 1000 : 20); collections++) {
  fullGC();
  told.add(String(c.call_everything_with(0)));
  // After main's import the realm lives for a turn or two more. Without these turns nothing else gets a chance to sweep.
  if (mainToo && is_initialized()) await turn();
}
const hasGone = !is_initialized();
told.add(String(c.call_everything_with(0)));
// Nothing is printed, and the loop does not turn, before the dead realm has been swept: both go through the interpreters of the VM, which is not the subject here.
Bun.gc(true);
console.log("the realm has gone:", hasGone, others.length);
for (const answers of told) console.log("JS calls C:", answers);
if (mainToo) {
  console.log("main has the API:", String(main.has_the_api(libraries)));
  console.log(
    "main, the next call and the next library:",
    String(main.call_something_else()),
    String(main.load_something_else()),
  );
}
