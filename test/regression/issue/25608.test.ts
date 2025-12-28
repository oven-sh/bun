import { test, expect } from "bun:test";

// https://github.com/oven-sh/bun/issues/25608
// Node.js http/https response callback not called in ShadowRealm

test("regression/issue/25608: http.request callback fires inside ShadowRealm", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });

  const url = `http://127.0.0.1:${server.port}/`;

  const realm = new ShadowRealm();
  realm.evaluate(`
    globalThis.__done = false;
    globalThis.__status = 0;
    globalThis.__err = "";

    import("http").then(http => {
      const req = http.request(${JSON.stringify(url)}, res => {
        globalThis.__status = res.statusCode;
        globalThis.__done = true;
        res.resume();
      });

      req.on("error", e => {
        globalThis.__err = String(e);
        globalThis.__done = true;
      });

      req.end();
    });

    1;
  `);

  for (let i = 0; i < 5000; i++) {
    if (realm.evaluate("globalThis.__done") === true) break;
    await Bun.sleep(0);
  }

  expect(realm.evaluate("globalThis.__err")).toBe("");
  expect(realm.evaluate("globalThis.__status")).toBe(200);
});
