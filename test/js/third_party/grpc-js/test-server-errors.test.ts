/*
 * Copyright 2019 gRPC authors.
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

// Allow `any` data type for testing runtime type checking.
// tslint:disable no-any
import assert from "assert";
import { join } from "path";

import * as grpc from "@grpc/grpc-js/build/src";
import { Server } from "@grpc/grpc-js/build/src";
import { ServiceError } from "@grpc/grpc-js/build/src/call";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";
import {
  sendUnaryData,
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream,
} from "@grpc/grpc-js/build/src/server-call";

import { loadProtoFile } from "./common";
import { CompressionAlgorithms } from "@grpc/grpc-js/build/src/compression-algorithms";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

const protoFile = join(__dirname, "fixtures", "test_service.proto");
const testServiceDef = loadProtoFile(protoFile);
const testServiceClient = testServiceDef.TestService as ServiceClientConstructor;
const clientInsecureCreds = grpc.credentials.createInsecure();
const serverInsecureCreds = grpc.ServerCredentials.createInsecure();

describe("Client malformed response handling", () => {
  let server: Server;
  let client: ServiceClient;
  const badArg = Buffer.from([0xff]);

  before(done => {
    const malformedTestService = {
      unary: {
        path: "/TestService/Unary",
        requestStream: false,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: identity,
      },
      clientStream: {
        path: "/TestService/ClientStream",
        requestStream: true,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: identity,
      },
      serverStream: {
        path: "/TestService/ServerStream",
        requestStream: false,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: identity,
      },
      bidiStream: {
        path: "/TestService/BidiStream",
        requestStream: true,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: identity,
      },
    } as any;

    server = new Server();

    server.addService(malformedTestService, {
      unary(call: ServerUnaryCall<any, any>, cb: sendUnaryData<any>) {
        cb(null, badArg);
      },

      clientStream(stream: ServerReadableStream<any, any>, cb: sendUnaryData<any>) {
        stream.on("data", noop);
        stream.on("end", () => {
          cb(null, badArg);
        });
      },

      serverStream(stream: ServerWritableStream<any, any>) {
        stream.write(badArg);
        stream.end();
      },

      bidiStream(stream: ServerDuplexStream<any, any>) {
        stream.on("data", () => {
          // Ignore requests
          stream.write(badArg);
        });

        stream.on("end", () => {
          stream.end();
        });
      },
    });

    server.bindAsync("localhost:0", serverInsecureCreds, (err, port) => {
      assert.ifError(err);
      client = new testServiceClient(`localhost:${port}`, clientInsecureCreds);
      server.start();
      done();
    });
  });

  after(() => {
    client.close();
    server.forceShutdown();
  });

  it("should get an INTERNAL status with a unary call", done => {
    client.unary({}, (err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.INTERNAL);
      done();
    });
  });

  it("should get an INTERNAL status with a client stream call", done => {
    const call = client.clientStream((err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.INTERNAL);
      done();
    });

    call.write({});
    call.end();
  });

  it("should get an INTERNAL status with a server stream call", done => {
    const call = client.serverStream({});

    call.on("data", noop);
    call.on("error", (err: ServiceError) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.INTERNAL);
      done();
    });
  });

  it("should get an INTERNAL status with a bidi stream call", done => {
    const call = client.bidiStream();

    call.on("data", noop);
    call.on("error", (err: ServiceError) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.INTERNAL);
      done();
    });

    call.write({});
    call.end();
  });
});

describe("Server serialization failure handling", () => {
  let client: ServiceClient;
  let server: Server;

  before(done => {
    function serializeFail(obj: any) {
      throw new Error("Serialization failed");
    }

    const malformedTestService = {
      unary: {
        path: "/TestService/Unary",
        requestStream: false,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: serializeFail,
      },
      clientStream: {
        path: "/TestService/ClientStream",
        requestStream: true,
        responseStream: false,
        requestDeserialize: identity,
        responseSerialize: serializeFail,
      },
      serverStream: {
        path: "/TestService/ServerStream",
        requestStream: false,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: serializeFail,
      },
      bidiStream: {
        path: "/TestService/BidiStream",
        requestStream: true,
        responseStream: true,
        requestDeserialize: identity,
        responseSerialize: serializeFail,
      },
    };

    server = new Server();
    server.addService(malformedTestService as any, {
      unary(call: ServerUnaryCall<any, any>, cb: sendUnaryData<any>) {
        cb(null, {});
      },

      clientStream(stream: ServerReadableStream<any, any>, cb: sendUnaryData<any>) {
        stream.on("data", noop);
        stream.on("end", () => {
          cb(null, {});
        });
      },

      serverStream(stream: ServerWritableStream<any, any>) {
        stream.write({});
        stream.end();
      },

      bidiStream(stream: ServerDuplexStream<any, any>) {
        stream.on("data", () => {
          // Ignore requests
          stream.write({});
        });
        stream.on("end", () => {
          stream.end();
        });
      },
    });

    server.bindAsync("localhost:0", serverInsecureCreds, (err, port) => {
      assert.ifError(err);
      client = new testServiceClient(`localhost:${port}`, clientInsecureCreds);
      server.start();
      done();
    });
  });

  after(() => {
    client.close();
    server.forceShutdown();
  });

  it("should get an INTERNAL status with a unary call", done => {
    client.unary({}, (err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.INTERNAL);
      done();
    });
  });

  it("should get an INTERNAL status with a client stream call", done => {
    const call = client.clientStream((err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.INTERNAL);
      done();
    });

    call.write({});
    call.end();
  });

  it("should get an INTERNAL status with a server stream call", done => {
    const call = client.serverStream({});

    call.on("data", noop);
    call.on("error", (err: ServiceError) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.INTERNAL);
      done();
    });
  });
});

describe("Cardinality violations", () => {
  let client: ServiceClient;
  let server: Server;
  let responseCount: number = 1;
  const testMessage = Buffer.from([]);
  before(done => {
    const serverServiceDefinition = {
      testMethod: {
        path: "/TestService/TestMethod/",
        requestStream: false,
        responseStream: true,
        requestSerialize: identity,
        requestDeserialize: identity,
        responseDeserialize: identity,
        responseSerialize: identity,
      },
    };
    const clientServiceDefinition = {
      testMethod: {
        path: "/TestService/TestMethod/",
        requestStream: true,
        responseStream: false,
        requestSerialize: identity,
        requestDeserialize: identity,
        responseDeserialize: identity,
        responseSerialize: identity,
      },
    };
    const TestClient = grpc.makeClientConstructor(clientServiceDefinition, "TestService");
    server = new grpc.Server();
    server.addService(serverServiceDefinition, {
      testMethod(stream: ServerWritableStream<any, any>) {
        for (let i = 0; i < responseCount; i++) {
          stream.write(testMessage);
        }
        stream.end();
      },
    });
    server.bindAsync("localhost:0", serverInsecureCreds, (error, port) => {
      assert.ifError(error);
      client = new TestClient(`localhost:${port}`, clientInsecureCreds);
      done();
    });
  });
  beforeEach(() => {
    responseCount = 1;
  });
  after(() => {
    client.close();
    server.forceShutdown();
  });
  it("Should fail if the client sends too few messages", done => {
    const call = client.testMethod((err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
      done();
    });
    call.end();
  });
  it("Should fail if the client sends too many messages", done => {
    const call = client.testMethod((err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
      done();
    });
    call.write(testMessage);
    call.write(testMessage);
    call.end();
  });
  it("Should fail if the server sends too few messages", done => {
    responseCount = 0;
    const call = client.testMethod((err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
      done();
    });
    call.write(testMessage);
    call.end();
  });
  it("Should fail if the server sends too many messages", done => {
    responseCount = 2;
    const call = client.testMethod((err: ServiceError, data: any) => {
      assert(err);
      assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
      done();
    });
    call.write(testMessage);
    call.end();
  });
});

describe("Other conditions", () => {
  let client: ServiceClient;
  let server: Server;
  let port: number;

  before(done => {
    const trailerMetadata = new grpc.Metadata();

    server = new Server();
    trailerMetadata.add("trailer-present", "yes");

    server.addService(testServiceClient.service, {
      unary(call: ServerUnaryCall<any, any>, cb: sendUnaryData<any>) {
        const req = call.request;

        if (req.error) {
          const details = req.message || "Requested error";

          cb({ code: grpc.status.UNKNOWN, details } as ServiceError, null, trailerMetadata);
        } else {
          cb(null, { count: 1, message: "a".repeat(req.responseLength) }, trailerMetadata);
        }
      },

      clientStream(stream: ServerReadableStream<any, any>, cb: sendUnaryData<any>) {
        let count = 0;
        let errored = false;
        let responseLength = 0;

        stream.on("data", (data: any) => {
          if (data.error) {
            const message = data.message || "Requested error";
            errored = true;
            cb(new Error(message) as ServiceError, null, trailerMetadata);
          } else {
            responseLength += data.responseLength;
            count++;
          }
        });

        stream.on("end", () => {
          if (!errored) {
            cb(null, { count, message: "a".repeat(responseLength) }, trailerMetadata);
          }
        });
      },

      serverStream(stream: ServerWritableStream<any, any>) {
        const req = stream.request;

        if (req.error) {
          stream.emit("error", {
            code: grpc.status.UNKNOWN,
            details: req.message || "Requested error",
            metadata: trailerMetadata,
          });
        } else {
          for (let i = 1; i <= 5; i++) {
            stream.write({ count: i, message: "a".repeat(req.responseLength) });
            if (req.errorAfter && req.errorAfter === i) {
              stream.emit("error", {
                code: grpc.status.UNKNOWN,
                details: req.message || "Requested error",
                metadata: trailerMetadata,
              });
              break;
            }
          }
          if (!req.errorAfter) {
            stream.end(trailerMetadata);
          }
        }
      },

      bidiStream(stream: ServerDuplexStream<any, any>) {
        let count = 0;
        stream.on("data", (data: any) => {
          if (data.error) {
            const message = data.message || "Requested error";
            const err = new Error(message) as ServiceError;

            err.metadata = trailerMetadata.clone();
            err.metadata.add("count", "" + count);
            stream.emit("error", err);
          } else {
            stream.write({ count, message: "a".repeat(data.responseLength) });
            count++;
          }
        });

        stream.on("end", () => {
          stream.end(trailerMetadata);
        });
      },
    });

    server.bindAsync("localhost:0", serverInsecureCreds, (err, _port) => {
      assert.ifError(err);
      port = _port;
      client = new testServiceClient(`localhost:${port}`, clientInsecureCreds);
      server.start();
      done();
    });
  });

  after(() => {
    client.close();
    server.forceShutdown();
  });

  describe("Server receiving bad input", () => {
    let misbehavingClient: ServiceClient;
    const badArg = Buffer.from([0xff]);

    before(() => {
      const testServiceAttrs = {
        unary: {
          path: "/TestService/Unary",
          requestStream: false,
          responseStream: false,
          requestSerialize: identity,
          responseDeserialize: identity,
        },
        clientStream: {
          path: "/TestService/ClientStream",
          requestStream: true,
          responseStream: false,
          requestSerialize: identity,
          responseDeserialize: identity,
        },
        serverStream: {
          path: "/TestService/ServerStream",
          requestStream: false,
          responseStream: true,
          requestSerialize: identity,
          responseDeserialize: identity,
        },
        bidiStream: {
          path: "/TestService/BidiStream",
          requestStream: true,
          responseStream: true,
          requestSerialize: identity,
          responseDeserialize: identity,
        },
      } as any;

      const client = grpc.makeGenericClientConstructor(testServiceAttrs, "TestService");

      misbehavingClient = new client(`localhost:${port}`, clientInsecureCreds);
    });

    after(() => {
      misbehavingClient.close();
    });

    it("should respond correctly to a unary call", done => {
      misbehavingClient.unary(badArg, (err: ServiceError, data: any) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.INTERNAL);
        done();
      });
    });

    it("should respond correctly to a client stream", done => {
      const call = misbehavingClient.clientStream((err: ServiceError, data: any) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.INTERNAL);
        done();
      });

      call.write(badArg);
      call.end();
    });

    it("should respond correctly to a server stream", done => {
      const call = misbehavingClient.serverStream(badArg);

      call.on("data", (data: any) => {
        assert.fail(data);
      });

      call.on("error", (err: ServiceError) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.INTERNAL);
        done();
      });
    });

    it("should respond correctly to a bidi stream", done => {
      const call = misbehavingClient.bidiStream();

      call.on("data", (data: any) => {
        assert.fail(data);
      });

      call.on("error", (err: ServiceError) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.INTERNAL);
        done();
      });

      call.write(badArg);
      call.end();
    });
  });

  describe("Trailing metadata", () => {
    it("should be present when a unary call succeeds", done => {
      let count = 0;
      const call = client.unary({ error: false }, (err: ServiceError, data: any) => {
        assert.ifError(err);

        count++;
        if (count === 2) {
          done();
        }
      });

      call.on("status", (status: grpc.StatusObject) => {
        assert.deepStrictEqual(status.metadata.get("trailer-present"), ["yes"]);

        count++;
        if (count === 2) {
          done();
        }
      });
    });

    it("should be present when a unary call fails", done => {
      let count = 0;
      const call = client.unary({ error: true }, (err: ServiceError, data: any) => {
        assert(err);

        count++;
        if (count === 2) {
          done();
        }
      });

      call.on("status", (status: grpc.StatusObject) => {
        assert.deepStrictEqual(status.metadata.get("trailer-present"), ["yes"]);

        count++;
        if (count === 2) {
          done();
        }
      });
    });

    it("should be present when a client stream call succeeds", done => {
      let count = 0;
      const call = client.clientStream((err: ServiceError, data: any) => {
        assert.ifError(err);

        count++;
        if (count === 2) {
          done();
        }
      });

      call.write({ error: false });
      call.write({ error: false });
      call.end();

      call.on("status", (status: grpc.StatusObject) => {
        assert.deepStrictEqual(status.metadata.get("trailer-present"), ["yes"]);

        count++;
        if (count === 2) {
          done();
        }
      });
    });

    it("should be present when a client stream call fails", done => {
      let count = 0;
      const call = client.clientStream((err: ServiceError, data: any) => {
        assert(err);

        count++;
        if (count === 2) {
          done();
        }
      });

      call.write({ error: false });
      call.write({ error: true });
      call.end();

      call.on("status", (status: grpc.StatusObject) => {
        assert.deepStrictEqual(status.metadata.get("trailer-present"), ["yes"]);

        count++;
        if (count === 2) {
          done();
        }
      });
    });

    it("should be present when a server stream call succeeds", done => {
      const call = client.serverStream({ error: false });

      call.on("data", noop);
      call.on("status", (status: grpc.StatusObject) => {
        assert.strictEqual(status.code, grpc.status.OK);
        assert.deepStrictEqual(status.metadata.get("trailer-present"), ["yes"]);
        done();
      });
    });

    it("should be present when a server stream call fails", done => {
      const call = client.serverStream({ error: true });

      call.on("data", noop);
      call.on("error", (error: ServiceError) => {
        assert.deepStrictEqual(error.metadata.get("trailer-present"), ["yes"]);
        done();
      });
    });

    it("should be present when a bidi stream succeeds", done => {
      const call = client.bidiStream();

      call.write({ error: false });
      call.write({ error: false });
      call.end();
      call.on("data", noop);
      call.on("status", (status: grpc.StatusObject) => {
        assert.strictEqual(status.code, grpc.status.OK);
        assert.deepStrictEqual(status.metadata.get("trailer-present"), ["yes"]);
        done();
      });
    });

    it("should be present when a bidi stream fails", done => {
      const call = client.bidiStream();

      call.write({ error: false });
      call.write({ error: true });
      call.end();
      call.on("data", noop);
      call.on("error", (error: ServiceError) => {
        assert.deepStrictEqual(error.metadata.get("trailer-present"), ["yes"]);
        done();
      });
    });
  });

  describe("Error object should contain the status", () => {
    it("for a unary call", done => {
      client.unary({ error: true }, (err: ServiceError, data: any) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNKNOWN);
        assert.strictEqual(err.details, "Requested error");
        done();
      });
    });

    it("for a client stream call", done => {
      const call = client.clientStream((err: ServiceError, data: any) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNKNOWN);
        assert.strictEqual(err.details, "Requested error");
        done();
      });

      call.write({ error: false });
      call.write({ error: true });
      call.end();
    });

    it("for a server stream call", done => {
      const call = client.serverStream({ error: true });

      call.on("data", noop);
      call.on("error", (error: ServiceError) => {
        assert.strictEqual(error.code, grpc.status.UNKNOWN);
        assert.strictEqual(error.details, "Requested error");
        done();
      });
    });

    it("for a bidi stream call", done => {
      const call = client.bidiStream();

      call.write({ error: false });
      call.write({ error: true });
      call.end();
      call.on("data", noop);
      call.on("error", (error: ServiceError) => {
        assert.strictEqual(error.code, grpc.status.UNKNOWN);
        assert.strictEqual(error.details, "Requested error");
        done();
      });
    });

    it("for a UTF-8 error message", done => {
      client.unary({ error: true, message: "測試字符串" }, (err: ServiceError, data: any) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNKNOWN);
        assert.strictEqual(err.details, "測試字符串");
        done();
      });
    });

    it("for an error message with a comma", done => {
      client.unary({ error: true, message: "an error message, with a comma" }, (err: ServiceError, data: any) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNKNOWN);
        assert.strictEqual(err.details, "an error message, with a comma");
        done();
      });
    });
  });

  describe("should handle server stream errors correctly", () => {
    it("should emit data for all messages before error", done => {
      const expectedDataCount = 2;
      const call = client.serverStream({ errorAfter: expectedDataCount });

      let actualDataCount = 0;
      call.on("data", () => {
        ++actualDataCount;
      });
      call.on("error", (error: ServiceError) => {
        assert.strictEqual(error.code, grpc.status.UNKNOWN);
        assert.strictEqual(error.details, "Requested error");
        assert.strictEqual(actualDataCount, expectedDataCount);
        done();
      });
    });
  });

  describe("Max message size", () => {
    const largeMessage = "a".repeat(10_000_000);
    it.todo("Should be enforced on the server", done => {
      client.unary({ message: largeMessage }, (error?: ServiceError) => {
        assert(error);
        console.error(error);
        assert.strictEqual(error.code, grpc.status.RESOURCE_EXHAUSTED);
        done();
      });
    });
    it("Should be enforced on the client", done => {
      client.unary({ responseLength: 10_000_000 }, (error?: ServiceError) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.RESOURCE_EXHAUSTED);
        done();
      });
    });
    describe("Compressed messages", () => {
      it("Should be enforced with gzip", done => {
        const compressingClient = new testServiceClient(`localhost:${port}`, clientInsecureCreds, {
          "grpc.default_compression_algorithm": CompressionAlgorithms.gzip,
        });
        compressingClient.unary({ message: largeMessage }, (error?: ServiceError) => {
          assert(error);
          assert.strictEqual(error.code, grpc.status.RESOURCE_EXHAUSTED);
          assert.match(error.details, /Received message that decompresses to a size larger/);
          done();
        });
      });
      it("Should be enforced with deflate", done => {
        const compressingClient = new testServiceClient(`localhost:${port}`, clientInsecureCreds, {
          "grpc.default_compression_algorithm": CompressionAlgorithms.deflate,
        });
        compressingClient.unary({ message: largeMessage }, (error?: ServiceError) => {
          assert(error);
          assert.strictEqual(error.code, grpc.status.RESOURCE_EXHAUSTED);
          assert.match(error.details, /Received message that decompresses to a size larger/);
          done();
        });
      });
    });
  });
});

function identity(arg: any): any {
  return arg;
}

function noop(): void {}
