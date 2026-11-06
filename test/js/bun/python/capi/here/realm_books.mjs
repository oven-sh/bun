// Code of the interpreter that is served runs deep inside C that another interpreter of the VM runs. For whom that C runs is a question for C: the books that ctypes keeps of main's own
// calls do not depend on it. argv: the directory of the libraries.
import * as main from "./in_two.py";

const libraries = process.argv[2];
const realm = new ShadowRealm();
const inRealm = name => realm.importValue(new URL("./in_two.py", import.meta.url).pathname, name);
const say = (who, what) => console.log(`${who}:`, String(what));
const realmSizes = await inRealm("sizes_around");

say("main", main.books(libraries));
main.sizes_around(libraries, false, () => say("main, inside C that main runs", main.books(libraries)));
realmSizes(libraries, false, () => say("main, inside C that the realm runs", main.books(libraries)));
say("later", main.books_later(libraries));

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
say("what C owns is alive, and is", main.drop_thing_and_ask_c());
