import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// https://github.com/oven-sh/bun/issues/12042: BUN_CONFIG_VERBOSE_FETCH=curl
// omitted --data-raw for application/x-www-form-urlencoded request bodies.
test("#12042 curl verbose fetch logs form-urlencoded body", async () => {
  const body = "grant_type=client_credentials&client_id=abc&client_secret=xyz";

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            return Response.json({ contentType: req.headers.get("content-type"), body: await req.text() });
          },
        });

        const params = new URLSearchParams(${JSON.stringify(body)});
        const explicitHeader = await fetch(server.url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        // No Content-Type header: fetch derives one from the URLSearchParams body.
        const derivedHeader = await fetch(server.url, { method: "POST", body: params });

        console.log(
          JSON.stringify({
            port: server.port,
            explicitHeader: await explicitHeader.json(),
            derivedHeader: await derivedHeader.json(),
          }),
        );

        // stop(true) also closes the uWS app, so the server is freed at exit.
        // After a graceful stop() it stays allocated and LeakSanitizer (ASAN
        // lane) spends ~15s symbolizing it just to match the suppressions.
        await server.stop(true);
      `,
    ],
    env: { ...bunEnv, BUN_CONFIG_VERBOSE_FETCH: "curl" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const { port, ...received } = JSON.parse(stdout);
  expect(received).toEqual({
    explicitHeader: { contentType: "application/x-www-form-urlencoded", body },
    derivedHeader: { contentType: "application/x-www-form-urlencoded;charset=UTF-8", body },
  });

  const curlLines = normalizeBunSnapshot(stderr)
    .replaceAll(`:${port}`, ":<port>")
    .split("\n")
    .filter(line => line.startsWith("curl "));
  expect(curlLines).toMatchInlineSnapshot(`
    [
      "curl --http1.1 "http://localhost:<port>/" -X POST -H "Content-Type: application/x-www-form-urlencoded" -H "Connection: keep-alive" -H "User-Agent: Bun/<bun-version>" -H "Accept: */*" -H "Host: localhost:<port>" -H "Accept-Encoding: gzip, deflate, br, zstd" --compressed -H "Content-Length: 61" --data-raw "grant_type=client_credentials&client_id=abc&client_secret=xyz"",
      "curl --http1.1 "http://localhost:<port>/" -X POST -H "Content-Type: application/x-www-form-urlencoded;charset=UTF-8" -H "Connection: keep-alive" -H "User-Agent: Bun/<bun-version>" -H "Accept: */*" -H "Host: localhost:<port>" -H "Accept-Encoding: gzip, deflate, br, zstd" --compressed -H "Content-Length: 61" --data-raw "grant_type=client_credentials&client_id=abc&client_secret=xyz"",
    ]
  `);

  expect(exitCode).toBe(0);
});
