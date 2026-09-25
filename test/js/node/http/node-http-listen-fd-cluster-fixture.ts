// The cluster primary of the `listen({ fd })` tests in serve-listen.test.ts. The
// test bound a socket and passed it to this process as descriptor LISTEN_FD.
// Each worker listens on `{ fd }`, which names the descriptor of this process.
// The file and its worker run unchanged under node.
import cluster from "node:cluster";
import { fstatSync } from "node:fs";
import { join } from "node:path";

const fd = Number(process.env.LISTEN_FD);
cluster.setupPrimary({ exec: join(import.meta.dirname, "node-http-listen-fd-cluster-worker-fixture.ts") });

const workers = Array.from({ length: Number(process.env.LISTEN_WORKERS || 2) }, () => cluster.fork());
let replies: unknown[] = [];
let stopping = false;

// The primary closes its descriptor when the last worker gives the handle back.
function descriptor() {
  try {
    fstatSync(fd);
    return "open";
  } catch {
    return "closed";
  }
}

for (const worker of workers) {
  worker.on("message", reply => {
    if (reply === "echo") return void worker.send("echo");
    replies.push(reply);
    if (replies.length < workers.length) return;
    console.log(JSON.stringify(stopping ? { fd: descriptor(), workers: replies } : replies));
    if (stopping) process.exit(0);
    replies = [];
  });
  worker.on("exit", (code, signal) => {
    if (!stopping) {
      // The test reads this line in place of the answers.
      console.log(JSON.stringify({ exit: { code, signal } }));
      process.exit(1);
    }
    replies.push({ code, exitedAfterDisconnect: worker.exitedAfterDisconnect });
    if (replies.length < workers.length) return;
    console.log(JSON.stringify({ fd: descriptor(), workers: replies }));
    process.exit(0);
  });
}

// The test asks for the end with SIGHUP.
process.on("SIGHUP", () => {
  stopping = true;
  if (process.env.LISTEN_STOP === "disconnect") cluster.disconnect();
  else for (const worker of workers) worker.send("close");
});
