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
import grpc from "@grpc/grpc-js";
import { Client, Server, ServerCredentials } from "@grpc/grpc-js/build/src";
import { ConnectivityState } from "@grpc/grpc-js/build/src/connectivity-state";
import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert";

const clientInsecureCreds = grpc.credentials.createInsecure();
const serverInsecureCreds = ServerCredentials.createInsecure();

describe("Client", () => {
  let server: Server;
  let client: Client;

  beforeAll(done => {
    server = new Server();

    server.bindAsync("localhost:0", serverInsecureCreds, (err, port) => {
      assert.ifError(err);
      client = new Client(`localhost:${port}`, clientInsecureCreds);
      server.start();
      done();
    });
  });

  afterAll(done => {
    client.close();
    server.tryShutdown(done);
  });

  it("should call the waitForReady callback only once, when channel connectivity state is READY", done => {
    const deadline = Date.now() + 100;
    let calledTimes = 0;
    client.waitForReady(deadline, err => {
      assert.ifError(err);
      assert.equal(client.getChannel().getConnectivityState(true), ConnectivityState.READY);
      calledTimes += 1;
    });
    setTimeout(() => {
      assert.equal(calledTimes, 1);
      done();
    }, deadline - Date.now());
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
  it("should fail multiple calls to the nonexistent server", function (done) {
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
  it("close should force calls to end", done => {
    client.makeUnaryRequest(
      "/service/method",
      x => x,
      x => x,
      Buffer.from([]),
      new grpc.Metadata({ waitForReady: true }),
      (error, value) => {
        assert(error);
        assert.strictEqual(error?.code, grpc.status.UNAVAILABLE);
        done();
      },
    );
    client.close();
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
  it("close should force calls to end", done => {
    client.makeUnaryRequest(
      "/service/method",
      x => x,
      x => x,
      Buffer.from([]),
      new grpc.Metadata({ waitForReady: true }),
      (error, value) => {
        assert(error);
        assert.strictEqual(error?.code, grpc.status.UNAVAILABLE);
        done();
      },
    );
    client.close();
  });
});
