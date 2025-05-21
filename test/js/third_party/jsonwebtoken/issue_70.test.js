import { describe, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("issue 70 - public key start with BEING PUBLIC KEY", function () {
  it("should work", function (done) {
    var fs = require("fs");
    var cert_pub = fs.readFileSync(__dirname + "/rsa-public.pem");
    var cert_priv = fs.readFileSync(__dirname + "/rsa-private.pem");

    var token = jwt.sign({ foo: "bar" }, cert_priv, { algorithm: "RS256" });

    jwt.verify(token, cert_pub, done);
  });
});
