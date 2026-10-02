import { expect, test } from "bun:test";
import http2 from "node:http2";

// node: "An object describing the current status of this Http2Session. If the Http2Session is no
// longer usable, an empty object is returned." Property access on the post-destroy value must not
// throw.
test("http2 session.state returns an empty object after destroy()", async () => {
  const server = http2.createServer();
  let serverSession: http2.ServerHttp2Session | undefined;
  server.on("session", session => {
    serverSession = session;
    session.on("error", () => {});
  });
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  await new Promise<void>(resolve => server.listen(0, resolve));
  try {
    const client = http2.connect(`http://localhost:${(server.address() as import("node:net").AddressInfo).port}`);
    client.on("error", () => {});
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const req = client.request({ ":path": "/" });
    req.on("error", reject);
    req.resume();
    req.on("close", resolve);
    await promise;

    expect(typeof client.state.effectiveLocalWindowSize).toBe("number");

    client.destroy();
    const clientState = client.state;
    expect(client.destroyed).toBe(true);
    expect(clientState).toEqual({});
    expect(() => clientState.effectiveLocalWindowSize).not.toThrow();

    expect(serverSession).toBeDefined();
    serverSession!.destroy();
    const serverState = serverSession!.state;
    expect(serverSession!.destroyed).toBe(true);
    expect(serverState).toEqual({});
    expect(() => serverState.effectiveLocalWindowSize).not.toThrow();
  } finally {
    server.close();
  }
});
