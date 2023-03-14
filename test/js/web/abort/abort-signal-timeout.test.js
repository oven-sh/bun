import { expect, test } from "bun:test";

test.skip("AbortSignal.timeout", done => {
  const abort = AbortSignal.timeout(10);
  abort.addEventListener("abort", event => {
    done();
  });

  // AbortSignal.timeout doesn't keep the event loop / process alive
  // so we set a no-op timeout
  setTimeout(() => {}, 11);
});
