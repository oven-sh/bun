async function execute(options, expected) {
  http
    .createServer((req, res) => {
      const expectHeaders = expected;

      // no Host header when you set headers an array
      if (!Array.isArray(options.headers)) {
        expectHeaders.host = `localhost:${this.address().port}`;
      }

      // no Authorization header when you set headers an array
      if (options.auth && !Array.isArray(options.headers)) {
        expectHeaders.authorization = `Basic ${Buffer.from(options.auth).toString("base64")}`;
      }

      if (typeof Bun !== "undefined") {
        // bun adds these headers by default
        expectHeaders["user-agent"] ??= `Bun/${Bun.version}`;
        expectHeaders["accept"] ??= "*/*";
      }

      this.close();

      assert.deepStrictEqual(req.headers, expectHeaders);

      res.writeHead(200, { "Connection": "close" });
      res.end();
    })
    .listen(0, () => {
      options = Object.assign(options, {
        port: this.address().port,
        path: "/",
      });
      const req = http.request(options);
      req.end();
    });
}

test("node tests", async () => {
  execute(
    { headers: { "x-foo": "boom", "cookie": "a=1; b=2; c=3" } },
    {
      "x-foo": "boom",
      "cookie": "a=1; b=2; c=3",
      "connection": "keep-alive",
      "host": "example.com",
    },
  );
  execute(
    { headers: { "x-foo": "boom", "cookie": ["a=1", "b=2", "c=3"] } },
    {
      "x-foo": "boom",
      "cookie": "a=1; b=2; c=3",
      "connection": "keep-alive",
      "host": "example.com",
    },
  );
  execute(
    {
      headers: [
        ["x-foo", "boom"],
        ["cookie", "a=1; b=2; c=3"],
        ["Host", "example.com"],
      ],
    },
    {
      "x-foo": "boom",
      "cookie": "a=1; b=2; c=3",
      "connection": "keep-alive",
      "host": "example.com",
    },
  );
  execute(
    {
      headers: [
        ["x-foo", "boom"],
        ["cookie", ["a=1", "b=2", "c=3"]],
        ["Host", "example.com"],
      ],
    },
    {
      "x-foo": "boom",
      "cookie": "a=1; b=2; c=3",
      "connection": "keep-alive",
      "host": "example.com",
    },
  );
  execute(
    {
      headers: [
        ["x-foo", "boom"],
        ["cookie", "a=1"],
        ["cookie", "b=2"],
        ["cookie", "c=3"],
        ["Host", "example.com"],
      ],
    },
    {
      "x-foo": "boom",
      "cookie": "a=1; b=2; c=3",
      "connection": "keep-alive",
      "host": "example.com",
    },
  );

  // Authorization and Host header both missing from the second
  execute({ auth: "foo:bar", headers: { "x-foo": "boom", "cookie": "a=1; b=2; c=3" } });
  execute({
    auth: "foo:bar",
    headers: [
      ["x-foo", "boom"],
      ["cookie", "a=1"],
      ["cookie", "b=2"],
      ["cookie", "c=3"],
      ["Host", "example.com"],
    ],
  });
});
test("added bun tests", async () => {});
