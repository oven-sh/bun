/*
 * Copyright 2023 gRPC authors.
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

import * as path from "path";
import assert from "node:assert";
import grpc, { Server, ServerCredentials, ServerUnaryCall, ServiceError, sendUnaryData } from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, it, afterEach, beforeEach } from "bun:test";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";

import { loadProtoFile } from "./common";

const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

describe("Global subchannel pool", () => {
  let server: Server;
  let serverPort: number;

  let client1: InstanceType<grpc.ServiceClientConstructor>;
  let client2: InstanceType<grpc.ServiceClientConstructor>;

  let promises: Promise<any>[];

  beforeAll(done => {
    server = new Server();
    server.addService(echoService.service, {
      echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
        callback(null, call.request);
      },
    });

    server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (err, port) => {
      assert.ifError(err);
      serverPort = port;
      server.start();
      done();
    });
  });

  beforeEach(() => {
    promises = [];
  });

  afterAll(() => {
    server.forceShutdown();
  });

  function callService(client: InstanceType<grpc.ServiceClientConstructor>) {
    return new Promise<void>(resolve => {
      const request = { value: "test value", value2: 3 };

      client.echo(request, (error: ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, request);
        resolve();
      });
    });
  }

  function connect() {
    const grpcOptions = {
      "grpc.use_local_subchannel_pool": 0,
    };

    client1 = new echoService(`127.0.0.1:${serverPort}`, grpc.credentials.createInsecure(), grpcOptions);

    client2 = new echoService(`127.0.0.1:${serverPort}`, grpc.credentials.createInsecure(), grpcOptions);
  }

  /* This is a regression test for a bug where client1.close in the
   * waitForReady callback would cause the subchannel to transition to IDLE
   * even though client2 is also using it. */
  it("Should handle client.close calls in waitForReady", done => {
    connect();

    promises.push(
      new Promise<void>(resolve => {
        client1.waitForReady(Date.now() + 1500, error => {
          assert.ifError(error);
          client1.close();
          resolve();
        });
      }),
    );

    promises.push(
      new Promise<void>(resolve => {
        client2.waitForReady(Date.now() + 1500, error => {
          assert.ifError(error);
          resolve();
        });
      }),
    );

    Promise.all(promises).then(() => {
      done();
    });
  });

  it("Call the service", done => {
    promises.push(callService(client2));

    Promise.all(promises).then(() => {
      done();
    });
  });

  it("Should complete the client lifecycle without error", done => {
    setTimeout(() => {
      client1.close();
      client2.close();
      done();
    }, 500);
  });
});
