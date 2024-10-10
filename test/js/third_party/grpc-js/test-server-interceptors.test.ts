/*
 * Copyright 2024 gRPC authors.
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

import assert from "assert";
import * as path from "path";
import * as grpc from "@grpc/grpc-js/build/src";
import { TestClient, loadProtoFile } from "./common";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService as grpc.ServiceClientConstructor;

const AUTH_HEADER_KEY = "auth";
const AUTH_HEADER_ALLOWED_VALUE = "allowed";
const testAuthInterceptor: grpc.ServerInterceptor = (methodDescriptor, call) => {
  const authListener = new grpc.ServerListenerBuilder()
    .withOnReceiveMetadata((metadata, mdNext) => {
      if (metadata.get(AUTH_HEADER_KEY)?.[0] !== AUTH_HEADER_ALLOWED_VALUE) {
        call.sendStatus({
          code: grpc.status.UNAUTHENTICATED,
          details: "Auth metadata not correct",
        });
      } else {
        mdNext(metadata);
      }
    })
    .build();
  const responder = new grpc.ResponderBuilder().withStart(next => next(authListener)).build();
  return new grpc.ServerInterceptingCall(call, responder);
};

let eventCounts = {
  receiveMetadata: 0,
  receiveMessage: 0,
  receiveHalfClose: 0,
  sendMetadata: 0,
  sendMessage: 0,
  sendStatus: 0,
};

function resetEventCounts() {
  eventCounts = {
    receiveMetadata: 0,
    receiveMessage: 0,
    receiveHalfClose: 0,
    sendMetadata: 0,
    sendMessage: 0,
    sendStatus: 0,
  };
}

/**
 * Test interceptor to verify that interceptors see each expected event by
 * counting each kind of event.
 * @param methodDescription
 * @param call
 */
const testLoggingInterceptor: grpc.ServerInterceptor = (methodDescription, call) => {
  return new grpc.ServerInterceptingCall(call, {
    start: next => {
      next({
        onReceiveMetadata: (metadata, mdNext) => {
          eventCounts.receiveMetadata += 1;
          mdNext(metadata);
        },
        onReceiveMessage: (message, messageNext) => {
          eventCounts.receiveMessage += 1;
          messageNext(message);
        },
        onReceiveHalfClose: hcNext => {
          eventCounts.receiveHalfClose += 1;
          hcNext();
        },
      });
    },
    sendMetadata: (metadata, mdNext) => {
      eventCounts.sendMetadata += 1;
      mdNext(metadata);
    },
    sendMessage: (message, messageNext) => {
      eventCounts.sendMessage += 1;
      messageNext(message);
    },
    sendStatus: (status, statusNext) => {
      eventCounts.sendStatus += 1;
      statusNext(status);
    },
  });
};

const testHeaderInjectionInterceptor: grpc.ServerInterceptor = (methodDescriptor, call) => {
  return new grpc.ServerInterceptingCall(call, {
    start: next => {
      const authListener: grpc.ServerListener = {
        onReceiveMetadata: (metadata, mdNext) => {
          metadata.set("injected-header", "present");
          mdNext(metadata);
        },
      };
      next(authListener);
    },
  });
};

