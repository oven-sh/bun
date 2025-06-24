const channel = new BroadcastChannel("my-channel");
const message = { hello: "world" };

channel.onmessage = event => {
  console.log(event);
};
channel.postMessage(message);

const error = new Error("hello world");
const clone = structuredClone(error);
console.log(clone.message); // "hello world"
