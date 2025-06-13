// https://github.com/piscinajs/piscina/blob/ba396ced7afc08a8c16f65fbc367a9b7f4d7e84c/test/fixtures/simple-isworkerthread.ts#L7

import assert from "assert";
import Piscina from "piscina";

assert.strictEqual(Piscina.isWorkerThread, true);

export default function () {
  return "done";
}
