// Two Workers talk over a MessageChannel whose ports the main thread moved to them; four Workers and the main thread hear one BroadcastChannel; a port is closed under a sender; messages sent before the listener is set wait.
type Ball = { hits: number; path: string[] };

if (Bun.isMainThread) {
  const start = () => new Worker(new URL(import.meta.url));
  const left = start(), right = start();
  const { port1, port2 } = new MessageChannel();
  const result = new Promise<Ball>(resolve => (left.onmessage = event => resolve(event.data)));
  right.postMessage({ role: "right", port: port2 }, [port2]);
  left.postMessage({ role: "left", port: port1 }, [port1]);
  const ball = await result;
  console.log("the ball:", ball.hits, ball.path.slice(0, 4).join(), ball.path.length);
  left.terminate();
  right.terminate();

  const listeners = Array.from({ length: 4 }, start);
  await Promise.all(listeners.map((worker, id) => new Promise<void>(resolve => {
    worker.onmessage = () => resolve();
    worker.postMessage({ role: "listener", id });
  })));
  const news = new BroadcastChannel("news");
  const answers: string[] = [];
  const heardAll = new Promise<void>(resolve => (news.onmessage = event => void (answers.push(event.data), answers.length === 4 && resolve())));
  news.postMessage({ say: "hello", list: [1, 2.5, "three"], when: new Date(5) });
  await heardAll;
  console.log("answers:", answers.sort().join(" | "));
  news.close();
  for (const worker of listeners) worker.terminate();

  const early = new MessageChannel();
  for (let i = 0; i < 5; i++) early.port1.postMessage({ i });
  await new Promise(resolve => setTimeout(resolve, 10));
  const got: number[] = [];
  await new Promise<void>(resolve => (early.port2.onmessage = event => void (got.push(event.data.i), got.length === 5 && resolve())));
  console.log("waited for the listener:", got.join());
  early.port2.close();
  early.port1.postMessage("to a closed port");
  early.port1.close();
  early.port1.postMessage("from a closed port");
  console.log("posting to and from a closed port is silent");

  const chain: Worker[] = Array.from({ length: 6 }, start);
  const ends = new MessageChannel();
  let incoming: MessagePort = ends.port2;
  for (const worker of chain) {
    const link = new MessageChannel();
    worker.postMessage({ role: "relay", from: incoming, to: link.port1 }, [incoming, link.port1]);
    incoming = link.port2;
  }
  const atTheEnd = new Promise<number[]>(resolve => (incoming.onmessage = event => resolve(event.data)));
  ends.port1.postMessage([0]);
  console.log("through six relays:", (await atTheEnd).join());
  incoming.close();
  ends.port1.close();
  for (const worker of chain) worker.terminate();

  const orphan = start();
  const kept = new MessageChannel();
  await new Promise<void>(resolve => {
    orphan.onmessage = () => resolve();
    orphan.postMessage({ role: "holder", port: kept.port2 }, [kept.port2]);
  });
  const closed = new Promise<void>(resolve => orphan.addEventListener("close", () => resolve()));
  orphan.terminate();
  await closed;
  for (let i = 0; i < 100; i++) kept.port1.postMessage({ to: "a port whose thread is gone", i });
  kept.port1.close();
  console.log("posting to a port whose thread is gone is silent");
} else {
  addEventListener("message", (event: MessageEvent<any>) => {
    const data = event.data;
    if (data.role === "left" || data.role === "right") {
      const port: MessagePort = data.port;
      port.onmessage = (message: MessageEvent<Ball>) => {
        const ball = message.data;
        ball.hits++;
        ball.path.push(data.role);
        if (ball.hits >= 1000) postMessage(ball), port.close();
        else port.postMessage(ball);
      };
      if (data.role === "left") port.postMessage({ hits: 0, path: [] } satisfies Ball);
    } else if (data.role === "listener") {
      const news = new BroadcastChannel("news");
      // A listener hears what the other listeners answer too, and an answer may reach it ahead of what was answered.
      news.onmessage = message => void (message.data.say && news.postMessage(data.id + " heard " + message.data.say + " " + message.data.list.join("+") + " " + message.data.when?.getTime()));
      postMessage("listens");
    } else if (data.role === "relay") {
      data.from.onmessage = (message: MessageEvent<number[]>) => data.to.postMessage([...message.data, message.data.length]);
    } else if (data.role === "holder") {
      data.port.onmessage = () => {};
      postMessage("holds");
    }
  });
}
