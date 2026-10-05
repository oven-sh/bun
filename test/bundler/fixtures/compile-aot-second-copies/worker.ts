import { parentPort, workerData } from "node:worker_threads";
import { member, stranger, readsAll, sums, around, counters } from "./shapes.ts";
const kept: any[] = [];
parentPort!.on("message", (what: string) => {
    let answer = "";
    if (what === "sum") { const list = []; for (let i = 0; i < 50; ++i) list.push(member()); kept.push(list[0]); answer = String(sums(list)); }
    else if (what === "depart") { const o = member(); delete o.key; o.key = "K"; kept.push(o); answer = readsAll(o) + " " + Object.keys(o).join(); }
    else if (what === "around") { const list = []; for (let i = 0; i < 50; ++i) list.push(member()); answer = String(around(list)); }
    else if (what === "stranger") answer = readsAll(stranger());
    else if (what === "received") answer = "none";
    parentPort!.postMessage(workerData + " " + what + ": " + answer + counters());
});
parentPort!.postMessage(workerData + " ready: yes");
