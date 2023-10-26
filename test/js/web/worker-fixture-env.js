import { isMainThread } from "worker_threads";

if (isMainThread) throw new Error("worker_threads.isMainThread is wrong");

Bun.inspect(process.env);

onmessage = () => {
  postMessage({
    env: process.env,
    hello: process.env.hello,
  });
};
