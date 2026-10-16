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
import type { AddressInfo } from "node:net";

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
// has rstCode, and only its 'close' handler makes that status. Since Node.js 26.10 the write in
// flight gets the error of the stream before 'close', so the write error ends the call first.
describe("A stream that the server refuses while a message waits for the flow-control window", () => {
  it("ends the call with the write error and makes no second attempt, as Node.js 26.10 does", async () => {
    let streams = 0;
    const server = http2.createServer();
    server.on("sessionError", () => {});
    server.on("stream", stream => {
      stream.on("error", () => {});
      if (++streams === 1) {
        // The message is larger than the window, so its write is in flight when the first part arrives.
        stream.once("data", () => stream.close(http2.constants.NGHTTP2_REFUSED_STREAM));
        return;
      }
      stream.resume();
      stream.on("end", () => {
        stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
        // One message: not compressed, 4 bytes long.
        stream.end(Buffer.concat([Buffer.from([0, 0, 0, 0, 4]), Buffer.from("pong")]));
      });
    });
    server.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const client = new grpc.Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    try {
      const identity = (value: Buffer) => value;
      const { promise, resolve } = Promise.withResolvers<{ code: grpc.status; details: string }>();
      client.makeUnaryRequest("/test.Echo/Echo", identity, identity, Buffer.alloc(200 * 1024, 97), (error, reply) =>
        resolve({ code: error ? error.code : grpc.status.OK, details: error ? error.details : String(reply) }),
      );
      assert.deepStrictEqual(
        { ...(await promise), streams },
        {
          code: grpc.status.UNAVAILABLE,
          details: "Write error: Stream closed with error code NGHTTP2_REFUSED_STREAM",
          streams: 1,
        },
      );
    } finally {
      client.close();
      server.close();
    }
  });
});
