// A Worker is terminated while thousands of messages, moved buffers and ports are on their way to it and from it. Nothing is heard behind the close event, and what was moved is gone without a trace.
type Note = { n: number; body: { text: string; list: number[] } };
if (Bun.isMainThread) {
  const rounds = Number(process.env.COUNT ?? 8);
  let late = 0, closedCount = 0;
  for (let round = 0; round < rounds; round++) {
    const worker = new Worker(new URL(import.meta.url));
    let isClosed = false;
    worker.onmessage = () => void (isClosed && late++);
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => ((isClosed = true), closedCount++, resolve())));
    const ports: MessagePort[] = [];
    for (let n = 0; n < 2000; n++) {
      worker.postMessage({ n, body: { text: "t" + n, list: [n, n + 1] } } satisfies Note);
      if (n % 100 === 0) {
        const bytes = new Uint8Array(1 << 16);
        const { port1, port2 } = new MessageChannel();
        ports.push(port1);
        worker.postMessage({ bytes, port: port2 }, [bytes.buffer, port2]);
        port1.postMessage({ over: "the port" });
      }
      if (n === round * 100) worker.terminate();
    }
    worker.terminate();
    await closed;
    worker.postMessage("behind the end");
    for (const port of ports) port.postMessage("to nobody"), port.close();
    if (round % 5 === 0) Bun.gc(true);
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  console.log("closed:", closedCount, "heard behind the close:", late);
} else {
  addEventListener("message", (event: MessageEvent<any>) => {
    if (event.data.port) event.data.port.onmessage = () => event.data.port.postMessage(new Uint8Array(1 << 12));
    for (let i = 0; i < 3; i++) postMessage({ echo: event.data.n, list: [1, 2, 3] });
  });
}
