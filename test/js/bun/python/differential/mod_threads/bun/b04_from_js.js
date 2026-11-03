import { in_thread, blocking_join, Counter } from "./b04_mod.py";
console.log(String(await in_thread(21)));
console.log(JSON.stringify(blocking_join(5)));
const c = new Counter();
c.start(4);
let spins = 0;
for (let i = 0; i < 1e5; i++) spins++;
console.log(c.wait(), spins);
console.log((await Promise.all([in_thread(1), in_thread(2)])).map(String).join(" "));
