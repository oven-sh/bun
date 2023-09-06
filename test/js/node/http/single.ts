// @ts-nocheck
import {
  createServer,
  request,
  get,
  Agent,
  globalAgent,
  Server,
  validateHeaderName,
  validateHeaderValue,
} from "node:http";

function expect(v) {
  return {
    toBe(expected) {},
    toContain(expected) {},
  };
}

function wrapDone(cb) {
  const { promise, resolve: done } = Promise.withResolvers();

  cb(() => {
    setTimeout(() => {
      done();
    }, 100);
  });

  return promise;
}

function createDoneDotAll(done: DoneCb, globalTimeout?: number, timers: Timer[] = []) {
  let toComplete = 0;
  let completed = 0;
  const globalTimer = globalTimeout
    ? (timers.push(
        setTimeout(() => {
          console.log("Global Timeout");
          done(new Error("Timed out!"));
        }, globalTimeout),
      ),
      timers[timers.length - 1])
    : undefined;
  function createDoneCb(timeout?: number) {
    toComplete += 1;
    const timer =
      timeout !== undefined
        ? (timers.push(
            setTimeout(() => {
              console.log("Timeout");
              done(new Error("Timed out!"));
            }, timeout),
          ),
          timers[timers.length - 1])
        : timeout;
    return (result?: Error) => {
      if (timer) clearTimeout(timer);
      if (globalTimer) clearTimeout(globalTimer);
      if (result instanceof Error) {
        done(result);
        return;
      }
      completed += 1;
      if (completed === toComplete) {
        done();
      }
    };
  }
  return createDoneCb;
}

function listen(server: Server): Promise<URL> {
  return new Promise((resolve, reject) => {
    server.listen({ port: 0 }, (err, hostname, port) => {
      if (err) {
        reject(err);
      } else {
        resolve(new URL(`http://${hostname}:${port}`));
      }
    });
    setTimeout(() => reject("Timed out"), 5000);
  });
}

try {
  var server = createServer((req, res) => {
    expect(req.url).toBe("/hello?world");
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World");
  });
  const url = await listen(server);
  const res = await fetch(new URL("/hello?world", url));
  expect(await res.text()).toBe("Hello World");
} catch (e) {
  throw e;
} finally {
  server.close();
}

try {
  const bodyBlob = new Blob(["hello world", "hello world".repeat(9000)]);
  const input = await bodyBlob.text();

  var server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    req.on("data", chunk => {
      res.write(chunk);
    });

    req.on("end", () => {
      res.end();
    });
  });
  const url = await listen(server);
  const res = await fetch(url, {
    method: "POST",
    body: bodyBlob,
  });

  const out = await res.text();
  expect(out).toBe(input);
} finally {
  server.close();
}

try {
  const bodyBlob = new Blob(["hello world", "hello world".repeat(4)]);

  const input = await bodyBlob.text();

  var server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    req.on("data", chunk => {
      res.write(chunk);
    });

    req.on("end", () => {
      res.end();
    });
  });
  const url = await listen(server);
  const res = await fetch(url, {
    method: "POST",
    body: bodyBlob,
  });

  const out = await res.text();
  expect(out).toBe(input);
} finally {
  server.close();
}

{
  const server = createServer();
  const listenResponse = server.listen(0);
  expect(listenResponse instanceof Server).toBe(true);
  expect(listenResponse).toBe(server);
  listenResponse.close();
}

