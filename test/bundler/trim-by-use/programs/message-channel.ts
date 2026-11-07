const { port1, port2 } = new MessageChannel();
const first = await new Promise(resolve => {
  port2.onmessage = (event: any) => resolve(event.data);
  port1.postMessage({ hello: "port", when: new Date(0), set: new Set([1, 2]) });
});
console.log(first);
port1.close();
port2.close();
const sender = new BroadcastChannel("news");
const listener = new BroadcastChannel("news");
const second = await new Promise(resolve => {
  listener.onmessage = (event: any) => resolve(event.data);
  sender.postMessage(["to", "everybody"]);
});
console.log(second, port1 instanceof MessagePort, sender.name);
sender.close();
listener.close();
