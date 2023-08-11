const worker = new Worker(new URL(process.argv[2], import.meta.url));

worker.postMessage("initial message");
worker.addEventListener("message", ({ data }) => {
  if (data.done) {
    console.log("done");
  } else {
    worker.postMessage({ i: data.i + 1 });
  }
});
