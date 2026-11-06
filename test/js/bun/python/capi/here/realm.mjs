// A second interpreter in the VM of the first, and on its thread: a ShadowRealm's. It holds the same lock, so it is not by the lock that C which runs for it is known.
// argv: the directory of the libraries.
import * as main from "./in_two.py";

const libraries = process.argv[2];
const realm = new ShadowRealm();
const inRealm = name => realm.importValue(new URL("./in_two.py", import.meta.url).pathname, name);
const say = (who, what) => console.log(`${who}:`, String(what));

say("main has the API", main.has_the_api(libraries));
say("main", main.is_held_until_given_back(libraries));
say("realm has the API", (await inRealm("has_the_api"))(libraries));
say("realm", (await inRealm("all_but_a_call"))(libraries));
say("realm", (await inRealm("count_and_ask_by_cdll"))(libraries));
say("realm, what C makes", (await inRealm("made_by_cdll"))(libraries));
say("realm, what C raises", (await inRealm("raise_by_cdll"))(libraries));
say("main, the next call", main.call_something_else());
say("realm, what C raises", (await inRealm("raise_by_cdll"))(libraries));
say("main, the next library", main.load_something_else());
say("realm, a library that raises as it goes", (await inRealm("load_and_let_go"))(libraries));
say("main, the next call", main.call_something_else());
// One inside the other, both ways round. What C is told before it calls back, and after.
const realmSizes = await inRealm("sizes_around");
say(
  "main, around the realm",
  main.sizes_around(libraries, true, () =>
    say(
      " realm",
      realmSizes(libraries, false, () => {}),
    ),
  ),
);
say(
  "realm, around main",
  realmSizes(libraries, false, () =>
    say(
      " main",
      main.sizes_around(libraries, true, () => {}),
    ),
  ),
);
say("main", main.is_held_until_given_back(libraries));
