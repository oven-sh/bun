import tls from "node:tls";

tls.getCiphers()[0];

tls.connect({
  host: "localhost",
  port: 80,
  ca: "asdf",
  cert: "path to cert",
});

tls.connect({
  host: "localhost",
  port: 80,
  ca: Bun.file("asdf"),
  cert: Bun.file("path to cert"),
  ciphers: "adsf",
});

tls.connect({
  host: "localhost",
  port: 80,
  ca: Buffer.from("asdf"),
  cert: Buffer.from("asdf"),
});

tls.connect({
  host: "localhost",
  port: 80,
  ca: new Uint8Array([1, 2, 3]),
  cert: new Uint8Array([1, 2, 3]),
});

// Both specifiers take Bun's options and keep Node's own overloads.
import * as bareTls from "tls";
import { expectType } from "./utilities";

bareTls.connect({ host: "localhost", port: 80, ca: Bun.file("asdf") });
expectType(bareTls.connect(443, "localhost", { servername: "localhost" })).is<tls.TLSSocket>();
expectType(tls.connect(443, "localhost", { servername: "localhost" })).is<bareTls.TLSSocket>();
