const inner = new Worker(new URL("./inner.ts", import.meta.url));
inner.onmessage = event => postMessage("outer got " + event.data);
