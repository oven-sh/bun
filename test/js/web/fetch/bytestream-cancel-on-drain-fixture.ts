// Deterministic repro for the ByteStream::on_data re-entrancy panic: park a
// native buffering action (body.text()) on a streaming fetch response, swap
// the stream's producer for the internal-for-testing handle whose drain
// signal re-enters on_cancel, then sever the connection so the fetch tasklet
// delivers Err straight to on_data (unlike abort, this path does not error
// the JS stream first, so the action is still parked). on_data(Err) used to
// run signal_drained() with the action still in its cell; the re-entrant
// on_cancel consumed (rejected) it, and the unwrap() that followed aborted
// the whole process.
import { byteStreamInternals } from "bun:internal-for-testing";
import net from "node:net";
import type { AddressInfo } from "node:net";

const sockets: net.Socket[] = [];
const server = net.createServer(s => {
  sockets.push(s);
  // Headers only: no body chunk is ever delivered, so the Err below is the
  // first and only on_data call, independent of delivery timing.
  s.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n");
});
const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
server.listen(0, "127.0.0.1", onListening);
await listening;
const port = (server.address() as AddressInfo).port;

const res = await fetch(`http://127.0.0.1:${port}/`);
const body = res.body!;
const text = body.text(); // parks a BufferAction on the ByteStream
byteStreamInternals.cancelOnDrain(body);

// Sever the connection mid-stream: the tasklet fails the body with an error
// delivered to ByteStream::on_data while the buffer action is still parked.
for (const s of sockets) s.destroy();

const outcome = await text.then(
  () => "resolved",
  e => `rejected:${(e as Error)?.name}`,
);
console.log(outcome);
server.close();
