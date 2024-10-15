import * as http from "node:http";

const options = {
  hostname: "www.example.com",
  port: 80,
  path: "/",
  method: "GET",
  headers: {},
};

const req = http.request(options, res => {
  patchEmitter(res, "res");
  console.log(`"STATUS: ${res.statusCode}"`);
  res.setEncoding("utf8");
});
patchEmitter(req, "req");

req.end();

function patchEmitter(emitter, prefix) {
  var oldEmit = emitter.emit;

  emitter.emit = function () {
    if (typeof arguments[0] !== "symbol") {
      console.log([prefix, arguments[0]]);
    }

    oldEmit.apply(emitter, arguments);
  };
}
