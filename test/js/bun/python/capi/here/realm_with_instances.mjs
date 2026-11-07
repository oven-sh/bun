// The first interpreter of the process is a ShadowRealm's. It has instances of the type of an extension, and nothing refers to the realm any more: they die with it, in one collection.
// The realm goes, and they with it: there is no interpreter any more in which a tp_dealloc could run, as at an exit without a collection. argv: the directory of the libraries.
import { dlopen } from "bun:ffi";
import { fullGC } from "bun:jsc";

const [libraries] = process.argv.slice(2);
const { is_initialized } = dlopen(`${libraries}/libwithout_gil.so`, { is_initialized: { returns: "int" } }).symbols;
const { number_ended } = dlopen(`${libraries}/libunowned.so`, { number_ended: { returns: "int" } }).symbols;
const turn = () => new Promise(resolve => setImmediate(resolve));

async function inRealm() {
  const realm = new ShadowRealm();
  const make_instances = await realm.importValue(new URL("./in_two.py", import.meta.url).pathname, "make_instances");
  console.log(String(make_instances(libraries)), number_ended());
}
await inRealm();
for (let turns = 0; turns < 3; turns++) await turn();
// What is owed to others holds the realm, and is done at a turn of the loop.
for (let collections = 0; is_initialized() && collections < 100; collections++) {
  fullGC();
  if (is_initialized()) await turn();
}
console.log("the realm has gone:", !is_initialized(), "ended:", number_ended());
