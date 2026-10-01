import * as L from "./lib";
declare var self: Worker;
self.onmessage = e => { const w = new L.WithFields(); postMessage([e.data, w.b, L.EMPTY.length, L.wide, [...L.gen(3)].join(), "abbc".replace(L.re, "$1"), L.Derived.toString(), ({ x: 1 } as any)[L.one]].join(";")); };
