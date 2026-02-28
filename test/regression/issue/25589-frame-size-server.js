/**
 * Node.js gRPC server fixture for testing HTTP/2 FRAME_SIZE_ERROR
 * This server configures large frame sizes and can return large responses
 * to test Bun's HTTP/2 client handling of large frames.
 */

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

// Use the existing proto file from grpc-js tests
const protoFile = join(__dirname, "../../js/third_party/grpc-js/fixtures/echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService;

// TLS certificates from grpc-js fixtures
const ca = readFileSync(join(__dirname, "../../js/third_party/grpc-js/fixtures/ca.pem"));
const key = readFileSync(join(__dirname, "../../js/third_party/grpc-js/fixtures/server1.key"));
const cert = readFileSync(join(__dirname, "../../js/third_party/grpc-js/fixtures/server1.pem"));

// Service implementation that can return large responses
const serviceImpl = {
  echo: (call, callback) => {
    const request = call.request;
    const metadata = call.metadata;

    // Check if client wants large response headers
    const largeHeaders = metadata.get("x-large-headers");
    if (largeHeaders.length > 0) {
      const responseMetadata = new grpc.Metadata();
      // Add many headers to exceed 16KB
      const headerCount = parseInt(largeHeaders[0]) || 100;
      for (let i = 0; i < headerCount; i++) {
        responseMetadata.add(`x-header-${i}`, "A".repeat(200));
      }
      call.sendMetadata(responseMetadata);
    }

    // Check if client wants large response value
    const largeResponse = metadata.get("x-large-response");
    if (largeResponse.length > 0) {
      const size = parseInt(largeResponse[0]) || 32768; // Default 32KB
      callback(null, { value: "X".repeat(size), value2: 0 });
      return;
    }

    // Check if client wants large trailers
    const largeTrailers = metadata.get("x-large-trailers");
    if (largeTrailers.length > 0) {
      const size = parseInt(largeTrailers[0]) || 20000;
      const trailerMetadata = new grpc.Metadata();
      trailerMetadata.add("grpc-status-details-bin", Buffer.from("X".repeat(size)));
      call.sendMetadata(call.metadata);
      callback(null, { value: request.value || "echo", value2: request.value2 || 0 }, trailerMetadata);
      return;
    }

    // Default: echo back the request
    if (call.metadata) {
      call.sendMetadata(call.metadata);
    }
    callback(null, request);
  },

  echoClientStream: (call, callback) => {
    let lastMessage = { value: "", value2: 0 };
    call.on("data", message => {
      lastMessage = message;
    });
    call.on("end", () => {
      callback(null, lastMessage);
    });
  },

  echoServerStream: call => {
    const metadata = call.metadata;
    const largeResponse = metadata.get("x-large-response");

    if (largeResponse.length > 0) {
      const size = parseInt(largeResponse[0]) || 32768;
      // Send a single large response
      call.write({ value: "X".repeat(size), value2: 0 });
    } else {
      // Echo the request
      call.write(call.request);
    }
    call.end();
  },

  echoBidiStream: call => {
    call.on("data", message => {
      call.write(message);
    });
    call.on("end", () => {
      call.end();
    });
  },
};

function main() {
  // Parse server options from environment
  const optionsJson = process.env.GRPC_SERVER_OPTIONS;
  let serverOptions = {
    // Default: allow very large messages
    "grpc.max_send_message_length": -1,
    "grpc.max_receive_message_length": -1,
  };

  if (optionsJson) {
    try {
      serverOptions = { ...serverOptions, ...JSON.parse(optionsJson) };
    } catch (e) {
      console.error("Failed to parse GRPC_SERVER_OPTIONS:", e);
    }
  }

  const server = new grpc.Server(serverOptions);

  // Handle shutdown
  process.stdin.on("data", data => {
    const cmd = data.toString().trim();
    if (cmd === "shutdown") {
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

  server.bindAsync("localhost:0", credentials, (err, port) => {
    if (err) {
      console.error("Failed to bind server:", err);
      process.exit(1);
    }
    // Output the address for the test to connect to
    process.stdout.write(JSON.stringify({ address: "localhost", family: "IPv4", port }));
  });
}

main();
