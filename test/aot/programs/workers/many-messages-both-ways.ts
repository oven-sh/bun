// Twenty thousand small messages each way, and large ones, while both threads collect: none is lost, none is doubled, the order holds.
type Message = { n: number; text: string; list: number[]; inner: { half: number } };
function check(message: Message, n: number): boolean {
  return message.n === n && message.text === "m" + n && message.list.length === n % 5 && message.inner.half === n / 2;
}
const make = (n: number): Message => ({ n, text: "m" + n, list: Array.from({ length: n % 5 }, (_, i) => i), inner: { half: n / 2 } });

if (Bun.isMainThread) {
  const count = Number(process.env.COUNT ?? 20_000);
  const worker = new Worker(new URL(import.meta.url));
  let next = 0, wrong = 0;
  const done = new Promise<string>(resolve => {
    worker.onmessage = (event: MessageEvent<Message | string>) => {
      if (typeof event.data === "string") return resolve(event.data);
      if (!check(event.data, next++)) wrong++;
      if (next % 5_000 === 0) Bun.gc(true);
    };
  });
  for (let n = 0; n < count; n++) {
    worker.postMessage(make(n));
    if (n % 5_000 === 4_999) await new Promise(resolve => setTimeout(resolve, 0));
  }
  worker.postMessage("end");
  console.log("there:", await done, "here:", next === count, wrong);

  const big = { text: "x".repeat(1 << 24), list: Array.from({ length: 1 << 20 }, (_, i) => i), bytes: new Uint8Array(1 << 24).fill(3) };
  const echo = new Promise<any>(resolve => (worker.onmessage = event => resolve(event.data)));
  worker.postMessage(big);
  const back = await echo;
  console.log("large:", back.text.length, back.list.length, back.list[1 << 19], back.bytes.length, back.bytes[1 << 23]);
  worker.terminate();
} else {
  let next = 0, wrong = 0;
  addEventListener("message", (event: MessageEvent<any>) => {
    if (event.data === "end") return postMessage(next + " " + wrong);
    if (event.data.bytes) return postMessage(event.data);
    if (!check(event.data, next)) wrong++;
    postMessage(make(next++));
    if (next % 3_000 === 0) Bun.gc(true);
  });
}
