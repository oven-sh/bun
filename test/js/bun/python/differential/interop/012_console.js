import m, { P, add, d, t } from "./012_console.py";
import { kwargs, float as pyFloat } from "bun:python";
import util from "node:util";
const clean = s => s.replace(/0x[0-9a-f]+/g, "0xADDR").replace(/File ".*\//g, 'File "');
console.log(new P(1), d, t, m.s, m.b);
console.log([new P(2), 1.5], { p: new P(3), n: 1 });
console.log(m.floats, pyFloat(2), [pyFloat(3)]);
console.log(clean(util.inspect(add)), util.inspect(P), clean(util.inspect(new m.Plain())), clean(util.inspect(m)));
console.log(`${new P(4)}`, String(t), util.format("%s|%o", new P(5), new P(6)));
try { m.fail(); } catch (e) { console.log(clean(util.inspect(e))); }
try { m.fail2(); } catch (e) { console.log(clean(util.inspect(e)).split("\n").filter(l => !l.startsWith("    ")).join("\n")); }
console.log(typeof kwargs, Object.keys(await import("bun:python")).sort().join());
