import { report } from "./report.ts";
import { thrower } from "./lib/shapes.ts";
if (process.argv[2] === "uncaught") thrower("other");
if (process.argv[2] === "rejection") { Promise.reject(new Error("rejected")); await new Promise(r => setTimeout(r, 20)); }
for (const l of await report()) console.log("main", l);
const w = new Worker(new URL("./worker.ts", import.meta.url).href);
const lines: string[] = await new Promise(r => { w.onmessage = e => { r(e.data); w.terminate(); }; w.postMessage(0); });
for (const l of lines) console.log("worker", l);
try { thrower("type"); } catch (e: any) { console.log("toplevel", String(e.stack).split("\n").map(l => l.trim()).join(" < ")); }
