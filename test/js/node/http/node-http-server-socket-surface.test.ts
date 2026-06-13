import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// The net.Socket compatibility members shared by the server socket and
// FakeSocket (installSocketStubs in src/js/internal/http.ts). Every assertion
// here also holds for a request socket under real Node.
test("server request socket exposes the net.Socket compatibility surface", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
  const server = createServer((req, res) => {
    try {
      const s = req.socket;
      resolve({
        readyState: s.readyState,
        pending: s.pending,
        connecting: s.connecting,
        bufferSizeEqualsWritableLength: s.bufferSize === s.writableLength,
        refReturnsThis: s.ref() === s,
        unrefReturnsThis: s.unref() === s,
        setNoDelayReturnsThis: s.setNoDelay() === s,
        remoteAddressType: typeof s.remoteAddress,
        remotePortType: typeof s.remotePort,
        remoteFamilyIsIP: s.remoteFamily === "IPv4" || s.remoteFamily === "IPv6",
      });
    } catch (err) {
      reject(err);
    } finally {
      res.end("ok");
    }
  });
  try {
    await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    await res.text();
    expect(await promise).toEqual({
      readyState: "open",
      pending: false,
      connecting: false,
      bufferSizeEqualsWritableLength: true,
      refReturnsThis: true,
      unrefReturnsThis: true,
      setNoDelayReturnsThis: true,
      remoteAddressType: "string",
      remotePortType: "number",
      remoteFamilyIsIP: true,
    });
  } finally {
    server.close();
  }
});