function runTest(callback: (server: Server, port: number, done: (err?: Error) => void) => void) {
  const { promise, resolve: done } = Promise.withResolvers();
  var timer;
  var server = createServer((req, res) => {
    const reqUrl = new URL(req.url!, `http://${req.headers.host}`);
    if (reqUrl.pathname) {
      if (reqUrl.pathname === "/redirect") {
        // Temporary redirect
        res.writeHead(301, {
          Location: `http://localhost:${server.port}/redirected`,
        });
        res.end("Got redirect!\n");
        return;
      }
      if (reqUrl.pathname === "/redirected") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      if (reqUrl.pathname === "/lowerCaseHeaders") {
        res.writeHead(200, { "content-type": "text/plain", "X-Custom-Header": "custom_value" });
        res.end("Hello World");
        return;
      }
      if (reqUrl.pathname.includes("timeout")) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          res.end("Hello World");
          timer = null;
        }, 3000);
        return;
      }
      if (reqUrl.pathname === "/pathTest") {
        res.end("Path correct!\n");
        return;
      }
      if (reqUrl.pathname === "/customWriteHead") {
        function createWriteHead(prevWriteHead, listener) {
          let fired = false;
          return function writeHead() {
            if (!fired) {
              fired = true;
              listener.call(this);
            }
            return prevWriteHead.apply(this, arguments);
          };
        }

        function addPoweredBy() {
          if (!this.getHeader("X-Powered-By")) {
            this.setHeader("X-Powered-By", "Bun");
          }
        }

        res.writeHead = createWriteHead(res.writeHead, addPoweredBy);
        res.setHeader("Content-Type", "text/plain");
        res.end("Hello World");
        return;
      }
      if (reqUrl.pathname === "/uploadFile") {
        let requestData = Buffer.alloc(0);
        req.on("data", chunk => {
          requestData = Buffer.concat([requestData, chunk]);
        });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.write(requestData);
          res.end();
        });
        return;
      }
    }

    res.writeHead(200, { "Content-Type": "text/plain" });

    if (req.headers["x-test"]) {
      res.write(`x-test: ${req.headers["x-test"]}\n`);
    }

    // Check for body
    if (req.method === "POST") {
      req.on("data", chunk => {
        res.write(chunk);
      });

      req.on("end", () => {
        res.write("POST\n");
        res.end("Hello World");
      });
    } else {
      if (req.headers["X-Test"] !== undefined) {
        res.write(`X-Test: test\n`);
      }
      res.write("Maybe GET maybe not\n");
      res.end("Hello World");
    }
  });
  server.listen({ port: 0 }, (_, __, port) => {
    var _done = (...args) => {
      server.close();
      done(...args);
    };
    callback(server, port, _done);
  });

  return promise;
}

await runTest((server, port, done) => {
  const req = request(`http://localhost:${port}`, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(data).toBe("Maybe GET maybe not\nHello World");
      done();
    });
    res.on("error", err => done(err));
  });
  req.end();
});

await wrapDone(done => {
  const req = request("https://example.com", { headers: { "accept-encoding": "identity" } }, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(data).toContain("This domain is for use in illustrative examples in documents");
      done();
    });
    res.on("error", err => done(err));
  });
  req.end();
});

await runTest((server, serverPort, done) => {
  const req = request({ host: "localhost", port: serverPort, method: "POST" }, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(data).toBe("POST\nHello World");
      done();
    });
    res.on("error", err => done(err));
  });
  req.end();
});

await runTest((server, port, done) => {
  const req = request({ host: "localhost", port, method: "POST" }, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(data).toBe("Posting\nPOST\nHello World");
      done();
    });
    res.on("error", err => done(err));
  });
  req.write("Posting\n");
  req.end();
});

await runTest((server, port, done) => {
  const req = request(`http://localhost:${port}`);
  req.setSocketKeepAlive(true, 1000);
  req.end();
  expect(true).toBe(true);
  done();
});

await runTest((server, serverPort, done) => {
  const createDone = createDoneDotAll(done);
  const req1Done = createDone();
  const req2Done = createDone();

  const req1 = request(
    {
      host: "localhost",
      port: serverPort,
      path: "/timeout",
      timeout: 500,
    },
    res => {
      req1Done(new Error("Should not have received response"));
    },
  );
  req1.on("timeout", () => req1Done());

  const req2 = request(
    {
      host: "localhost",
      port: serverPort,
      path: "/timeout",
    },
    res => {
      req2Done(new Error("Should not have received response"));
    },
  );

  req2.setTimeout(500, () => {
    req2Done();
  });
  req1.end();
  req2.end();
});

await runTest((server, serverPort, done) => {
  const createDone = createDoneDotAll(done);
  const req1Done = createDone();
  const req2Done = createDone();

  const req1 = request(`http://localhost:${serverPort}/pathTest`, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(data).toBe("Path correct!\n");
      req1Done();
    });
    res.on("error", err => req1Done(err));
  });

  const req2 = request(`http://localhost:${serverPort}`, { path: "/pathTest" }, res => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", chunk => {
      data += chunk;
    });
    res.on("end", () => {
      expect(data).toBe("Path correct!\n");
      req2Done();
    });
    res.on("error", err => req2Done(err));
  });

  req1.end();
  req2.end();

  expect(req1.path).toBe("/pathTest");
  expect(req2.path).toBe("/pathTest");
});

console.log("i made it");
