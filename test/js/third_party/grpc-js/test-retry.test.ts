/*
 * Copyright 2022 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import * as grpc from "@grpc/grpc-js/build/src";
import * as path from "path";
import { loadProtoFile } from "./common";

import assert from "assert";
import { afterAll as after, beforeAll as before, describe, it } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
const EchoService = loadProtoFile(protoFile).EchoService as grpc.ServiceClientConstructor;

const serviceImpl = {
  echo: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
    const succeedOnRetryAttempt = call.metadata.get("succeed-on-retry-attempt");
    const previousAttempts = call.metadata.get("grpc-previous-rpc-attempts");
    if (
      succeedOnRetryAttempt.length === 0 ||
      (previousAttempts.length > 0 && previousAttempts[0] === succeedOnRetryAttempt[0])
    ) {
      callback(null, call.request);
    } else {
      const statusCode = call.metadata.get("respond-with-status");
      const code = statusCode[0] ? Number.parseInt(statusCode[0] as string) : grpc.status.UNKNOWN;
      callback({
        code: code,
        details: `Failed on retry ${previousAttempts[0] ?? 0}`,
      });
    }
  },
};

describe("Retries", () => {
  let server: grpc.Server;
  let port: number;
  before(done => {
    server = new grpc.Server();
    server.addService(EchoService.service, serviceImpl);
    server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, portNumber) => {
      if (error) {
        done(error);
        return;
      }
      port = portNumber;
      server.start();
      done();
    });
  });

  after(() => {
    server.forceShutdown();
  });

  describe("Client with retries disabled", () => {
    let client: InstanceType<grpc.ServiceClientConstructor>;
    before(() => {
      client = new EchoService(`localhost:${port}`, grpc.credentials.createInsecure(), { "grpc.enable_retries": 0 });
    });

    after(() => {
      client.close();
    });

    it("Should be able to make a basic request", done => {
      client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
        done();
      });
    });

    it("Should fail if the server fails the first request", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "1");
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.details, "Failed on retry 0");
        done();
      });
    });
  });

  describe("Client with retries enabled but not configured", () => {
    let client: InstanceType<grpc.ServiceClientConstructor>;
    before(() => {
      client = new EchoService(`localhost:${port}`, grpc.credentials.createInsecure());
    });

    after(() => {
      client.close();
    });

    it("Should be able to make a basic request", done => {
      client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
        done();
      });
    });

    it("Should fail if the server fails the first request", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "1");
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.details, "Failed on retry 0");
        done();
      });
    });
  });

  describe("Client with retries configured", () => {
    let client: InstanceType<grpc.ServiceClientConstructor>;
    before(() => {
      const serviceConfig = {
        loadBalancingConfig: [],
        methodConfig: [
          {
            name: [
              {
                service: "EchoService",
              },
            ],
            retryPolicy: {
              maxAttempts: 3,
              initialBackoff: "0.001s",
              maxBackoff: "0.01s",
              backoffMultiplier: 1.2,
              retryableStatusCodes: [14, "RESOURCE_EXHAUSTED"],
            },
          },
        ],
      };
      client = new EchoService(`localhost:${port}`, grpc.credentials.createInsecure(), {
        "grpc.service_config": JSON.stringify(serviceConfig),
      });
    });

    after(() => {
      client.close();
    });

    it("Should be able to make a basic request", done => {
      client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
        done();
      });
    });

    it("Should succeed with few required attempts", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "2");
      metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
        done();
      });
    });

    it("Should fail with many required attempts", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "4");
      metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.details, "Failed on retry 2");
        done();
      });
    });

    it("Should fail with a fatal status code", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "2");
      metadata.set("respond-with-status", `${grpc.status.NOT_FOUND}`);
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.details, "Failed on retry 0");
        done();
      });
    });

    it("Should not be able to make more than 5 attempts", done => {
      const serviceConfig = {
        loadBalancingConfig: [],
        methodConfig: [
          {
            name: [
              {
                service: "EchoService",
              },
            ],
            retryPolicy: {
              maxAttempts: 10,
              initialBackoff: "0.001s",
              maxBackoff: "0.01s",
              backoffMultiplier: 1.2,
              retryableStatusCodes: [14, "RESOURCE_EXHAUSTED"],
            },
          },
        ],
      };
      const client2 = new EchoService(`localhost:${port}`, grpc.credentials.createInsecure(), {
        "grpc.service_config": JSON.stringify(serviceConfig),
      });
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "6");
      metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
      client2.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.details, "Failed on retry 4");
        done();
      });
    });

    it("Should be able to make more than 5 attempts with a channel argument", done => {
      const serviceConfig = {
        loadBalancingConfig: [],
        methodConfig: [
          {
            name: [
              {
                service: "EchoService",
              },
            ],
            retryPolicy: {
              maxAttempts: 10,
              initialBackoff: "0.001s",
              maxBackoff: "0.01s",
              backoffMultiplier: 1.2,
              retryableStatusCodes: [14, "RESOURCE_EXHAUSTED"],
            },
          },
        ],
      };
      const client2 = new EchoService(`localhost:${port}`, grpc.credentials.createInsecure(), {
        "grpc.service_config": JSON.stringify(serviceConfig),
        "grpc-node.retry_max_attempts_limit": 8,
      });
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "7");
      metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
      client2.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
        done();
      });
    });
  });

  describe("Client with hedging configured", () => {
    let client: InstanceType<grpc.ServiceClientConstructor>;
    before(() => {
      const serviceConfig = {
        loadBalancingConfig: [],
        methodConfig: [
          {
            name: [
              {
                service: "EchoService",
              },
            ],
            hedgingPolicy: {
              maxAttempts: 3,
              nonFatalStatusCodes: [14, "RESOURCE_EXHAUSTED"],
            },
          },
        ],
      };
      client = new EchoService(`localhost:${port}`, grpc.credentials.createInsecure(), {
        "grpc.service_config": JSON.stringify(serviceConfig),
      });
    });

    after(() => {
      client.close();
    });

    it("Should be able to make a basic request", done => {
      client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
        done();
      });
    });

    it("Should succeed with few required attempts", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "2");
      metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
        done();
      });
    });

    it("Should fail with many required attempts", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "4");
      metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert(error.details.startsWith("Failed on retry"));
        done();
      });
    });

    it("Should fail with a fatal status code", done => {
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "2");
      metadata.set("respond-with-status", `${grpc.status.NOT_FOUND}`);
      client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert(error.details.startsWith("Failed on retry"));
        done();
      });
    });

    it("Should not be able to make more than 5 attempts", done => {
      const serviceConfig = {
        loadBalancingConfig: [],
        methodConfig: [
          {
            name: [
              {
                service: "EchoService",
              },
            ],
            hedgingPolicy: {
              maxAttempts: 10,
              nonFatalStatusCodes: [14, "RESOURCE_EXHAUSTED"],
            },
          },
        ],
      };
      const client2 = new EchoService(`localhost:${port}`, grpc.credentials.createInsecure(), {
        "grpc.service_config": JSON.stringify(serviceConfig),
      });
      const metadata = new grpc.Metadata();
      metadata.set("succeed-on-retry-attempt", "6");
      metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
      client2.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
        assert(error);
        assert(error.details.startsWith("Failed on retry"));
        done();
      });
    });
  });
});

// Not from grpc-node. grpc-js retries a call transparently when the status of the refused stream
// has rstCode, and only its 'close' handler makes that status. The write in flight must not fail
// before 'close': a write error ends the call with UNAVAILABLE, and grpc-js does not retry it.
describe("A stream that the server refuses while a message waits for the flow-control window", () => {
  const FRAME = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, GOAWAY: 7, WINDOW_UPDATE: 8 };
  const WINDOW = 65535;
  const frame = (type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(9);
    header.writeUIntBE(payload.length, 0, 3);
    header[3] = type;
    header[4] = flags;
    header.writeUInt32BE(streamId, 5);
    return Buffer.concat([header, payload]);
  };
  const uint32 = (...values: number[]) => {
    const buffer = Buffer.alloc(4 * values.length);
    values.forEach((value, i) => buffer.writeUInt32BE(value, 4 * i));
    return buffer;
  };
  // HPACK "literal header field never indexed, new name": no table state on either side.
  const headerBlock = (headers: [string, string][]) =>
    Buffer.concat(
      headers.flatMap(([name, value]) => [
        Buffer.from([0x10, name.length]),
        Buffer.from(name),
        Buffer.from([value.length]),
        Buffer.from(value),
      ]),
    );
  const pong = (streamId: number) =>
    Buffer.concat([
      frame(
        FRAME.HEADERS,
        0x4,
        streamId,
        headerBlock([
          [":status", "200"],
          ["content-type", "application/grpc"],
        ]),
      ),
      // One message: not compressed, 4 bytes long.
      frame(FRAME.DATA, 0, streamId, Buffer.concat([Buffer.from([0, 0, 0, 0, 4]), Buffer.from("pong")])),
      frame(FRAME.HEADERS, 0x5, streamId, headerBlock([["grpc-status", "0"]])),
    ]);
  // [name, the frame that refuses stream `id`]
  const refusals: [string, (id: number) => Buffer][] = [
    [
      "RST_STREAM(REFUSED_STREAM)",
      id => frame(FRAME.RST_STREAM, 0, id, uint32(http2.constants.NGHTTP2_REFUSED_STREAM)),
    ],
    // The last-stream-id is 0: the server did not process the call. The retry needs a new connection.
    ["GOAWAY", () => frame(FRAME.GOAWAY, 0, 0, uint32(0, http2.constants.NGHTTP2_NO_ERROR))],
  ];
  for (const [name, refuse] of refusals) {
    it(`is retried on a new stream after ${name}`, async () => {
      let streams = 0;
      const sockets = new Set<net.Socket>();
      // A raw h2c server. It refuses the first call when it holds one window of the message: the
      // rest of the message is then in flight in the client. It answers every later call.
      const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on("error", () => {});
        socket.write(frame(FRAME.SETTINGS, 0, 0));
        const calls = new Map<number, number>();
        let buffered = Buffer.alloc(0);
        let preface = 24;
        let received = 0;
        socket.on("data", (chunk: Buffer) => {
          buffered = Buffer.concat([buffered, chunk]);
          if (buffered.length < preface) return;
          buffered = buffered.subarray(preface);
          preface = 0;
          while (buffered.length >= 9 && buffered.length >= 9 + buffered.readUIntBE(0, 3)) {
            const length = buffered.readUIntBE(0, 3);
            const [type, flags, id] = [buffered[3], buffered[4], buffered.readUInt32BE(5) & 0x7fffffff];
            buffered = buffered.subarray(9 + length);
            if (type === FRAME.SETTINGS && !(flags & 1)) socket.write(frame(FRAME.SETTINGS, 1, 0));
            else if (type === FRAME.HEADERS) calls.set(id, ++streams);
            else if (type === FRAME.DATA && calls.get(id) === 1) {
              received += length;
              // The window of the connection opens again, so a retry on this connection can send.
              if (received === WINDOW)
                socket.write(Buffer.concat([frame(FRAME.WINDOW_UPDATE, 0, 0, uint32(WINDOW)), refuse(id)]));
            } else if (type === FRAME.DATA) {
              const grant = uint32(length);
              if (length > 0)
                socket.write(
                  Buffer.concat([frame(FRAME.WINDOW_UPDATE, 0, 0, grant), frame(FRAME.WINDOW_UPDATE, 0, id, grant)]),
                );
              if (flags & 1) socket.write(pong(id));
            }
          }
        });
      });
      server.listen(0, "127.0.0.1");
      await new Promise(resolve => server.once("listening", resolve));
      const { port } = server.address() as net.AddressInfo;
      const client = new grpc.Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
      try {
        const identity = (value: Buffer) => value;
        const { promise, resolve } = Promise.withResolvers<{ code: grpc.status; details: string }>();
        client.makeUnaryRequest("/test.Echo/Echo", identity, identity, Buffer.alloc(200 * 1024, 97), (error, reply) =>
          resolve({ code: error ? error.code : grpc.status.OK, details: error ? error.details : String(reply) }),
        );
        assert.deepStrictEqual({ ...(await promise), streams }, { code: grpc.status.OK, details: "pong", streams: 2 });
      } finally {
        client.close();
        for (const socket of sockets) socket.destroy();
        server.close();
      }
    });
  }
});
