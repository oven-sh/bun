// Code of the interpreter that is served runs deep inside C that another interpreter of the VM runs. For whom that C runs is a question for C: the books that ctypes keeps of main's own
// calls do not depend on it. argv: the directory of the libraries.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import * as main from "./in_two.py";

if (!isMainThread) {
  parentPort.postMessage(String(main.call_by_address(workerData)));
  await new Promise(() => {});
}

const libraries = process.argv[2];
const realm = new ShadowRealm();
const inRealm = name => realm.importValue(new URL("./in_two.py", import.meta.url).pathname, name);
const say = (who, what) => console.log(`${who}:`, String(what));
const realmSizes = await inRealm("sizes_around");

say("main", main.books(libraries));
main.sizes_around(libraries, false, () => say("main, inside C that main runs", main.books(libraries)));
realmSizes(libraries, false, () => say("main, inside C that the realm runs", main.books(libraries)));
say("later", main.books_later(libraries));

say("main, an instance", main.books_of_an_instance(libraries));
realmSizes(libraries, false, () =>
  say("main, an instance, inside C that the realm runs", main.books_of_an_instance(libraries)),
);

// The code of a callback gives a reference with its result, and whoever has called it takes that over: both or neither.
const address = String(main.make_callback(libraries));
const realmCalls = await inRealm("call_by_address");
say("C owns", main.owned_of_thing(libraries));
say("main calls it", main.call_by_address(address));
say("C owns", main.owned_of_thing(libraries));
say("the realm calls it", realmCalls(address));
say("C owns", main.owned_of_thing(libraries));
realmSizes(libraries, false, () => say("the realm calls it, inside C that the realm runs", realmCalls(address)));
say("C owns", main.owned_of_thing(libraries));
// C of a library gives the reference back itself. If it runs for the realm it cannot: the object is held for ever.
say("C that main runs calls it", main.c_calls_by_address(libraries, true, address));
say("C owns", main.owned_of_thing(libraries));
const realmsC = await inRealm("c_calls_by_address");
for (let i = 0; i < 2; i++) {
  say("C that the realm runs calls it", realmsC(libraries, false, address));
  say("C owns", main.owned_of_thing(libraries));
}
// On a thread of another VM's the callback is not run.
const worker = new Worker(new URL(import.meta.url), { workerData: address });
say("a worker calls it", await new Promise(resolve => worker.once("message", resolve)));
await worker.terminate();
say("C owns", main.owned_of_thing(libraries));
say("what C owns is alive, and is", main.drop_thing_and_ask_c());
