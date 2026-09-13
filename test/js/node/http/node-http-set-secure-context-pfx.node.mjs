import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import path from "node:path";
import { connect } from "node:tls";

const fixtures = process.env.TLS_FIXTURES_DIR;
const read = name => readFileSync(path.join(fixtures, name));

function makeServer() {
  return createServer({
    key: read("agent2-key.pem"),
    cert: read("agent2-cert.pem"),
    requestCert: true,
    rejectUnauthorized: false,
  });
}

function makePFXServer() {
  return createServer({
    pfx: read("agent1.pfx"),
    passphrase: "sample",
    requestCert: true,
    rejectUnauthorized: false,
  });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

async function close(server) {
  server.close();
  await once(server, "close");
}

async function isAuthorized(server, agent) {
  const accepted = once(server, "secureConnection");
  const client = connect({
    host: "127.0.0.1",
    port: server.address().port,
    key: read(agent + "-key.pem"),
    cert: read(agent + "-cert.pem"),
    rejectUnauthorized: false,
  });
  try {
    const [, [serverSocket]] = await Promise.all([once(client, "secureConnect"), accepted]);
    return serverSocket.authorized;
  } finally {
    client.destroy();
  }
}

async function checkTrust(server) {
  return {
    pfxCA: await isAuthorized(server, "agent1"),
    defaultCA: await isAuthorized(server, "agent3"),
  };
}

async function main() {
  const live = makeServer();
  await listen(live);
  live.setSecureContext({ pfx: read("agent1.pfx"), passphrase: "sample" });
  const liveTrust = await checkTrust(live);
  await close(live);
  await listen(live);
  const relistenTrust = await checkTrust(live);
  await close(live);

  const beforeListen = makeServer();
  beforeListen.setSecureContext({ pfx: read("agent1.pfx"), passphrase: "sample" });
  await listen(beforeListen);
  const beforeListenTrust = await checkTrust(beforeListen);
  await close(beforeListen);

  const initial = makePFXServer();
  await listen(initial);
  const initialTrust = await checkTrust(initial);
  await close(initial);

  const explicit = makeServer();
  await listen(explicit);
  explicit.setSecureContext({
    pfx: read("agent1.pfx"),
    passphrase: "sample",
    ca: read("ca4-cert.pem"),
  });
  const explicitTrust = await checkTrust(explicit);
  await close(explicit);

  console.log(JSON.stringify({ liveTrust, relistenTrust, beforeListenTrust, initialTrust, explicitTrust }));
}

main().catch(error => {
  console.error(error?.code || error?.message || String(error));
  process.exit(1);
});
