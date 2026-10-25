// The server and the client of "a HEADERS frame that has no connection credit waits for it". They are two
// processes so that the client can block its thread: it then sends no ACK and no MAX_DATA while the server writes.
//
//   server <key> <cert> <flight>
//   client <port> <flight> <streams> <connection window>
//
// <flight> says what the server sends while the client is blocked, and so where its last packet ends:
//   "bodies"               The response headers went out before. The last packet ends inside a body, so a part of
//                          that body is in a packet and its DATA frame has a length.
//   "headers-and-bodies"   The last packet ends inside a header block, so the body behind it is in no packet yet.
import { createPrivateKey } from "node:crypto";
import { readFileSync, readSync, writeSync } from "node:fs";
import { connect, listen, type SessionOptions } from "node:quic";

const print = (line: string) => void writeSync(1, line + "\n");
const flight = process.argv[2] === "server" ? process.argv[5] : process.argv[4];
// "X" has an 8-bit Huffman code, so QPACK sends such a value as it is. No packet holds a whole number of these
// header blocks or bodies, so a flight ends inside one of them.
const responseHeaders = (i: number) =>
  flight === "bodies"
    ? { ":status": "200" }
    : { ":status": "200", "x-filler": Buffer.alloc(480 + (i % 5) * 9, "X").toString() };
const bodySize = (i: number) => (flight === "bodies" ? 380 + (i % 5) * 9 : 30);
// The first size fits into a stream's buffer in lsquic next to nothing else. The second size does not fit into it.
const trailerSizes = [1100, 1400];
const [trailers, trailersForAPacket] = trailerSizes.map(size => ({ "x-filler": Buffer.alloc(size, "X").toString() }));

if (process.argv[2] === "server") {
  const [keyPath, certPath] = process.argv.slice(3);
  const responses: [stream: any, i: number][] = [];
  const wantTrailers: any[] = [];
  let creditIsUsedUp = false;
  const endpoint = await listen(
    session => {
      session.onerror = () => {};
      session.closed.catch(() => {});
      session.onstream = (stream: any) => void stream.closed.catch(() => {});
    },
    {
      sni: { "*": { keys: [createPrivateKey(readFileSync(keyPath))], certs: [readFileSync(certPath)] } },
      transportParams: { maxIdleTimeout: 20, initialMaxStreamsBidi: 1000 },
      onheaders(this: any, headers: Record<string, string>) {
        const path = headers[":path"];
        // The client sends this after every other request, and waits for the answer.
        if (path === "/sync") return void this.sendHeaders({ ":status": "204" }, { terminal: true });
        if (path !== "/go") {
          const i = Number(path.slice(1));
          if (flight === "bodies") this.sendHeaders(responseHeaders(i));
          responses.push([this, i]);
          return;
        }
        // The client's last request. Its packet acknowledged everything that the server sent, and the client reads
        // nothing from now on. One pass of the engine writes the whole flight: more than the congestion window
        // holds, so the window fills and stays full.
        const { stats } = this.session;
        const sentBefore = stats.bytesSent;
        const lostBefore = stats.pktLost;
        for (const [stream, i] of responses) {
          if (flight !== "bodies") stream.sendHeaders(responseHeaders(i));
          stream.writer.writeSync(Buffer.alloc(bodySize(i), "b"));
          stream.writer.endSync();
        }
        const useUpTheCredit = () => {
          // lsquic probes twice for a lost packet and then takes every packet for lost. After that it holds the rest
          // of the flight back, so the window does not fill on a machine that is this slow.
          const flightIsOver = stats.bytesSent - sentBefore + 4096n >= stats.cwnd || stats.pktLost - lostBefore > 2n;
          if (!flightIsOver) return void setImmediate(useUpTheCredit);
          const sent = wantTrailers.splice(0);
          // The last response of the flight has the end of its message in lsquic's buffer.
          const last = sent.pop();
          // lsquic keeps up to 10 packets for a connection that may not send. These trailers fill them.
          for (const stream of sent.splice(0, 16)) stream.sendTrailers(trailers);
          // Now there is no packet, and these trailers need one: they wait outside of the stream's buffer, while the
          // connection still has credit. The priority puts this stream first when the client's ACK gives packets.
          last?.setPriority({ level: "high" });
          last?.sendTrailers(trailersForAPacket);
          // The trailers of the other responses go to their streams' buffers and take all the credit that is left.
          for (const stream of sent) stream.sendTrailers(trailers);
          creditIsUsedUp = true;
          print("ready");
        };
        useUpTheCredit();
      },
      onwanttrailers(this: any) {
        if (creditIsUsedUp) this.sendTrailers(trailers);
        else wantTrailers.push(this);
      },
    },
  );
  print(String(endpoint.address!.port));
} else {
  const [port, , streams, window] = process.argv.slice(3).map(Number);
  const session = await connect(
    { address: "127.0.0.1", port } as any,
    {
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 20, initialMaxData: window },
      onerror() {},
    } as SessionOptions,
  );
  let sessionError: string | undefined;
  session.closed.catch(error => void (sessionError = String(error?.message ?? error)));
  await session.opened;
  const request = (path: string) => ({
    ":method": "GET",
    ":path": path,
    ":scheme": "https",
    ":authority": "localhost",
  });
  const responses = Array.from({ length: streams }, async (_, i) => {
    const response: { bytes: number; trailers?: number; failed?: string } = { bytes: 0 };
    try {
      const stream: any = await session.createBidirectionalStream({
        headers: request(`/${i}`),
        onheaders() {},
        ontrailers: (received: Record<string, string>) => void (response.trailers = received["x-filler"]?.length),
      } as any);
      for await (const batch of stream) for (const chunk of batch) response.bytes += chunk.byteLength;
      await stream.closed;
    } catch (error: any) {
      response.failed = String(error?.code ?? error);
    }
    return response;
  });
  // The server has every request when it answers this one.
  const synced = Promise.withResolvers<void>();
  const sync: any = await session.createBidirectionalStream({
    headers: request("/sync"),
    onheaders: () => synced.resolve(),
  } as any);
  sync.closed.catch(() => {});
  session.closed.then(synced.resolve, synced.resolve);
  await synced.promise;
  const go: any = await session.createBidirectionalStream({ headers: request("/go") } as any);
  go.closed.catch(() => {});
  // The request leaves when the node:quic callback that resumed this code returns.
  await new Promise(resolve => setImmediate(resolve));
  // Nothing that arrives is read, and nothing is acknowledged, until the test writes a byte.
  if (readSync(0, new Uint8Array(1)) === 0) throw new Error("the test closed stdin");
  const wrong = (await Promise.all(responses))
    .map((response, i) => ({ stream: i, ...response }))
    .filter(
      ({ stream, failed, bytes, trailers }) =>
        failed || bytes !== bodySize(stream) || !trailerSizes.includes(trailers!),
    );
  // The server never answers the last request, so there is no graceful close to wait for.
  print(JSON.stringify({ wrong, sessionError }));
  process.exit(0);
}
