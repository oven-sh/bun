import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const key = readFileSync(new URL("./fixtures/agent1-key.pem", import.meta.url));
const cert = readFileSync(new URL("./fixtures/agent1-cert.pem", import.meta.url));
const ca = readFileSync(new URL("./fixtures/ca1-cert.pem", import.meta.url));

export const cases = [
  ...["127.0.0.1", "localhost"].flatMap(host =>
    ["omitted", undefined, null, "", "files.proxy.test"].map(servername => ({ host, servername, transport: "tls" })),
  ),
  ...["socket", "context"].flatMap(transport =>
    [undefined, null, "", "files.proxy.test"].map(servername => ({ host: "127.0.0.1", servername, transport })),
  ),
  ...["https", "http2"].flatMap(transport =>
    ["127.0.0.1", "localhost"].flatMap(host =>
      [undefined, null, "", "files.proxy.test"].map(servername => ({ host, servername, transport })),
    ),
  ),
];

export function expected({ host, servername, transport }) {
  const name =
    servername && servername !== "omitted"
      ? servername
      : (transport === "http2" || (transport === "https" && servername !== "")) && host === "localhost"
        ? host
        : false;
  return { servername: name, clientServername: name, identity: name || host, authorized: true };
}

export async function observe({ host, servername, transport }) {
  const isHttps = transport === "https";
  const isHttp2 = transport === "http2";
  const server = isHttp2
    ? http2.createSecureServer({ key, cert })
    : isHttps
      ? https.createServer({ key, cert }, (req, res) => res.end(JSON.stringify({ servername: req.socket.servername })))
      : tls.createServer({ key, cert }, socket => socket.end(JSON.stringify({ servername: socket.servername })));
  if (isHttp2)
    server.on("stream", stream => stream.end(JSON.stringify({ servername: stream.session.socket.servername })));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let socket;
  let raw;
  let agent;
  let session;
  try {
    const port = server.address().port;
    let identity;
    const options = {
      host,
      port,
      ca,
      lookup(_host, _options, callback) {
        if (_options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
        else callback(null, "127.0.0.1", 4);
      },
      checkServerIdentity(hostname) {
        identity = hostname;
      },
      ...(servername === "omitted" ? {} : { servername }),
    };
    if (transport === "context") options.secureContext = tls.createSecureContext({ ca });
    if (transport === "socket") {
      raw = net.connect({ host: "127.0.0.1", port });
      await once(raw, "connect");
      options.socket = raw;
    }
    let clientServername;
    let authorized;
    let body = "";
    if (isHttp2) {
      session = http2.connect(`https://${host}:${port}`, options);
      await once(session, "connect");
      socket = session.socket;
      clientServername = socket.servername;
      authorized = socket.authorized;
      const request = session.request();
      request.setEncoding("utf8");
      request.on("data", chunk => (body += chunk));
      request.end();
      await once(request, "end");
    } else if (isHttps) {
      agent = new https.Agent(options);
      await new Promise((resolve, reject) => {
        const req = https.get({ host, port, agent }, res => {
          socket = res.socket;
          clientServername = socket.servername;
          authorized = socket.authorized;
          res.setEncoding("utf8");
          res.on("data", chunk => (body += chunk));
          res.on("error", reject);
          res.on("end", resolve);
        });
        req.on("error", reject);
      });
    } else {
      socket = tls.connect(options);
      socket.on("secureConnect", () => {
        clientServername = socket.servername;
        authorized = socket.authorized;
      });
      socket.setEncoding("utf8");
      socket.on("data", chunk => (body += chunk));
      await once(socket, "close");
    }
    return { ...JSON.parse(body), clientServername, identity, authorized };
  } finally {
    if (session) {
      session.close();
      await once(session, "close");
    } else socket?.destroy();
    raw?.destroy();
    agent?.destroy();
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const scenario of cases) {
    const result = await observe(scenario);
    console.log(JSON.stringify({ ...scenario, result }));
    assert.deepEqual(result, expected(scenario));
  }
}
