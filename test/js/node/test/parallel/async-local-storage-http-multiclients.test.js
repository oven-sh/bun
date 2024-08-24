//#FILE: test-async-local-storage-http-multiclients.js
//#SHA1: adf8feaec8fa034cbb22fd0f3e2a5ed224c1905e
//-----------------
"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const http = require("http");

const NUM_CLIENTS = 10;

// Run multiple clients that receive data from a server
// in multiple chunks, in a single non-closure function.
// Use the AsyncLocalStorage (ALS) APIs to maintain the context
// and data download. Make sure that individual clients
// receive their respective data, with no conflicts.

describe("AsyncLocalStorage with multiple HTTP clients", () => {
  const cls = new AsyncLocalStorage();
  let server;
  let index = 0;

  beforeAll(() => {
    // Set up a server that sends large buffers of data, filled
    // with cardinal numbers, increasing per request
    server = http.createServer((q, r) => {
      // Send a large chunk as response, otherwise the data
      // may be sent in a single chunk, and the callback in the
      // client may be called only once, defeating the purpose of test
      r.end((index++ % 10).toString().repeat(1024 * 1024));
    });
  });

  afterAll(() => {
    server.close();
  });

  it("should handle multiple clients correctly", async () => {
    const clientPromises = [];

    await new Promise(resolve => {
      server.listen(0, resolve);
    });

    for (let i = 0; i < NUM_CLIENTS; i++) {
      clientPromises.push(
        new Promise(resolve => {
          cls.run(new Map(), () => {
            const options = { port: server.address().port };
            const req = http.get(options, res => {
              const store = cls.getStore();
              store.set("data", "");

              // Make ondata and onend non-closure
              // functions and fully dependent on ALS
              res.setEncoding("utf8");
              res.on("data", ondata);
              res.on("end", () => {
                onend();
                resolve();
              });
            });
            req.end();
          });
        }),
      );
    }

    await Promise.all(clientPromises);
  });

  // Accumulate the current data chunk with the store data
  function ondata(d) {
    const store = cls.getStore();
    expect(store).not.toBeUndefined();
    let chunk = store.get("data");
    chunk += d;
    store.set("data", chunk);
  }

  // Retrieve the store data, and test for homogeneity
  function onend() {
    const store = cls.getStore();
    expect(store).not.toBeUndefined();
    const data = store.get("data");
    expect(data).toBe(data[0].repeat(data.length));
  }
});

//<#END_FILE: test-async-local-storage-http-multiclients.js
