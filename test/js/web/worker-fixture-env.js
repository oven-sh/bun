import * as worker_threads from "worker_threads";

if (worker_threads.isMainThread) throw new Error("worker_threads.isMainThread is wrong");

Bun.inspect(process.env);

onmessage = ({}) => {
  postMessage({
    env: process.env,
    hello: process.env.hello,
  });
};
