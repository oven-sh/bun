declare var self: Worker;
self.onmessage = async () => { const a = await import("./a.ts"), b = await import("./b.ts"); postMessage([a.bump("w"), b.bump("v"), a.bump("w"), a.bump === b.bump, new a.Box().id, new b.Box().id]); };
