import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When an awaited request handler resumes (via another request resolving its
// promise), the resumed request should still get a cork buffer so its
// writeHead+end go out as a single write instead of multiple syscalls.
// Previously the single shared cork buffer was held by the newer request,
// forcing the resumed request down the uncorked slow path.
test("resumed async handler writes are corked (nested cork buffer)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { createServer } from "node:http";

      let pending;
      let count = 0;
      const server = createServer(async (req, res) => {
        count++;
        if (pending) {
          const prev = pending;
          pending = Promise.withResolvers();
          prev.resolve();
        } else {
          pending = Promise.withResolvers();
        }
        // The last request resolves itself so it doesn't hang
        if (count === 20) pending.resolve();
        await pending.promise;
        res.writeHead(200, { "x-req": req.url });
        res.end("ok:" + req.url);
      }).listen(0, async () => {
        const port = server.address().port;
        const responses = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            fetch("http://localhost:" + port + "/" + i).then(r => r.text())
          )
        );
        console.log(JSON.stringify(responses.sort()));
        server.close();
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const expected = Array.from({ length: 20 }, (_, i) => `ok:/${i}`).sort();
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(expected);
  expect(exitCode).toBe(0);
});

test("Bun.serve: nested async responses are all correct", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let pending;
      let count = 0;
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          count++;
          const url = new URL(req.url);
          if (pending) {
            const prev = pending;
            pending = Promise.withResolvers();
            prev.resolve();
          } else {
            pending = Promise.withResolvers();
          }
          if (count === 20) pending.resolve();
          await pending.promise;
          return new Response("ok:" + url.pathname, {
            headers: { "x-path": url.pathname },
          });
        },
      });

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          fetch("http://localhost:" + server.port + "/" + i).then(async r => ({
            body: await r.text(),
            header: r.headers.get("x-path"),
          }))
        )
      );
      console.log(JSON.stringify(responses.sort((a,b) => a.body.localeCompare(b.body))));
      server.stop(true);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const expected = Array.from({ length: 20 }, (_, i) => ({
    body: `ok:/${i}`,
    header: `/${i}`,
  })).sort((a, b) => a.body.localeCompare(b.body));

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual(expected);
  expect(exitCode).toBe(0);
});
