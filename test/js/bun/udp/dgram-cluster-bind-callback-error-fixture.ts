// A cluster worker binds with a callback and no 'error' listener, and the
// primary answers its request for a shared handle with an error code.
import cluster from "node:cluster";
import dgram from "node:dgram";

if (cluster.isPrimary) {
  cluster.fork();
} else {
  // Answer in place of the primary, as node's test-dgram-cluster-bind-error.js
  // does. The worker disconnects whether or not the error is raised, so a
  // worker that hears nothing exits with no output.
  (cluster as any)._getServer = (_socket: unknown, _options: unknown, callback: (err: number) => void) => {
    try {
      callback(-4094); // UV_UNKNOWN
    } finally {
      cluster.worker!.disconnect();
    }
  };
  process.on("uncaughtException", err => console.log("uncaughtException", (err as NodeJS.ErrnoException).code));
  dgram.createSocket("udp4").bind(() => console.log("callback"));
}
