// An import, a namespace object, a required namespace and a proxy above it all show what the exporting file stored last.
import * as ns from "./a.mjs";
import { x, inc, setX, y as why, def, late } from "./a.mjs";
import dflt, { reassignDefault } from "./a.mjs";
import { createRequire } from "node:module";
const out = [];
out.push(x, ns.x); inc(); out.push(x, ns.x); [1, 2].forEach(inc); out.push(x, ns.x);
setX(10); out.push(x, ns.x, ns["x"]); const k = ["x"][0]; out.push(ns[k]);
out.push(why, ns.y); out.push(typeof dflt, dflt()); reassignDefault(); out.push(typeof dflt, typeof ns.default);
out.push(def);
try { const any = [ns][0]; any.x = 5; } catch (e) { out.push(e.name); } out.push(Reflect.set(ns, "x", 5), x);
out.push(Reflect.defineProperty(ns, "x", { value: 10 }), Reflect.defineProperty(ns, "x", { value: 11 }), x);
out.push(Reflect.deleteProperty(ns, "x"), Reflect.deleteProperty(ns, "nope"));
out.push(Object.getOwnPropertyDescriptor(ns, "x")); inc(); out.push(Object.getOwnPropertyDescriptor(ns, "x").value, Object.values(ns).length, JSON.stringify(ns), { ...ns }.x, Object.entries(ns).find(e => e[0] === "x")[1]);
out.push(late); ns.setLate(3); out.push(late, ns.late);
const m = await import("./a.mjs"); out.push(m === ns, m.x); m.inc(); out.push(x);
const require = createRequire(import.meta.url); const r = require("./a.mjs"); out.push(r.x); r.inc(); out.push(x, r.x);
const p = new Proxy(ns, {}); out.push(p.x); inc(); out.push(p.x, Reflect.get(ns, "x"), Reflect.get(Object.create(ns), "x"));
with_(ns); function with_(o) { out.push(Object.keys(o).join()); }
console.log(JSON.stringify(out));
console.log(ns);
