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

import grpc, { sendUnaryData, Server, ServerCredentials, ServerUnaryCall, ServiceError } from "@grpc/grpc-js";
import { ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";
import { afterAll as after, beforeAll as before, describe, it } from "bun:test";
import assert from "node:assert";
import * as path from "path";

import { loadProtoFile } from "./common";

const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

describe("Local subchannel pool", () => {
  let server: Server;
  let serverPort: number;

  before(done => {
    server = new Server();
    server.addService(echoService.service, {
      echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
        callback(null, call.request);
      },
    });

    server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
      assert.ifError(err);
      serverPort = port;
      server.start();
      done();
    });
  });

  after(done => {
    server.tryShutdown(done);
  });

  it("should complete the client lifecycle without error", done => {
    const client = new echoService(`localhost:${serverPort}`, grpc.credentials.createInsecure(), {
      "grpc.use_local_subchannel_pool": 1,
    });
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert.ifError(error);
      assert.deepStrictEqual(response, { value: "test value", value2: 3 });
      client.close();
      done();
    });
  });
});
