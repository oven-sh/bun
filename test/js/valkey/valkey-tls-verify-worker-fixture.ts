// A worker that never leaves `tls.checkServerIdentity`: the parent terminates it there.
import { RedisClient } from "bun";
import { workerData } from "node:worker_threads";

const { port, ca, counters } = workerData as { port: number; ca: string; counters: SharedArrayBuffer };
const count = new Int32Array(counters); // [0] callback entered, [1] onclose ran, [2] command settled

const client = new RedisClient(`rediss://localhost:${port}`, {
  autoReconnect: false,
  tls: {
    ca,
    checkServerIdentity: () => {
      Atomics.add(count, 0, 1);
      Atomics.notify(count, 0);
      for (;;) {}
    },
  },
});
client.onclose = () => void Atomics.add(count, 1, 1);
client.send("PING", []).then(
  () => Atomics.add(count, 2, 1),
  () => Atomics.add(count, 2, 1),
);
