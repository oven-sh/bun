// Two interpreters in one heap. The instance is of the one that has the API; what holds it is garbage of the other, with a finalizer. The collection that finds the holder dead keeps it for its
// finalizer, with all that it leads to: the instance is whole there. It goes when the holder has gone. argv: the directory of the libraries.
import { fullGC } from "bun:jsc";
import { collect, events, make } from "./two_realms.py";

const [libraries] = process.argv.slice(2);
const turn = () => new Promise(resolve => setImmediate(resolve));
const realm = new ShadowRealm();
const path = new URL("./two_realms.py", import.meta.url).pathname;
const [hold, whatWasSaid, collectThere] = await Promise.all(["hold", "what_was_said", "collect"].map(name => realm.importValue(path, name)));

(function () {
  console.log(hold(make(libraries)));
})();
for (let collections = 0; whatWasSaid() === "[]" && collections < 100; collections++) {
  fullGC();
  await turn();
}
console.log("the finalizer in the other realm:", whatWasSaid(), "| ended so far:", String(events()));
let ended = "[]";
for (let collections = 0; ended === "[]" && collections < 100; collections++) {
  collectThere();
  collect();
  await turn();
  ended = String(events());
}
console.log("ended:", ended);
