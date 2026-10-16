// One https request with a keep-alive agent, through a CONNECT proxy that speaks TLS itself.
//
// The socket of the request is a TLS socket inside the TLS connection to the proxy. When the
// response is complete, the agent keeps that socket and calls unref() on it
// (Agent.prototype.keepSocketAlive). In Node.js the unref() reaches the TCP handle:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L635-L654
// The origin and the proxy are in this process and do not keep it alive. So nothing is left, and
// the process must exit by itself. It has no timer and calls no process.exit().
//
//   TLS_CERT and TLS_KEY: the certificate of the origin and of the proxy.
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const { TLS_CERT: cert, TLS_KEY: key } = process.env;
const insecure = { rejectUnauthorized: false };

const events = [];
process.on("exit", () => console.log(JSON.stringify(events)));

function quiet(socket) {
  socket.on("error", () => {});
  return socket;
}

function listen(server) {
  const { promise, resolve } = Promise.withResolvers();
  server.listen(0, "127.0.0.1", () => {
    server.unref();
    resolve(server.address().port);
  });
  return promise;
}

// The origin answers every request and keeps the connection open.
const origin = tls.createServer({ cert, key }, socket => {
  quiet(socket).unref();
  socket.on("data", () => {
    socket.write("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: keep-alive\r\n\r\nhello");
  });
});
const originPort = await listen(origin);

// The proxy: TLS to the client, then a tunnel to the host of the CONNECT request.
const proxy = tls.createServer({ cert, key }, client => {
  quiet(client).unref();
  client.once("data", request => {
    const [, host, port] = /^CONNECT ([^:]+):(\d+) /.exec(`${request}`);
    const upstream = quiet(net.connect(Number(port), host));
    upstream.unref();
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      client.pipe(upstream).pipe(client);
    });
  });
});
const proxyPort = await listen(proxy);

// What https-proxy-agent and hpagent do: CONNECT over TLS to the proxy, then TLS to the origin
// inside that connection.
class TLSProxyAgent extends https.Agent {
  createConnection(options, callback) {
    const toProxy = quiet(tls.connect({ port: proxyPort, host: "127.0.0.1", ...insecure }));
    toProxy.write(`CONNECT ${options.host}:${options.port} HTTP/1.1\r\nHost: ${options.host}:${options.port}\r\n\r\n`);
    toProxy.once("data", () => callback(null, tls.connect({ socket: toProxy, ...insecure })));
  }
}

const agent = new TLSProxyAgent({ keepAlive: true });
https.get({ host: "127.0.0.1", port: originPort, path: "/", agent }, response => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", chunk => (body += chunk));
  response.on("end", () => events.push(body));
});
