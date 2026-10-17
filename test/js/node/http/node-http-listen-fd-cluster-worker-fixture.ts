// A worker of node-http-listen-fd-cluster-fixture.ts. It listens on `{ fd }`,
// which names a descriptor of the primary.
import http from "node:http";
import https from "node:https";

const fd = Number(process.env.LISTEN_FD);
const events: string[] = [];

function answer(_request: http.IncomingMessage, response: http.ServerResponse) {
  response.end("served by " + process.env.LISTEN_NONCE);
}
// LISTEN_TLS is a certificate and a key, or nothing for a plain server.
const server = process.env.LISTEN_TLS
  ? https.createServer(JSON.parse(process.env.LISTEN_TLS), answer)
  : http.createServer(answer);
server.on("error", (error: any) => process.send!({ error: { code: error.code, syscall: error.syscall } }));

if (process.env.LISTEN_CLOSE_EARLY) {
  // The server closes before the primary answers. The primary answers in
  // order, so its answer to the listen arrives before the echo.
  server.on("listening", () => events.push("listening"));
  server.listen({ fd });
  server.close(() => events.push("closed"));
  process.send!("echo");
} else {
  server.listen({ fd }, () => process.send!({ address: server.address(), listening: server.listening }));
}

process.on("message", message => {
  if (message === "echo") return void process.send!({ listening: server.listening, events });
  server.close();
  process.send!({ listening: server.listening });
});
