// Node peer for "fetch rejects when the server renegotiates TLS 1.2 on an HTTP/2
// connection" in fetch-http2-client.test.ts. It has to be Node: BoringSSL cannot
// start a renegotiation from the server side.
//
// It speaks just enough HTTP/2 to get a request, which it answers with a
// renegotiation and nothing else. The first line on stdout is the port.
import tls from "node:tls";

const frame = (type, flags) => Buffer.from([0, 0, 0, type, flags, 0, 0, 0, 0]);
const SETTINGS = 4;
const HEADERS = 1;
const ACK = 1;

const server = tls.createServer(
  { key: process.env.SERVER_KEY, cert: process.env.SERVER_CERT, maxVersion: "TLSv1.2", ALPNProtocols: ["h2"] },
  socket => {
    socket.on("error", () => {});
    socket.write(frame(SETTINGS, 0));
    let buffered = Buffer.alloc(0);
    let preface = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n".length;
    // BoringSSL fails a renegotiation that has application data in the middle of it. A write
    // can end after write() returns (it does on Windows), and would then follow the HelloRequest.
    let requested = false;
    let flushed = false;
    const renegotiateWhenIdle = () => {
      if (requested && flushed) socket.renegotiate({}, () => {});
    };
    socket.on("data", chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < preface) return;
      buffered = buffered.subarray(preface);
      preface = 0;
      while (buffered.length >= 9 && buffered.length >= 9 + buffered.readUIntBE(0, 3)) {
        const [type, flags] = buffered.subarray(3, 5);
        buffered = buffered.subarray(9 + buffered.readUIntBE(0, 3));
        if (type === SETTINGS && !(flags & ACK)) {
          socket.write(frame(SETTINGS, ACK), () => {
            flushed = true;
            renegotiateWhenIdle();
          });
        }
        if (type === HEADERS) {
          requested = true;
          renegotiateWhenIdle();
        }
      }
    });
  },
);
server.on("tlsClientError", () => {});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
