// Wraps a net.Socket in a TLS socket. Then the net.Socket fails.
// TRANSPORT=net: a connected TCP socket. The TLS socket adopts its fd.
// TRANSPORT=connecting: a TCP socket that is still connecting at the wrap. The same, once it is connected.
// TRANSPORT=queued: a TCP socket with unflushed writes. TRANSPORT=tls: a TLS socket.
// The stream-level TLS engine runs over these two.
// SIDE=client wraps with tls.connect({ socket }), SIDE=server with
// new tls.TLSSocket(socket, { isServer: true }).
// WHEN=early destroys the transport with an error in the tick of the wrap. The peer never answers.
// WHEN=late destroys it once the handshake is done.
// WHEN=reset (SIDE=client): the peer resets the TCP connection once the handshake is done.
// LISTEN says which sockets get an 'error' listener: tls (the default), raw, both, none.
// LISTEN=before is both, with the transport's listener attached ahead of the wrap.
// LISTEN=once is a once() on the transport alone, attached ahead of the wrap.
// Prints the events of the TLS socket, and the transport's 'error' when it is listened for.
// KEY and CERT come from the test. Importing "harness" here costs each run
// about a second of startup on a debug build.
import net from "node:net";
import tls from "node:tls";

const { SIDE: side, TRANSPORT: transport, WHEN: when, LISTEN: listen = "tls", KEY: key, CERT: cert } = process.env;
const seen: string[] = [];
process.on("exit", () => console.log(seen.join("|")));

const sockets: net.Socket[] = [];
// What WHEN=reset resets: the peer's end of the TCP connection.
let peerTcp: net.Socket;

function wrap(raw: net.Socket) {
  if (transport === "queued") {
    raw.cork();
    raw.write("unflushed");
  }
  const onRawError = (err: Error) => seen.push(`raw error:${err.message}`);
  if (listen === "before") raw.on("error", onRawError);
  if (listen === "once") raw.once("error", onRawError);
  const socket =
    side === "client"
      ? tls.connect({ socket: raw, rejectUnauthorized: false })
      : new tls.TLSSocket(raw, { isServer: true, key, cert });
  sockets.push(raw, socket);
  socket.on("_tlsError", err => seen.push(`_tlsError:${err.message}`));
  if (listen === "tls" || listen === "both" || listen === "before") {
    socket.on("error", err => seen.push(`error:${err.message}`));
  }
  if (listen === "raw" || listen === "both") raw.on("error", onRawError);
  socket.on("close", hadError => {
    seen.push(`close:${hadError}`);
    listener.close();
    for (const each of sockets) each.destroy();
  });
  socket.resume();
  const kill = () => raw.destroy(new Error("transport failed"));
  if (when === "early") kill();
  else if (when === "late") socket.once(side === "client" ? "secureConnect" : "secure", kill);
}

function answer(raw: net.Socket) {
  sockets.push(raw);
  raw.on("error", () => {});
  if (when === "early") return raw.resume();
  const socket =
    side === "client"
      ? new tls.TLSSocket(raw, { isServer: true, key, cert })
      : tls.connect({ socket: raw, rejectUnauthorized: false });
  sockets.push(socket);
  socket.on("error", () => {});
  socket.resume();
  if (when === "reset") socket.once("secure", () => peerTcp.resetAndDestroy());
}

const onAccept = side === "server" ? wrap : answer;
const onConnect = side === "client" ? wrap : answer;
const listener = transport === "tls" ? tls.createServer({ key, cert }, onAccept) : net.createServer(onAccept);
listener.on("connection", tcp => {
  peerTcp = tcp;
  sockets.push(tcp);
});
listener.listen(0, "127.0.0.1", () => {
  const { port } = listener.address() as net.AddressInfo;
  if (transport === "connecting") return onConnect(net.connect(port, "127.0.0.1"));
  const raw =
    transport === "tls"
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => onConnect(raw))
      : net.connect(port, "127.0.0.1", () => onConnect(raw));
});
