// A worker that never leaves `tls.checkServerIdentity`: the parent terminates it there.
import { SQL } from "bun";
import { workerData } from "node:worker_threads";

const { url, ca, counters } = workerData as { url: string; ca: string; counters: SharedArrayBuffer };
const count = new Int32Array(counters); // [0] callback entered, [1] onclose ran, [2] connect() settled

const sql = new SQL({
  url,
  max: 1,
  onclose: () => void Atomics.add(count, 1, 1),
  tls: {
    ca,
    checkServerIdentity: () => {
      Atomics.add(count, 0, 1);
      Atomics.notify(count, 0);
      for (;;) {}
    },
  },
});
const settled = () => {
  Atomics.add(count, 2, 1);
  Atomics.notify(count, 0);
};
sql.connect().then(settled, settled);
