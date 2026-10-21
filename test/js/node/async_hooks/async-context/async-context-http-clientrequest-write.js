process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");
const net = require("net");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

let checked = 0;
function expectStore(what, expected) {
  checked++;
  const store = asyncLocalStorage.getStore();
  if (store !== expected) {
    console.error(`FAIL: ${what} ran in ${JSON.stringify(store)}, expected ${JSON.stringify(expected)}`);
    failed = true;
  }
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// More than the kernel takes in one call while the peer does not read: the write has to wait for the socket.
const big = Buffer.alloc(8 * 1024 * 1024);

// Speaks HTTP by hand: it answers each request once all of its body came.
let peerSocket;
const peer = net.createServer(socket => {
  peerSocket = socket;
  let head = "";
  let bodyLeft = -1;
  socket.on("error", () => {});
  socket.on("data", chunk => {
    if (bodyLeft < 0) {
      head += chunk.toString("latin1");
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) return;
      bodyLeft = Number(/content-length: (\d+)/i.exec(head)[1]) - (Buffer.byteLength(head, "latin1") - (end + 4));
      head = "";
    } else {
      bodyLeft -= chunk.length;
    }
    if (bodyLeft === 0) {
      bodyLeft = -1;
      socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
    }
  });
});

peer.listen(0, "127.0.0.1", () => {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const options = { agent, port: peer.address().port, host: "127.0.0.1", method: "POST" };

  // The first request opens the connection, in a context of its own.
  asyncLocalStorage.run("first request", () => {
    const first = http.request({ ...options, headers: { "Content-Length": 5 } }, response => {
      response.resume();
    });
    first.on("error", err => fail(`the first request reported ${err.code}`));
    first.end("hello");
  });

  // The second request goes out on that connection, once the Agent has it back.
  agent.once("free", () => {
    peerSocket.pause();
    const second = asyncLocalStorage.run("second request", () =>
      http.request({ ...options, headers: { "Content-Length": 2 * big.length } }, response => {
        response.resume();
        response.on("end", () => {
          if (checked !== 4) console.error(`FAIL: ${checked} of 4 callbacks ran`);
          agent.destroy();
          peer.close();
          process.exit(failed || checked !== 4 ? 1 : 0);
        });
      }),
    );
    second.on("error", err => fail(`the second request reported ${err.code}`));
    second.on("drain", () => {
      expectStore("'drain' of a request whose write waited on a reused connection", "write");
      asyncLocalStorage.run("end", () =>
        second.end(big, () => {
          expectStore("the callback of a request end(chunk) that waited on a reused connection", "end");
        }),
      );
    });
    second.on("finish", () => {
      expectStore("'finish' of a request whose end(chunk) waited on a reused connection", "end");
    });
    // A turn of the loop after 'socket': a write in the tick of 'socket' gets its 'drain' from the flush of the
    // request's own buffer, before the socket has taken anything (nodejs/node#64991).
    second.once("socket", () =>
      setImmediate(() => {
        asyncLocalStorage.run("write", () =>
          second.write(big, () => {
            expectStore("the callback of a request write that waited on a reused connection", "write");
          }),
        );
        // Windows takes a write of any size at once. Anywhere else, a write that did not wait tests nothing.
        if (second.writableLength === 0 && process.platform !== "win32") {
          fail("the request's write did not wait for the socket");
        }
        peerSocket.resume();
      }),
    );
  });
});
