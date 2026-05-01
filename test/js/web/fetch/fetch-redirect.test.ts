import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/12701
it("fetch() preserves body on redirect", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/redirect") {
        return new Response(null, {
          status: 308,
          headers: {
            Location: "/redirect2",
          },
        });
      }
      if (pathname === "/redirect2") {
        return new Response(req.body, { status: 200 });
      }
      return new Response("you shouldnt see this?", { status: 200 });
    },
  });

  const res = await fetch(new URL("/redirect", server.url), {
    method: "POST",
    body: "hello",
  });

  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello");
});

// The HTTP client allocates a new URL buffer for every Location hop and stores
// it in HTTPClient.redirect so HTTPClient.url can borrow slices from it. Prior
// to the fix, assigning the new buffer did not free the previous one, so only
// the final hop was released in deinit() and every intermediate URL leaked.
it("fetch() does not leak intermediate redirect URLs in multi-hop chains", async () => {
  const HOPS = 10;
  // Pad the redirect URL so each leaked intermediate buffer is large enough
  // to move RSS measurably. The padding goes in the fragment so the client
  // allocates the full URL into HTTPClient.redirect while the request sent
  // on the wire stays tiny (fragments are never transmitted), which keeps
  // the server under its request-line limit and lets keep-alive reuse one
  // socket for every hop. Stays under MAX_REDIRECT_URL_LENGTH (128 KiB).
  const PAD = Buffer.alloc(96 * 1024, "a").toString();

  // Server runs in the parent so its allocations are excluded from the
  // child's RSS measurement.
  using server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      const m = pathname.match(/^\/hop\/(\d+)/);
      const hop = m ? Number(m[1]) : 0;
      if (hop < HOPS) {
        return new Response(null, {
          status: 302,
          headers: { Location: `${server.url.origin}/hop/${hop + 1}#${PAD}` },
        });
      }
      return new Response("ok");
    },
  });

  // Run the fetch loop in a child process so server-side buffers don't
  // pollute the RSS we measure. The child samples RSS after warmup and
  // again after two equal batches so we can assert on steady-state growth.
  const script = `
    const url = "${server.url.origin}/hop/0";
    async function once() {
      const res = await fetch(url, { redirect: "follow" });
      if (await res.text() !== "ok") throw new Error("unexpected body: " + res.status);
    }
    function sample() { Bun.gc(true); return process.memoryUsage.rss(); }
    for (let i = 0; i < 15; i++) await once();
    const rss0 = sample();
    for (let i = 0; i < 25; i++) await once();
    const rss1 = sample();
    for (let i = 0; i < 25; i++) await once();
    const rss2 = sample();
    console.log(JSON.stringify({ rss0, rss1, rss2 }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const { rss0, rss1, rss2 } = JSON.parse(stdout.trim());
  const secondHalfMiB = (rss2 - rss1) / 1024 / 1024;
  // With the bug, (HOPS - 1) intermediate ~96 KiB URL buffers leak per fetch:
  // roughly 864 KiB * 50 ≈ 42 MiB total, split evenly across both halves
  // (~21 MiB each). Without it, allocator growth plateaus after warmup so
  // the second half stays near zero. Asserting on the second half avoids
  // counting one-off arena growth that can still occur shortly after warmup.
  expect(secondHalfMiB).toBeLessThan(12);
}, 60_000);
