// Getters and setters of a class run through a spread of the prototype's descriptors, a pattern, Object.assign, Object.entries of an instance with own accessors, JSON.stringify, `in` with a Proxy and a for-in copy.
import { Point, Settings, Traps } from "./accessors";

const { x, y: renamed } = new Point();
console.log(x, renamed);
const target = new Settings();
Object.assign(target, { level: 3 });
console.log(target.stored);
const name = "lev" + "el";
(target as any)[name] = 4;
console.log((target as any)[name]);
const proxy: any = new Proxy({}, new Traps());
console.log(proxy.anything, "key" in proxy, Object.keys(proxy).join(), delete proxy.gone);
