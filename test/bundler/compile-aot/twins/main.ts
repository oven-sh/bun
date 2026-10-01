const a = await import("./a.ts"), b = await import("./b.ts"), c = await import("./c.ts");
console.log(a.bump("a"), a.bump("a"), b.bump("b"), c.bump("c"), a.bump("a"));
console.log(a.bump === b.bump, a.Box === b.Box, a.re === b.re, new a.Box().id, new a.Box().id, new b.Box().id, new c.Box().id);
try { null!.x } catch (e: any) { console.log(String(e.stack).split("\n")[1]?.trim().replace(/chunk-\w+/, "chunk")); }
const w = new Worker(new URL("./worker.ts", import.meta.url).href);
console.log(JSON.stringify(await new Promise(r => { w.onmessage = e => { r(e.data); w.terminate(); }; w.postMessage(0); })));