describe("Server interceptors", () => {
  describe("Auth-type interceptor", () => {
    let server: grpc.Server;
    let client: TestClient;
    /* Tests that an interceptor can entirely prevent the handler from being
     * invoked, based on the contents of the metadata. */
    before(done => {
      server = new grpc.Server({ interceptors: [testAuthInterceptor] });
      server.addService(echoService.service, {
        echo: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
          // A test will fail if a request makes it to the handler without the correct auth header
          assert.strictEqual(call.metadata.get(AUTH_HEADER_KEY)?.[0], AUTH_HEADER_ALLOWED_VALUE);
          callback(null, call.request);
        },
      });
      server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
        assert.ifError(error);
        client = new TestClient(`localhost:${port}`, false);
        done();
      });
    });
    after(() => {
      client.close();
      server.forceShutdown();
    });
    it("Should accept a request with the expected header", done => {
      const requestMetadata = new grpc.Metadata();
      requestMetadata.set(AUTH_HEADER_KEY, AUTH_HEADER_ALLOWED_VALUE);
      client.sendRequestWithMetadata(requestMetadata, done);
    });
    it("Should reject a request without the expected header", done => {
      const requestMetadata = new grpc.Metadata();
      requestMetadata.set(AUTH_HEADER_KEY, "not allowed");
      client.sendRequestWithMetadata(requestMetadata, error => {
        assert.strictEqual(error?.code, grpc.status.UNAUTHENTICATED);
        done();
      });
    });
  });
  describe("Logging-type interceptor", () => {
    let server: grpc.Server;
    let client: TestClient;
    before(done => {
      server = new grpc.Server({ interceptors: [testLoggingInterceptor] });
      server.addService(echoService.service, {
        echo: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
          call.sendMetadata(new grpc.Metadata());
          callback(null, call.request);
        },
      });
      server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
        assert.ifError(error);
        client = new TestClient(`localhost:${port}`, false);
        done();
      });
    });
    after(() => {
      client.close();
      server.forceShutdown();
    });
    beforeEach(() => {
      resetEventCounts();
    });
    it("Should see every event once", done => {
      client.sendRequest(error => {
        assert.ifError(error);
        assert.deepStrictEqual(eventCounts, {
          receiveMetadata: 1,
          receiveMessage: 1,
          receiveHalfClose: 1,
          sendMetadata: 1,
          sendMessage: 1,
          sendStatus: 1,
        });
        done();
      });
    });
  });
  describe("Header injection interceptor", () => {
    let server: grpc.Server;
    let client: TestClient;
    before(done => {
      server = new grpc.Server({
        interceptors: [testHeaderInjectionInterceptor],
      });
      server.addService(echoService.service, {
        echo: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
          assert.strictEqual(call.metadata.get("injected-header")?.[0], "present");
          callback(null, call.request);
        },
      });
      server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
        assert.ifError(error);
        client = new TestClient(`localhost:${port}`, false);
        done();
      });
    });
    after(() => {
      client.close();
      server.forceShutdown();
    });
    it("Should inject the header for the handler to see", done => {
      client.sendRequest(done);
    });
  });
  describe("Multiple interceptors", () => {
    let server: grpc.Server;
    let client: TestClient;
    before(done => {
      server = new grpc.Server({
        interceptors: [testAuthInterceptor, testLoggingInterceptor, testHeaderInjectionInterceptor],
      });
      server.addService(echoService.service, {
        echo: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
          assert.strictEqual(call.metadata.get(AUTH_HEADER_KEY)?.[0], AUTH_HEADER_ALLOWED_VALUE);
          assert.strictEqual(call.metadata.get("injected-header")?.[0], "present");
          call.sendMetadata(new grpc.Metadata());
          callback(null, call.request);
        },
      });
      server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
        assert.ifError(error);
        client = new TestClient(`localhost:${port}`, false);
        done();
      });
    });
    after(() => {
      client.close();
      server.forceShutdown();
    });
    beforeEach(() => {
      resetEventCounts();
    });
    it("Should not log requests rejected by auth", done => {
      const requestMetadata = new grpc.Metadata();
      requestMetadata.set(AUTH_HEADER_KEY, "not allowed");
      client.sendRequestWithMetadata(requestMetadata, error => {
        assert.strictEqual(error?.code, grpc.status.UNAUTHENTICATED);
        assert.deepStrictEqual(eventCounts, {
          receiveMetadata: 0,
          receiveMessage: 0,
          receiveHalfClose: 0,
          sendMetadata: 0,
          sendMessage: 0,
          sendStatus: 0,
        });
        done();
      });
    });
    it("Should log requests accepted by auth", done => {
      const requestMetadata = new grpc.Metadata();
      requestMetadata.set(AUTH_HEADER_KEY, AUTH_HEADER_ALLOWED_VALUE);
      client.sendRequestWithMetadata(requestMetadata, error => {
        assert.ifError(error);
        assert.deepStrictEqual(eventCounts, {
          receiveMetadata: 1,
          receiveMessage: 1,
          receiveHalfClose: 1,
          sendMetadata: 1,
          sendMessage: 1,
          sendStatus: 1,
        });
        done();
      });
    });
  });
});
