import Dep, { count, tally } from "./dep.js";
tally(2);
Dep.make();
postMessage(`worker:${count}:${Dep.make()}`);
