const worker = new Worker(new URL("worker-fixture-many-messages.js", import.meta.url).href, {});

worker.postMessage("initial message");
worker.addEventListener("message", ({ data }) => {
  if (data.done) {
    console.log("done");
    worker.terminate();
  } else {
    worker.postMessage({ i: data.i + 1 });
  }
});
