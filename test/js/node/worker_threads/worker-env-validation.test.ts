import { expect, test } from "bun:test";
import { Worker } from "node:worker_threads";

test("env: function is rejected with ERR_INVALID_ARG_TYPE, not accepted as an env object", () => {
  const fn = () => {};
  (fn as any).OWNPROP = "x";
  for (const env of [fn, function named() {}, class C {}, async () => {}]) {
    expect(() => new Worker("1", { eval: true, env: env as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  }
  // object-likes that node accepts (validateObject with kValidateObjectAllowArray) must stay accepted
  for (const env of [[], new Date(), /re/]) {
    let w: Worker;
    expect(() => (w = new Worker("1", { eval: true, env: env as any }))).not.toThrow();
    w!.unref();
    w!.terminate();
  }
});
