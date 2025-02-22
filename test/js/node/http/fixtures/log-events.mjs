import * as http from "node:http";

let server = http.createServer((req, res) => {
  res.end("Hello, World!");
});
server.listen(0, "localhost", 0, () => {
  const options = {
    hostname: "localhost",
    port: server.address().port,
    path: "/",
    method: "GET",
    headers: {},
  };

  const req = http.request(options, res => {
    patchEmitter(res, "res");
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding("utf8");
  });
  patchEmitter(req, "req");

  req.end().once("close", () => {
    setTimeout(() => {
      server.close();
    }, 1);
  });

  function patchEmitter(emitter, prefix) {
    var oldEmit = emitter.emit;

    emitter.emit = function () {
      console.log([prefix, arguments[0]]);
      oldEmit.apply(emitter, arguments);
    };
  }
});
