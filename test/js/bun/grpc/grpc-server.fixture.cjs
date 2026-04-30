// gRPC echo server for the bun:grpc tests. Spawned via Node (grpc-js is
// a Node HTTP/2 server under the hood) so we exercise interop, not just
// bun-to-bun.
const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");
const { join } = require("path");
const { readFileSync } = require("fs");

const fixturesDir = join(__dirname, "..", "..", "third_party", "grpc-js", "fixtures");
const pkgDef = loader.loadSync(join(fixturesDir, "echo_service.proto"), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const echoService = grpc.loadPackageDefinition(pkgDef).EchoService;

const ca = readFileSync(join(fixturesDir, "ca.pem"));
const key = readFileSync(join(fixturesDir, "server1.key"));
const cert = readFileSync(join(fixturesDir, "server1.pem"));

const serviceImpl =
  process.env.GRPC_SERVICE_TYPE === "1"
    ? {
        echo: (call, callback) => {
          const succeedOnRetryAttempt = call.metadata.get("succeed-on-retry-attempt");
          const previousAttempts = call.metadata.get("grpc-previous-rpc-attempts");
          if (
            succeedOnRetryAttempt.length === 0 ||
            (previousAttempts.length > 0 && previousAttempts[0] === succeedOnRetryAttempt[0])
          ) {
            callback(null, call.request);
          } else {
            const statusCode = call.metadata.get("respond-with-status");
            const code = statusCode[0] ? Number.parseInt(statusCode[0]) : grpc.status.UNKNOWN;
            callback({ code, details: `Failed on retry ${previousAttempts[0] ?? 0}` });
          }
        },
      }
    : {
        echo: (call, callback) => {
          if (call.metadata) call.sendMetadata(call.metadata);
          callback(null, call.request);
        },
      };

const server = new grpc.Server();
server.addService(echoService.service, serviceImpl);

process.stdin.on("data", data => {
  if (data.toString().includes("shutdown")) {
    server.tryShutdown(() => process.exit(0));
  }
});

const credentials = grpc.ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }]);
server.bindAsync("127.0.0.1:0", credentials, (err, port) => {
  if (err) {
    process.stderr.write(String(err) + "\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ port }) + "\n");
});
