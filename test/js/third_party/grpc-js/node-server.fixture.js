const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");
const { join } = require("path");
const { readFileSync } = require("fs");

const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

function loadProtoFile(file) {
  const packageDefinition = loader.loadSync(file, protoLoaderOptions);
  return grpc.loadPackageDefinition(packageDefinition);
}

const protoFile = join(__dirname, "fixtures", "echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService;

const ca = readFileSync(join(__dirname, "fixtures", "ca.pem"));
const key = readFileSync(join(__dirname, "fixtures", "server1.key"));
const cert = readFileSync(join(__dirname, "fixtures", "server1.pem"));

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
            callback({
              code: code,
              details: `Failed on retry ${previousAttempts[0] ?? 0}`,
            });
          }
        },
      }
    : {
        echo: (call, callback) => {
          if (call.metadata) {
            call.sendMetadata(call.metadata);
          }
          callback(null, call.request);
        },
      };

function main() {
  const options = process.env.GRPC_TEST_OPTIONS;
  const server = options ? new grpc.Server(JSON.parse(options)) : new grpc.Server();

  process.stdin.on("data", data => {
    if (data.toString() === "shutdown") {
      server.tryShutdown(() => {
        process.exit(0);
      });
    }
  });
  server.addService(echoService.service, serviceImpl);

  const useTLS = process.env.GRPC_TEST_USE_TLS === "true";
  let credentials;
  if (useTLS) {
    credentials = grpc.ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }]);
  } else {
    credentials = grpc.ServerCredentials.createInsecure();
  }
  server.bindAsync("127.0.0.1:0", credentials, () => {
    server.start();
    process.stdout.write(JSON.stringify(server.http2ServerList[0].server.address()));
  });
}

main();
