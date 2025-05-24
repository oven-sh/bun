import { expect, it } from "bun:test";
import { once } from "events";
import { tls as COMMON_CERT } from "harness";
import { AddressInfo } from "net";
import tls from "tls";

it("tls.connect should call custom lookup and connect successfully", async () => {
  let lookupCalled = false;

  const server = tls.createServer({
    cert: COMMON_CERT.cert,
    key: COMMON_CERT.key,
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  server.on("secureConnection", socket => {
    socket.end("ok");
  });

  function customLookup(host, opts, cb) {
    lookupCalled = true;
    cb(null, "127.0.0.1", 4);
  }

  await new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        port,
        host: "localhost",
        rejectUnauthorized: false,
        lookup: customLookup,
      },
      () => {
        expect(lookupCalled).toBe(true);
        socket.end();
        server.close();
        resolve(undefined);
      },
    );
    socket.on("error", err => {
      server.close();
      reject(err);
    });
  });
});
