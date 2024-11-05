//#FILE: test-http2-forget-closed-streams.js
//#SHA1: 2f917924c763cc220e68ce2b829c63dc03a836ab
//-----------------
"use strict";
const http2 = require("http2");

// Skip test if crypto is not available
const hasCrypto = (() => {
  try {
    require("crypto");
    return true;
  } catch (err) {
    return false;
  }
})();

(hasCrypto ? describe : describe.skip)("http2 forget closed streams", () => {
  let server;

  beforeAll(() => {
    server = http2.createServer({ maxSessionMemory: 1 });

    server.on("session", session => {
      session.on("stream", stream => {
        stream.on("end", () => {
          stream.respond(
            {
              ":status": 200,
            },
            {
              endStream: true,
            },
          );
        });
        stream.resume();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  test("should handle 10000 requests without memory issues", done => {
    const listenPromise = new Promise(resolve => {
      server.listen(0, () => {
        resolve(server.address().port);
      });
    });

    listenPromise.then(port => {
      const client = http2.connect(`http://localhost:${port}`);

      function makeRequest(i) {
        return new Promise(resolve => {
          const stream = client.request({ ":method": "POST" });
          stream.on("response", headers => {
            expect(headers[":status"]).toBe(200);
            stream.on("close", resolve);
          });
          stream.end();
        });
      }

      async function runRequests() {
        for (let i = 0; i < 10000; i++) {
          await makeRequest(i);
        }
        client.close();
      }

      runRequests()
        .then(() => {
          // If we've reached here without errors, the test has passed
          expect(true).toBe(true);
          done();
        })
        .catch(err => {
          done(err);
        });
    });
  }, 30000); // Increase timeout to 30 seconds
});

//<#END_FILE: test-http2-forget-closed-streams.js
