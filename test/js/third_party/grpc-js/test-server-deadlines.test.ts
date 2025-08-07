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
import * as path from "path";

import * as grpc from "@grpc/grpc-js/build/src";
import { Server, ServerCredentials } from "@grpc/grpc-js/build/src";
import { ServiceError } from "@grpc/grpc-js/build/src/call";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";
import { sendUnaryData, ServerUnaryCall, ServerWritableStream } from "@grpc/grpc-js/build/src/server-call";
import { afterAll as after, beforeAll as before, describe, it } from "bun:test";

import { loadProtoFile } from "./common";

const clientInsecureCreds = grpc.credentials.createInsecure();
const serverInsecureCreds = ServerCredentials.createInsecure();

describe("Server deadlines", () => {
  let server: Server;
  let client: ServiceClient;

  before(done => {
    const protoFile = path.join(__dirname, "fixtures", "test_service.proto");
    const testServiceDef = loadProtoFile(protoFile);
    const testServiceClient = testServiceDef.TestService as ServiceClientConstructor;

    server = new Server();
    server.addService(testServiceClient.service, {
      unary(call: ServerUnaryCall<any, any>, cb: sendUnaryData<any>) {
        setTimeout(() => {
          cb(null, {});
        }, 2000);
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

  it("works with deadlines", done => {
    const metadata = new grpc.Metadata();
    const { path, requestSerialize: serialize, responseDeserialize: deserialize } = client.unary as any;

    metadata.set("grpc-timeout", "100m");
    client.makeUnaryRequest(path, serialize, deserialize, {}, metadata, {}, (error: any, response: any) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
      assert.strictEqual(error.details, "Deadline exceeded");
      done();
    });
  });

  it("rejects invalid deadline", done => {
    const metadata = new grpc.Metadata();
    const { path, requestSerialize: serialize, responseDeserialize: deserialize } = client.unary as any;

    metadata.set("grpc-timeout", "Infinity");
    client.makeUnaryRequest(path, serialize, deserialize, {}, metadata, {}, (error: any, response: any) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.INTERNAL);
      assert.match(error.details, /^Invalid grpc-timeout value/);
      done();
    });
  });
});

describe("Cancellation", () => {
  let server: Server;
  let client: ServiceClient;
  let inHandler = false;
  let cancelledInServer = false;

  before(done => {
    const protoFile = path.join(__dirname, "fixtures", "test_service.proto");
    const testServiceDef = loadProtoFile(protoFile);
    const testServiceClient = testServiceDef.TestService as ServiceClientConstructor;

    server = new Server();
    server.addService(testServiceClient.service, {
      serverStream(stream: ServerWritableStream<any, any>) {
        inHandler = true;
        stream.on("cancelled", () => {
          stream.write({});
          stream.end();
          cancelledInServer = true;
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

  it("handles requests cancelled by the client", done => {
    const call = client.serverStream({});

    call.on("data", assert.ifError);
    call.on("error", (error: ServiceError) => {
      assert.strictEqual(error.code, grpc.status.CANCELLED);
      assert.strictEqual(error.details, "Cancelled on client");
      waitForServerCancel();
    });

    function waitForHandler() {
      if (inHandler === true) {
        call.cancel();
        return;
      }

      setImmediate(waitForHandler);
    }

    function waitForServerCancel() {
      if (cancelledInServer === true) {
        done();
        return;
      }

      setImmediate(waitForServerCancel);
    }

    waitForHandler();
  });
});
