// When the main thread never imported worker_threads (so its environmentData was
// never set up), child threads must still be able to use environmentData. The
// main thread therefore only uses the web Worker global, and prints what the
// innermost thread read.

const innerWorkerSrc = /* js */ `
  const { getEnvironmentData, parentPort } = require("worker_threads");
  parentPort.postMessage({ foo: getEnvironmentData("foo") });
`;

const outerWorkerSrc = /* js */ `
  const { Worker, setEnvironmentData } = require("worker_threads");
  setEnvironmentData("foo", "bar");
  const inner = new Worker(${"`"}${innerWorkerSrc}${"`"}, { eval: true });
  inner.on("message", m => postMessage(m));
  inner.on("error", e => {
    throw e;
  });
`;

const outer = new Worker("data:text/javascript," + outerWorkerSrc);
outer.addEventListener("message", e => {
  console.log(JSON.stringify(e.data));
  outer.terminate();
});
outer.addEventListener("error", e => {
  throw e;
});
