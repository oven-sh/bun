// when the main thread's environmentData has not been set up (because worker_threads was not imported)
// child threads should still be able to use environmentData

const innerWorkerSrc = /* js */ `
  const assert = require("assert");
  const { getEnvironmentData } = require("worker_threads");
  assert.strictEqual(getEnvironmentData("foo"), "bar");
`;

const outerWorkerSrc = /* js */ `
  const { Worker, setEnvironmentData } = require("worker_threads");
  setEnvironmentData("foo", "bar");
  new Worker(${"`"}${innerWorkerSrc}${"`"}, { eval: true }).on("error", e => {
    throw e;
  });
`;

new Worker("data:text/javascript," + outerWorkerSrc).addEventListener("error", e => {
  throw e;
});
