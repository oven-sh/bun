/*
 * Copyright 2021 gRPC authors.
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

import grpc from "@grpc/grpc-js";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";
import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert";

import { loadProtoFile } from "./common";

const TIMEOUT_SERVICE_CONFIG: grpc.ServiceConfig = {
  loadBalancingConfig: [],
  methodConfig: [
    {
      name: [{ service: "TestService" }],
      timeout: {
        seconds: 1,
        nanos: 0,
      },
    },
  ],
};

describe("Client with configured timeout", () => {
  let server: grpc.Server;
  let Client: ServiceClientConstructor;
  let client: ServiceClient;

  beforeAll(done => {
    Client = loadProtoFile(__dirname + "/fixtures/test_service.proto").TestService as ServiceClientConstructor;
    server = new grpc.Server();
    server.addService(Client.service, {
      unary: () => {},
      clientStream: () => {},
      serverStream: () => {},
      bidiStream: () => {},
    });
    server.bindAsync("localhost:0", grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        done(error);
        return;
      }
      server.start();
      client = new Client(`localhost:${port}`, grpc.credentials.createInsecure(), {
        "grpc.service_config": JSON.stringify(TIMEOUT_SERVICE_CONFIG),
      });
      done();
    });
  });

  afterAll(() => {
    client.close();
    server.forceShutdown();
  });

  it("Should end calls without explicit deadline with DEADLINE_EXCEEDED", done => {
    client.unary({}, (error: grpc.ServiceError, value: unknown) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
      done();
    });
  });

  it("Should end calls with a long explicit deadline with DEADLINE_EXCEEDED", done => {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 20);
    client.unary({}, (error: grpc.ServiceError, value: unknown) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
      done();
    });
  });
});
