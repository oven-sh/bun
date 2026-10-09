import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";

// https://github.com/oven-sh/bun/issues/23092
// Regression probe for the "range start index N out of range for slice of
// length M" panic in HTTPClient::header_str. The StringPointer offsets in
// header_entries can desync from header_buf when the (bitwise-shared)
// MultiArrayList backing is freed or reused while the TLS handshake is still
// in flight. Run many concurrent HTTPS requests with varying header shapes
// and abort a subset mid-handshake to maximise allocation churn on the HTTP
// thread; the child must not panic.
test("header_str does not panic on header_entries / header_buf desync under concurrent TLS load", async () => {
  const fixture = /* js */ `
    const tls = ${JSON.stringify(tlsCert)};

    // h1-only TLS server so build_request runs for every connection.
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      async fetch(req) {
        // Echo one request header so the whole pipeline is exercised.
        return new Response(req.headers.get("x-echo-0") ?? "");
      },
    });

    const url = \`https://127.0.0.1:\${server.port}/\`;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const ITER = 8;
    const FAN = 24;
    let totalOk = 0;

    for (let iter = 0; iter < ITER; iter++) {
      const jobs = [];
      const controllers = [];
      const expected = [];
      let successes = 0;
      for (let i = 0; i < FAN; i++) {
        // Vary header count/length so the MultiArrayList allocation size
        // differs between requests (encourages reuse of freed slots).
        const headers = {};
        const n = 1 + ((iter + i) % 9);
        for (let h = 0; h < n; h++) {
          headers["x-echo-" + h] = Buffer.alloc(8 + ((iter * 7 + i + h) % 40), 97 + (h % 26)).toString();
        }
        expected.push(headers["x-echo-0"]);
        const ac = new AbortController();
        controllers.push(ac);
        const idx = i;
        jobs.push(
          fetch(url, {
            headers,
            signal: ac.signal,
            tls: { rejectUnauthorized: false },
          })
            .then(async r => {
              const text = await r.text();
              if (text !== expected[idx]) {
                throw new Error(\`echo mismatch: got \${JSON.stringify(text)} want \${JSON.stringify(expected[idx])}\`);
              }
              successes++;
            })
            .catch(e => {
              // Only aborted requests may fail; anything else is a real error.
              if (e?.name !== "AbortError") throw e;
            }),
        );
      }
      // Abort ~a third of the requests immediately so some hit the handshake
      // window with a freed/aborted sibling churning the allocator.
      for (let i = 0; i < FAN; i += 3) controllers[i].abort();
      await Promise.all(jobs);
      if (successes === 0) {
        throw new Error("expected at least one non-aborted fetch to succeed in iteration " + iter);
      }
      totalOk += successes;
      Bun.gc(true);
    }

    server.stop(true);
    console.log("OK " + totalOk);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: expect.stringMatching(/^OK \d+$/),
    stderr: expect.any(String),
    exitCode: 0,
    signalCode: null,
  });
  // Two thirds of FAN are never aborted; all of those must round-trip with
  // the correct echoed header value. Aborted ones may also succeed if the
  // response beats the abort, so the count is in [128, 192].
  const totalOk = Number(stdout.trim().slice("OK ".length));
  expect(totalOk).toBeGreaterThanOrEqual(8 * (24 - Math.ceil(24 / 3)));
});
