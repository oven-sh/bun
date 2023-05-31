import { expect, test, describe } from "bun:test";

test("uploads roundtrip", async () => {
  const body = Bun.file(import.meta.dir + "/fetch.js.txt");
  const bodyText = await body.text();

  const server = Bun.serve({
    port: 0,
    development: false,
    async fetch(req) {
      const text = await req.text();
      expect(text).toBe(bodyText);

      return new Response(Bun.file(import.meta.dir + "/fetch.js.txt"));
    },
  });

  // @ts-ignore
  const reqBody = new Request(`http://${server.hostname}:${server.port}`, {
    body,
    method: "POST",
  });
  const res = await fetch(reqBody);
  expect(res.status).toBe(200);

  // but it does for Response
  expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
  const resText = await res.text();
  expect(resText).toBe(bodyText);

  server.stop(true);
});

test("missing file throws the expected error", async () => {
  const body = Bun.file(import.meta.dir + "/fetch123123231123.js.txt");

  const reqBody = new Request(`http://example.com`, {
    body,
    method: "POST",
  });
  const resp = fetch(reqBody);
  expect(Bun.peek.status(resp)).toBe("rejected");
  expect(async () => await resp).toThrow("No such file or directory");
});
