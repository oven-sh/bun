const cluster = require("cluster");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("online", disconnect);

  function disconnect() {
    worker.disconnect();
    // The worker remains in cluster.workers until both disconnect AND exit.
    // Disconnect is supposed to disconnect all workers, but not workers that
    // are already disconnected, since calling disconnect() on an already
    // disconnected worker would error.
    worker.on("disconnect", cluster.disconnect);
  }
}
