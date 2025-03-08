/*
 * Copyright 2020 gRPC authors.
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

import assert from "node:assert";
import grpc from "@grpc/grpc-js";
import { loadProtoFile } from "./common.ts";
import { afterAll, beforeAll, describe, it, afterEach } from "bun:test";

function multiDone(done: () => void, target: number) {
  let count = 0;
  return () => {
    count++;
    if (count >= target) {
      done();
    }
  };
}

describe("Call propagation", () => {
  let server: grpc.Server;
  let Client;
  let client;
  let proxyServer: grpc.Server;
  let proxyClient;

  beforeAll(done => {
    Client = loadProtoFile(__dirname + "/fixtures/test_service.proto").TestService;
    server = new grpc.Server();
    server.addService(Client.service, {
      unary: () => {},
      clientStream: () => {},
      serverStream: () => {},
      bidiStream: () => {},
    });
    proxyServer = new grpc.Server();
    server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        done(error);
        return;
      }
      server.start();
      client = new Client(`localhost:${port}`, grpc.credentials.createInsecure());
      proxyServer.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, proxyPort) => {
        if (error) {
          done(error);
          return;
        }
        proxyServer.start();
        proxyClient = new Client(`localhost:${proxyPort}`, grpc.credentials.createInsecure());
        done();
      });
    });
  });
  afterEach(() => {
    proxyServer.removeService(Client.service);
  });
  afterAll(() => {
    server.forceShutdown();
    proxyServer.forceShutdown();
  });
  describe("Cancellation", () => {
    it.todo("should work with unary requests", done => {
      done = multiDone(done, 2);
      // eslint-disable-next-line prefer-const
      let call: grpc.ClientUnaryCall;
      proxyServer.addService(Client.service, {
        unary: (parent: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
          client.unary(parent.request, { parent: parent }, (error: grpc.ServiceError, value: unknown) => {
            callback(error, value);
            assert(error);
            assert.strictEqual(error.code, grpc.status.CANCELLED);
            done();
          });
          /* Cancel the original call after the server starts processing it to
           * ensure that it does reach the server. */
          call.cancel();
        },
      });
      call = proxyClient.unary({}, (error: grpc.ServiceError, value: unknown) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.CANCELLED);
        done();
      });
    });
    it("Should work with client streaming requests", done => {
      done = multiDone(done, 2);
      // eslint-disable-next-line prefer-const
      let call: grpc.ClientWritableStream<unknown>;
      proxyServer.addService(Client.service, {
        clientStream: (parent: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>) => {
          client.clientStream({ parent: parent }, (error: grpc.ServiceError, value: unknown) => {
            callback(error, value);
            assert(error);
            assert.strictEqual(error.code, grpc.status.CANCELLED);
            done();
          });
          /* Cancel the original call after the server starts processing it to
           * ensure that it does reach the server. */
          call.cancel();
        },
      });
      call = proxyClient.clientStream((error: grpc.ServiceError, value: unknown) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.CANCELLED);
        done();
      });
    });
    it.todo("Should work with server streaming requests", done => {
      done = multiDone(done, 2);
      // eslint-disable-next-line prefer-const
      let call: grpc.ClientReadableStream<unknown>;
      proxyServer.addService(Client.service, {
        serverStream: (parent: grpc.ServerWritableStream<any, any>) => {
          const child = client.serverStream(parent.request, { parent: parent });
          child.on("error", () => {});
          child.on("status", (status: grpc.StatusObject) => {
            assert.strictEqual(status.code, grpc.status.CANCELLED);
            done();
          });
          call.cancel();
        },
      });
      call = proxyClient.serverStream({});
      call.on("error", () => {});
      call.on("status", (status: grpc.StatusObject) => {
        assert.strictEqual(status.code, grpc.status.CANCELLED);
        done();
      });
    });
    it("Should work with bidi streaming requests", done => {
      done = multiDone(done, 2);
      // eslint-disable-next-line prefer-const
      let call: grpc.ClientDuplexStream<unknown, unknown>;
      proxyServer.addService(Client.service, {
        bidiStream: (parent: grpc.ServerDuplexStream<any, any>) => {
          const child = client.bidiStream({ parent: parent });
          child.on("error", () => {});
          child.on("status", (status: grpc.StatusObject) => {
            assert.strictEqual(status.code, grpc.status.CANCELLED);
            done();
          });
          call.cancel();
        },
      });
      call = proxyClient.bidiStream();
      call.on("error", () => {});
      call.on("status", (status: grpc.StatusObject) => {
        assert.strictEqual(status.code, grpc.status.CANCELLED);
        done();
      });
    });
  });
  describe("Deadlines", () => {
    it("should work with unary requests", done => {
      done = multiDone(done, 2);
      proxyServer.addService(Client.service, {
        unary: (parent: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
          client.unary(
            parent.request,
            { parent: parent, propagate_flags: grpc.propagate.DEADLINE },
            (error: grpc.ServiceError, value: unknown) => {
              callback(error, value);
              assert(error);
              assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
              done();
            },
          );
        },
      });
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + 100);
      proxyClient.unary({}, { deadline }, (error: grpc.ServiceError, value: unknown) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
        done();
      });
    });
    it("Should work with client streaming requests", done => {
      done = multiDone(done, 2);

      proxyServer.addService(Client.service, {
        clientStream: (parent: grpc.ServerReadableStream<any, any>, callback: grpc.sendUnaryData<any>) => {
          client.clientStream(
            { parent: parent, propagate_flags: grpc.propagate.DEADLINE },
            (error: grpc.ServiceError, value: unknown) => {
              callback(error, value);
              assert(error);
              assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
              done();
            },
          );
        },
      });
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + 100);
      proxyClient.clientStream(
        { deadline, propagate_flags: grpc.propagate.DEADLINE },
        (error: grpc.ServiceError, value: unknown) => {
          assert(error);
          assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
          done();
        },
      );
    });
    it("Should work with server streaming requests", done => {
      done = multiDone(done, 2);
      let call: grpc.ClientReadableStream<unknown>;
      proxyServer.addService(Client.service, {
        serverStream: (parent: grpc.ServerWritableStream<any, any>) => {
          const child = client.serverStream(parent.request, {
            parent: parent,
            propagate_flags: grpc.propagate.DEADLINE,
          });
          child.on("error", () => {});
          child.on("status", (status: grpc.StatusObject) => {
            assert.strictEqual(status.code, grpc.status.DEADLINE_EXCEEDED);
            done();
          });
        },
      });
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + 100);
      // eslint-disable-next-line prefer-const
      call = proxyClient.serverStream({}, { deadline });
      call.on("error", () => {});
      call.on("status", (status: grpc.StatusObject) => {
        assert.strictEqual(status.code, grpc.status.DEADLINE_EXCEEDED);
        done();
      });
    });
    it("Should work with bidi streaming requests", done => {
      done = multiDone(done, 2);
      let call: grpc.ClientDuplexStream<unknown, unknown>;
      proxyServer.addService(Client.service, {
        bidiStream: (parent: grpc.ServerDuplexStream<any, any>) => {
          const child = client.bidiStream({
            parent: parent,
            propagate_flags: grpc.propagate.DEADLINE,
          });
          child.on("error", () => {});
          child.on("status", (status: grpc.StatusObject) => {
            assert.strictEqual(status.code, grpc.status.DEADLINE_EXCEEDED);
            done();
          });
        },
      });
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + 100);
      // eslint-disable-next-line prefer-const
      call = proxyClient.bidiStream({ deadline });
      call.on("error", () => {});
      call.on("status", (status: grpc.StatusObject) => {
        assert.strictEqual(status.code, grpc.status.DEADLINE_EXCEEDED);
        done();
      });
    });
  });
});
