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

async function server() {
  const { promise, resolve, reject } = Promise.withResolvers();

  const server = http.createServer((req, res) => {
    // Set response headers
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("X-Powered-By", "Node.js");
    res.setHeader("Cache-Control", ["no-cache", "yes-cache"]);
    res.appendHeader("Cache-Control", "maybe-cache");
    res.appendHeader("Cache-Control", ["please-cache", "please-dont-cache"]);
    res.setHeader("Set-Cookie", ["a=b", "c=d"]);
    res.appendHeader("Set-Cookie", "e=f");
    res.appendHeader("Set-Cookie", ["g=h", "i=j"]);
    res.setHeader("Abc", ["list-one", "list-two"]);
    res.setHeader("Abc", ["list-three", "list-four"]);

    // Write response
    res.statusCode = 200;
    res.end("Hello World\n");
  });

  const PORT = 0;
  server.listen(PORT, async () => {
    const port = server.address().port;
    console.log(`Server running`);

    // Test the server response headers using fetch
    try {
      const response = await fetch(`http://localhost:${port}/`);
      console.log("Response status: " + response.status);

      // Check headers
      console.log("Headers test results:");
      for (const [key, value] of [...response.headers.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (key === "date") continue;
        if (key === "keep-alive") continue;
        if (key === "connection") continue;
        console.log(`${key}: ${value}`);
      }

      const body = await response.text();
      console.log("Body:", body);
      resolve();
    } catch (error) {
      console.error("Error testing server:", error);
      reject(error);
    } finally {
      // Uncomment to close server after test
      // server.close();
    }
  });
  await promise;
  server.close();
}
console.log("%<test>server</test>");
await server();
