// A literal passed to a function of a JavaScript file, which stores over its members.
import { alter } from "./untyped.js";
const o = alter({ count: 1, more: { n: 1, extra: "e" } });
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
