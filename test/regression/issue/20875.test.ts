/**
 * Test for GitHub Issue #20875: gRPC regression - DEADLINE_EXCEEDED errors
 * with streaming calls when using @grpc/grpc-js
 *
 * This test verifies that Bun's HTTP/2 client correctly handles:
 * 1. Server streaming gRPC calls (like BatchGetDocuments)
 * 2. Proper handling of streams in HALF_CLOSED_LOCAL state
 */

import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const __dirname = import.meta.dirname;

const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

function loadProtoFile(file: string) {
  const packageDefinition = loader.loadSync(file, protoLoaderOptions);
  return grpc.loadPackageDefinition(packageDefinition);
}

const protoFile = join(__dirname, "../../js/third_party/grpc-js/fixtures/echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService as grpc.ServiceClientConstructor;
const ca = readFileSync(join(__dirname, "../../js/third_party/grpc-js/fixtures/ca.pem"));
const key = readFileSync(join(__dirname, "../../js/third_party/grpc-js/fixtures/server1.key"));
const cert = readFileSync(join(__dirname, "../../js/third_party/grpc-js/fixtures/server1.pem"));

let server: grpc.Server;
let client: InstanceType<typeof echoService>;
let serverPort: number;

describe("gRPC streaming calls", () => {
  beforeAll(async () => {
    server = new grpc.Server();

    // Implement both unary and streaming methods
    server.addService(echoService.service, {
      // Unary call - works fine in the original issue
      echo(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
        callback(null, call.request);
      },

      // Server streaming - this is what BatchGetDocuments uses
      echoServerStream(call: grpc.ServerWritableStream<any, any>) {
        const request = call.request;
        // Simulate a streaming response (like BatchGetDocuments)
        // Send multiple messages with a small delay
        call.write({ value: "response1", value2: 1 });
        call.write({ value: "response2", value2: 2 });
        call.write({ value: request.value, value2: request.value2 });
        call.end();
      },

      // Client streaming
      echoClientStream(call: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>) {
        const messages: any[] = [];
        call.on("data", data => {
          messages.push(data);
        });
        call.on("end", () => {
          callback(null, { value: `received ${messages.length} messages`, value2: messages.length });
        });
      },

      // Bidirectional streaming
      echoBidiStream(call: grpc.ServerDuplexStream<any, any>) {
        call.on("data", data => {
          call.write(data);
        });
        call.on("end", () => {
          call.end();
        });
      },
    });

    const serverCreds = grpc.ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }], false);

    await new Promise<void>((resolve, reject) => {
      server.bindAsync("127.0.0.1:0", serverCreds, (err, port) => {
        if (err) {
          reject(err);
          return;
        }
        serverPort = port;
        resolve();
      });
    });

    const clientCreds = grpc.credentials.createSsl(ca);
    client = new echoService(`127.0.0.1:${serverPort}`, clientCreds, {
      "grpc.ssl_target_name_override": "foo.test.google.fr",
      "grpc.default_authority": "foo.test.google.fr",
    });
  });

  afterAll(() => {
    client?.close();
    server?.forceShutdown();
  });

  test("unary call should work", async () => {
    const result = await new Promise<any>((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);
      client.echo({ value: "test", value2: 42 }, { deadline }, (err: Error | null, response: any) => {
        if (err) reject(err);
        else resolve(response);
      });
    });

    expect(result).toEqual({ value: "test", value2: 42 });
  });

  test("server streaming call should work (like BatchGetDocuments)", async () => {
    const messages: any[] = [];

    await new Promise<void>((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);

      const stream = client.echoServerStream({ value: "request", value2: 100 }, { deadline });

      stream.on("data", (data: any) => {
        messages.push(data);
      });

      stream.on("error", (err: Error) => {
        reject(err);
      });

      stream.on("end", () => {
        resolve();
      });
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ value: "response1", value2: 1 });
    expect(messages[1]).toEqual({ value: "response2", value2: 2 });
    expect(messages[2]).toEqual({ value: "request", value2: 100 });
  });

  test("client streaming call should work", async () => {
    const result = await new Promise<any>((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);

      const stream = client.echoClientStream({ deadline }, (err: Error | null, response: any) => {
        if (err) reject(err);
        else resolve(response);
      });

      stream.write({ value: "msg1", value2: 1 });
      stream.write({ value: "msg2", value2: 2 });
      stream.write({ value: "msg3", value2: 3 });
      stream.end();
    });

    expect(result).toEqual({ value: "received 3 messages", value2: 3 });
  });

  test("bidirectional streaming call should work", async () => {
    const receivedMessages: any[] = [];

    await new Promise<void>((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);

      const stream = client.echoBidiStream({ deadline });

      stream.on("data", (data: any) => {
        receivedMessages.push(data);
      });

      stream.on("error", (err: Error) => {
        reject(err);
      });

      stream.on("end", () => {
        resolve();
      });

      // Send some messages
      stream.write({ value: "msg1", value2: 1 });
      stream.write({ value: "msg2", value2: 2 });
      stream.end();
    });

    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages[0]).toEqual({ value: "msg1", value2: 1 });
    expect(receivedMessages[1]).toEqual({ value: "msg2", value2: 2 });
  });

  test("multiple concurrent calls with mixed types (reproduces #20875)", async () => {
    // This test simulates the Firestore scenario:
    // 1. Multiple unary Commit calls
    // 2. Followed by a server streaming BatchGetDocuments call
    // The issue is that the streaming call fails with DEADLINE_EXCEEDED

    const results: any[] = [];

    // First, make a few unary calls (like Commit)
    for (let i = 0; i < 3; i++) {
      const result = await new Promise<any>((resolve, reject) => {
        const deadline = new Date();
        deadline.setSeconds(deadline.getSeconds() + 10);
        client.echo({ value: `commit${i}`, value2: i }, { deadline }, (err: Error | null, response: any) => {
          if (err) reject(err);
          else resolve(response);
        });
      });
      results.push(result);
    }

    expect(results).toHaveLength(3);

    // Now make a server streaming call (like BatchGetDocuments)
    const streamingResults: any[] = [];

    await new Promise<void>((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);

      const stream = client.echoServerStream({ value: "batchGet", value2: 999 }, { deadline });

      stream.on("data", (data: any) => {
        streamingResults.push(data);
      });

      stream.on("error", (err: Error) => {
        reject(err);
      });

      stream.on("end", () => {
        resolve();
      });
    });

    expect(streamingResults).toHaveLength(3);
    expect(streamingResults[2]).toEqual({ value: "batchGet", value2: 999 });
  });

  test("rapid successive streaming calls", async () => {
    // Make many streaming calls in rapid succession
    const promises = [];

    for (let i = 0; i < 10; i++) {
      promises.push(
        new Promise<any[]>((resolve, reject) => {
          const messages: any[] = [];
          const deadline = new Date();
          deadline.setSeconds(deadline.getSeconds() + 10);

          const stream = client.echoServerStream({ value: `batch${i}`, value2: i }, { deadline });

          stream.on("data", (data: any) => {
            messages.push(data);
          });

          stream.on("error", (err: Error) => {
            reject(err);
          });

          stream.on("end", () => {
            resolve(messages);
          });
        }),
      );
    }

    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toHaveLength(3);
      expect(results[i][2]).toEqual({ value: `batch${i}`, value2: i });
    }
  });
});
