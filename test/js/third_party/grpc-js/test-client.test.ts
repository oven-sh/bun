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

import assert from "assert";

import * as grpc from "@grpc/grpc-js";
import { Client } from "@grpc/grpc-js";
import { ConnectivityState, TestClient, TestServer } from "./common";
import { describe, it, afterAll, beforeAll } from "bun:test";

const clientInsecureCreds = grpc.credentials.createInsecure();

["h2", "h2c"].forEach(protocol => {
  describe(`Client ${protocol}`, () => {
    it("should call the waitForReady callback only once, when channel connectivity state is READY", async () => {
      const server = new TestServer(protocol === "h2");
      await server.start();
      const client = TestClient.createFromServer(server);
      try {
        const { promise, resolve, reject } = Promise.withResolvers();
        const deadline = Date.now() + 1000;
        let calledTimes = 0;
        client.waitForReady(deadline, err => {
          calledTimes++;
          try {
            assert.ifError(err);
            assert.equal(client.getChannel().getConnectivityState(true), ConnectivityState.READY);
            resolve(undefined);
          } catch (e) {
            reject(e);
          }
        });
        await promise;
        assert.equal(calledTimes, 1);
      } finally {
        client?.close();
        server.shutdown();
      }
    });
  });
});

describe("Client without a server", () => {
  let client: Client;
  beforeAll(() => {
    // Arbitrary target that should not have a running server
    client = new Client("localhost:12345", clientInsecureCreds);
  });
  afterAll(() => {
    client.close();
  });
  // This test is flaky because error.stack sometimes undefined aka TypeError: undefined is not an object (evaluating 'error.stack.split')
  it.skip("should fail multiple calls to the nonexistent server", function (done) {
    // Regression test for https://github.com/grpc/grpc-node/issues/1411
    client.makeUnaryRequest(
      "/service/method",
      x => x,
      x => x,
      Buffer.from([]),
      (error, value) => {
        assert(error);
        assert.strictEqual(error?.code, grpc.status.UNAVAILABLE);
        client.makeUnaryRequest(
          "/service/method",
          x => x,
          x => x,
          Buffer.from([]),
          (error, value) => {
            assert(error);
            assert.strictEqual(error?.code, grpc.status.UNAVAILABLE);
            done();
          },
        );
      },
    );
  });
});

describe("Client with a nonexistent target domain", () => {
  let client: Client;
  beforeAll(() => {
    // DNS name that does not exist per RFC 6761 section 6.4
    client = new Client("host.invalid", clientInsecureCreds);
  });
  afterAll(() => {
    client.close();
  });
  it("should fail multiple calls", function (done) {
    // Regression test for https://github.com/grpc/grpc-node/issues/1411
    client.makeUnaryRequest(
      "/service/method",
      x => x,
      x => x,
      Buffer.from([]),
      (error, value) => {
        assert(error);
        assert.strictEqual(error?.code, grpc.status.UNAVAILABLE);
        client.makeUnaryRequest(
          "/service/method",
          x => x,
          x => x,
          Buffer.from([]),
          (error, value) => {
            assert(error);
            assert.strictEqual(error?.code, grpc.status.UNAVAILABLE);
            done();
          },
        );
      },
    );
  });
});
