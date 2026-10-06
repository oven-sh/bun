// https://github.com/oven-sh/bun/issues/29267
//
// Next.js App Router SSR under `bun --bun next start` leaked one
// Strong<ReadableStream> per request. Next's dedupe-fetch stores the fetch
// Response promise in a React.cache()-scoped map that lives inside the
// request's AsyncLocalStorage store, and Next's cloneResponse reads `.body`
// on a Response whose body is a buffered ArrayBuffer. Reading `.body` on a
// Blob/InternalBlob/string-backed Response materializes a ReadableStream and
// cached a Strong handle to it in `Body::PendingValue.readable`; that Strong
// was only migrated into the wrapper's traced `m_stream` slot from
// construct/to_js/clone, not from the `.body` getter. The stream's captured
// async context reached back to the Response, so the Strong formed an
// uncollectable cycle and every request's ALS store (tens to hundreds of KB)
// was retained forever.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

test("Response.body on a buffered body does not root the stream when the async context references the Response", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "29267-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const jsonLine = stdout.split("\n").find(l => l.startsWith("{"));
  expect(jsonLine).toBeDefined();
  const result = JSON.parse(jsonLine!);

  // Before the fix `protectedRS` equals N (one Strong<ReadableStream> per
  // iteration); after the fix it is a small constant. N/2 separates the two
  // with wide margin while tolerating a handful of unrelated transients.
  expect(result.protectedRS).toBeLessThan(result.N / 2);
  // The per-iteration objects should be collected, not accumulate.
  expect(result.response).toBeLessThan(result.N / 2);
  expect(result.readableStream).toBeLessThan(result.N / 2);

  // ~60 KB retained per iteration pre-fix (50 KB ALS payload + 10 KB body).
  // ASAN quarantine and debug-heap padding inflate post-GC heapSize, so the
  // ceiling here is well under the unfixed ~30 MB but above sanitizer noise.
  const heapCeilingMB = isASAN || isDebug ? 14 : 7;
  expect(result.heapMB).toBeLessThan(heapCeilingMB);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
