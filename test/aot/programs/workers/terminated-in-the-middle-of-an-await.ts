// A Worker waits: for a promise nobody settles, a timer, a sleep, a file, an async generator, a message that never comes. It is terminated there; nothing behind the await and no finally runs.
async function* numbers(): AsyncGenerator<number> {
  try {
    for (let i = 0; ; i++) {
      await new Promise(resolve => setTimeout(resolve, 1));
      yield i;
    }
  } finally {
    postMessage("the finally of the generator ran");
  }
}

const waits: Record<string, () => Promise<unknown>> = {
  never: () => new Promise(() => {}),
  timer: () => new Promise(resolve => setTimeout(resolve, 100_000)),
  sleep: () => Bun.sleep(100_000),
  generator: async () => {
    let sum = 0;
    for await (const n of numbers()) sum += n;
    return sum;
  },
  files: async () => {
    for (;;) await Bun.file(process.execPath).slice(0, 4096).text();
  },
  microtasks: async () => {
    for (let i = 0; ; i++) {
      await i;
      if (i % 1000 === 0) await new Promise(resolve => setImmediate(resolve));
    }
  },
  message: () => new Promise(resolve => addEventListener("message", event => event.data === "never sent" && resolve(0))),
  thenable: async () => await ({ then() {} } as any),
};

if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 2);
  for (const name of Object.keys(waits)) {
    if (process.env.ONLY && process.env.ONLY !== name) continue;
    const heard: string[] = [];
    for (let round = 0; round < rounds; round++) {
      const worker = new Worker(new URL(import.meta.url));
      const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
      await new Promise<void>(resolve => {
        worker.onmessage = event => (event.data === "waits" ? resolve() : heard.push(event.data));
        worker.postMessage(name);
      });
      await new Promise(resolve => setTimeout(resolve, 5 + round));
      worker.terminate();
      await closed;
    }
    console.log(name, "closed", JSON.stringify(heard));
  }
} else {
  addEventListener("message", async (event: MessageEvent<string>) => {
    if (!(event.data in waits)) return;
    try {
      const waiting = waits[event.data]();
      postMessage("waits");
      await waiting;
      postMessage("went on behind the await");
    } finally {
      postMessage("the finally ran");
    }
  });
}
