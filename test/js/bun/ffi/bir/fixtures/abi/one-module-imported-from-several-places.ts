import { bump, current } from "./one-module-imported-from-several-places.c";
import { bumpFromElsewhere } from "./one-module-imported-from-several-places-other";

console.log(bump(), bumpFromElsewhere(), bump(), current());
const again = await import("./one-module-imported-from-several-places.c");
const required = require("./one-module-imported-from-several-places.c");
console.log(again.bump === bump, again.current(), required.current());
