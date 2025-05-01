import http from "node:http";

async function execute(test_name, options) {
  console.log("%<test>" + test_name + "</test>");
  const { promise, resolve, reject } = Promise.withResolvers();
  http
    .createServer(function (req, res) {
      if (typeof Bun !== "undefined") {
        // bun adds these headers by default
        if (req.headers["user-agent"] === `Bun/${Bun.version}`) {
          delete req.headers["user-agent"];
        }
        if (req.headers["accept"] === "*/*") {
          delete req.headers["accept"];
        }
      }

      this.close();

      console.log(
        JSON.stringify(
          Object.fromEntries(Object.entries(req.headers).sort((a, b) => a[0].localeCompare(b[0]))),
        ).replaceAll('"', "'"),
      );

      res.writeHead(200, { "Connection": "close" });
      res.end();
    })
    .listen(0, function () {
      options = Object.assign(options, {
        port: this.address().port,
        path: "/",
      });
      const req = http.request(options);
      req.end();
      req.on("response", rsp => {
        console.log("-> " + rsp.statusCode);
        resolve();
      });
    });
  await promise;
}

await execute("headers array in object", {
  headers: {
    "a": "one",
    "b": ["two", "three"],
    "cookie": ["four", "five", "six"],
    "Host": "example.com",
  },
});

await execute("multiple of same header in array", {
  headers: [
    ["a", "one"],
    ["b", "two"],
    ["b", "three"],
    ["cookie", "four"],
    ["cookie", "five"],
    ["cookie", "six"],
    ["Host", "example.com"],
  ],
});

await execute("multiple of same header in array 2", {
  headers: [
    ["a", "one"],
    ["b", ["two", "three"]],
    ["cookie", ["four", "five"]],
    ["cookie", "six"],
    ["Host", "example.com"],
  ],
});

await execute("multiple of same header in array 3", {
  headers: [
    ["a", "one"],
    ["b", "two"],
    ["b", "three"],
    ["cookie", ["four", "five", "six"]],
    ["Host", "example.com"],
  ],
});

await execute("multiple of same header in flat array", {
  headers: [
    "a",
    "one",
    "b",
    "two",
    "b",
    "three",
    "cookie",
    "four",
    "cookie",
    "five",
    "cookie",
    "six",
    "Host",
    "example.com",
  ],
});

await execute("arrays of headers in flat array", {
  headers: ["a", "one", "b", ["two", "three"], "cookie", ["four", "five"], "cookie", "six", "Host", "example.com"],
});

await execute("set user agent and accept", {
  headers: {
    "abc": "def",
    "user-agent": "my new user agent",
    "accept": "text/html",
    "host": "example.com",
  },
});

await execute("set user agent and accept (array 1)", {
  headers: [
    ["user-agent", "my new user agent"],
    ["accept", "text/html"],
    ["host", "example.com"],
  ],
});

await execute("set user agent and accept (flat array)", {
  headers: ["user-agent", "my new user agent", "accept", "text/html", "host", "example.com"],
});
