// Every fetch() is given an id that the JS thread uses to find the request's
// socket on the HTTP thread (abort, request-body writes, receive resumes). The
// id counter is 64-bit, so two requests that are alive at the same time can
// never share an id. This test puts two live requests exactly 2**32 ids apart
// (identical in their low 32 bits) and checks that aborting one leaves the
// other alone.

import { fetchRequestIdInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("requests whose ids agree in their low 32 bits are aborted independently", async () => {
  const bothRequestsArrived = Promise.withResolvers<void>();
  let requestsArrived = 0;
  using server = Bun.serve({
    port: 0,
    fetch() {
      if (++requestsArrived === 2) bothRequestsArrived.resolve();
      // Hold both responses open; each request ends only when the client aborts it.
      return new Promise<Response>(() => {});
    },
  });

  const idOfA = fetchRequestIdInternals.skipIds(0);
  const controllerA = new AbortController();
  const a = fetch(server.url, { signal: controllerA.signal });
  // `a` took one id; skipping the rest of the 2**32 block puts `b` exactly 2**32 ids after it.
  expect(fetchRequestIdInternals.skipIds(2 ** 32 - 1)).toBe(idOfA + 2 ** 32);
  const controllerB = new AbortController();
  const b = fetch(server.url, { signal: controllerB.signal });
  const settle = (name: string, promise: Promise<Response>) =>
    promise.then(
      () => `${name} resolved`,
      (e: { name: string }) => `${name} rejected: ${e.name}`,
    );
  const aSettled = settle("a", a);
  const bSettled = settle("b", b);

  await bothRequestsArrived.promise;

  controllerA.abort();
  expect(await Promise.race([aSettled, bSettled])).toBe("a rejected: AbortError");
  expect(Bun.peek.status(b)).toBe("pending");

  controllerB.abort();
  expect(await bSettled).toBe("b rejected: AbortError");
});
