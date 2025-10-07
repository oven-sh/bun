const { isMainThread, Worker, BroadcastChannel } = require("node:worker_threads");

if (isMainThread) {
  // create a shared buffer with dummy value
  const sharedBuffer = new SharedArrayBuffer(4);
  const uint32Array = new Uint32Array(sharedBuffer);
  uint32Array[0] = 12345;

  // create broadcast channel
  const mainChannel = new BroadcastChannel("shared-array-buffer");

  // answer to workers
  mainChannel.onmessage = event => {
    if (event.data === "request-buffer") {
      mainChannel.postMessage(sharedBuffer);
    }
  };

  // The first worker works!
  new Worker(__filename);

  // A delayed worker works as well
  setTimeout(() => {
    new Worker(__filename);
  }, 1);

  // Immediately starting another crashes bun - comment next line to make bun 'work'
  new Worker(__filename);

  setTimeout(() => process.exit(0), 500);
} else {
  // Worker thread logic
  const workerChannel = new BroadcastChannel("shared-array-buffer");

  // Request the SharedArrayBuffer from the main thread
  workerChannel.postMessage("request-buffer");

  // get the buffer and print it
  workerChannel.onmessage = event => {
    if (event.data instanceof SharedArrayBuffer) {
      const uint32Array = new Uint32Array(event.data);
      console.log("SharedArrayBuffer bytes:", uint32Array[0]);
      workerChannel.close();
    }
  };
}
