queueMicrotask(() => { console.log("first"); throw new RangeError("stop"); });
(async () => { await Promise.resolve(1); console.log("awaited"); })();
