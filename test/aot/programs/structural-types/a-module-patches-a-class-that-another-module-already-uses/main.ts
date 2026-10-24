import { early, use } from "./user.ts";
import { remove } from "./plugin.ts";
import { shared } from "./logger.ts";

console.log("before the plugin loaded: " + early);
console.log("after it loaded: " + use("first"));

let letters = 0;
for (let i = 0; i < 2000; i++) letters += use("w").length;
console.log("2000 rounds: " + letters);

remove();
console.log("the plugin removed: " + use("second"));
console.log("lines of the shared logger: " + shared.lines.length + ", " + shared.lines[0] + ", " + shared.lines[1] + ", " + shared.lines[shared.lines.length - 1]);
