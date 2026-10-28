queueMicrotask(() => { console.log("first"); throw new RangeError("stop"); });
(async () => { await { then(resolve) { console.log("then"); resolve(1); } }; console.log("awaited"); })();
