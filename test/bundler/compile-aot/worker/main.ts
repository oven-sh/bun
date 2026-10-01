import { shared, Counter } from "./lib.ts";
const w = new Worker(new URL("./worker.ts", import.meta.url).href);
const answer: any = await new Promise((resolve, reject) => { w.onmessage = e => resolve(e.data); w.onerror = e => reject(e); w.postMessage({ n: 20 }); });
console.log("main", shared(3), new Counter(2).add(5).value, JSON.stringify(answer));
w.terminate();
