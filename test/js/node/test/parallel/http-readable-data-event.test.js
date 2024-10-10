//#FILE: test-http-readable-data-event.js
//#SHA1: a094638e155550b5bc5ecdf5b11c54e8124d1dc1
//-----------------
"use strict";

const http = require("http");
const helloWorld = "Hello World!";
const helloAgainLater = "Hello again later!";

let next = null;

test("HTTP readable data event", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Length": `${helloWorld.length + helloAgainLater.length}`,
    });

    // We need to make sure the data is flushed
    // before writing again
    next = () => {
      res.end(helloAgainLater);
      next = () => {};
    };

    res.write(helloWorld);
  });

  await new Promise(resolve => server.listen(0, resolve));

  const opts = {
    hostname: "localhost",
    port: server.address().port,
    path: "/",
  };

  const expectedData = [helloWorld, helloAgainLater];
  const expectedRead = [helloWorld, null, helloAgainLater, null, null];

  await new Promise((resolve, reject) => {
    const req = http.request(opts, res => {
      res.on("error", reject);

      const readableSpy = jest.fn();
      res.on("readable", readableSpy);

      res.on("readable", () => {
        let data;

        do {
          data = res.read();
          expect(data).toBe(expectedRead.shift());
          next();
        } while (data !== null);
      });

      res.setEncoding("utf8");
      const dataSpy = jest.fn();
      res.on("data", dataSpy);

      res.on("data", data => {
        expect(data).toBe(expectedData.shift());
      });

      res.on("end", () => {
        expect(readableSpy).toHaveBeenCalledTimes(3);
        expect(dataSpy).toHaveBeenCalledTimes(2);
        server.close(() => resolve());
      });
    });

    req.end();
  });
});

//<#END_FILE: test-http-readable-data-event.js
