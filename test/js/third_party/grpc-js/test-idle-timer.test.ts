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

import grpc from "@grpc/grpc-js";
import { afterAll as after, beforeAll as before, describe, it } from "bun:test";
import assert from "node:assert";

import { TestClient, TestServer } from "./common";

type Guard = <Args extends unknown[]>(fn: (...args: Args) => void) => (...args: Args) => void;

// grpc-js clamps the client idle timeout to a 1000ms floor, so each of these
// tests must really wait it out. They run concurrently (each has its own
// client; the server is shared read-only) so the waits overlap. `guard` routes
// assertion throws from timer/rpc callbacks into this test's own rejection.
async function runWithClient(client: TestClient, body: (done: (err?: unknown) => void, guard: Guard) => void) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const done = (err?: unknown) => (err ? reject(err) : resolve());
  const guard: Guard =
    fn =>
    (...args) => {
      try {
        fn(...args);
      } catch (err) {
        reject(err);
      }
    };
  try {
    body(done, guard);
    await promise;
  } finally {
    client.close();
  }
}

describe("Channel idle timer", () => {
  let server: TestServer;
  before(() => {
    server = new TestServer(false);
    return server.start();
  });
  after(() => {
    server.shutdown();
  });
  it.concurrent("Should go idle after the specified time after a request ends", () => {
    const client = TestClient.createFromServer(server, {
      "grpc.client_idle_timeout_ms": 1000,
    });
    return runWithClient(client, (done, guard) => {
      client.sendRequest(
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
          setTimeout(
            guard(() => {
              assert.strictEqual(client.getChannelState(), grpc.connectivityState.IDLE);
              done();
            }),
            1100,
          );
        }),
      );
    });
  });
  it.concurrent("Should be able to make a request after going idle", () => {
    const client = TestClient.createFromServer(server, {
      "grpc.client_idle_timeout_ms": 1000,
    });
    return runWithClient(client, (done, guard) => {
      client.sendRequest(
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
          setTimeout(
            guard(() => {
              assert.strictEqual(client.getChannelState(), grpc.connectivityState.IDLE);
              client.sendRequest(
                guard(error => {
                  assert.ifError(error);
                  done();
                }),
              );
            }),
            1100,
          );
        }),
      );
    });
  });
  it.concurrent("Should go idle after the specified time after waitForReady ends", () => {
    const client = TestClient.createFromServer(server, {
      "grpc.client_idle_timeout_ms": 1000,
    });
    return runWithClient(client, (done, guard) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 3);
      client.waitForReady(
        deadline,
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
          setTimeout(
            guard(() => {
              assert.strictEqual(client.getChannelState(), grpc.connectivityState.IDLE);
              done();
            }),
            1100,
          );
        }),
      );
    });
  });
  it.concurrent("Should ensure that the timeout is at least 1 second", () => {
    const client = TestClient.createFromServer(server, {
      "grpc.client_idle_timeout_ms": 50,
    });
    return runWithClient(client, (done, guard) => {
      client.sendRequest(
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
          setTimeout(
            guard(() => {
              // Should still be ready after 100ms
              assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
              setTimeout(
                guard(() => {
                  // Should go IDLE after another second
                  assert.strictEqual(client.getChannelState(), grpc.connectivityState.IDLE);
                  done();
                }),
                1000,
              );
            }),
            100,
          );
        }),
      );
    });
  });
});

describe("Channel idle timer with UDS", () => {
  let server: TestServer;
  before(() => {
    server = new TestServer(false);
    return server.startUds();
  });
  after(() => {
    server.shutdown();
  });
  it.concurrent("Should be able to make a request after going idle", () => {
    const client = TestClient.createFromServer(server, {
      "grpc.client_idle_timeout_ms": 1000,
    });
    return runWithClient(client, (done, guard) => {
      client.sendRequest(
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
          setTimeout(
            guard(() => {
              assert.strictEqual(client.getChannelState(), grpc.connectivityState.IDLE);
              client.sendRequest(
                guard(error => {
                  assert.ifError(error);
                  done();
                }),
              );
            }),
            1100,
          );
        }),
      );
    });
  });
});

describe("Server idle timer", () => {
  let server: TestServer;
  before(() => {
    server = new TestServer(false, {
      "grpc.max_connection_idle_ms": 500, // small for testing purposes
    });
    return server.start();
  });
  after(() => {
    server.shutdown();
  });

  it.concurrent("Should go idle after the specified time after a request ends", () => {
    const client = TestClient.createFromServer(server);
    return runWithClient(client, (done, guard) => {
      client.sendRequest(
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
          client.waitForClientState(Date.now() + 1500, grpc.connectivityState.IDLE, done);
        }),
      );
    });
  });

  it.concurrent("Should be able to make a request after going idle", () => {
    const client = TestClient.createFromServer(server);
    return runWithClient(client, (done, guard) => {
      client.sendRequest(
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);
          client.waitForClientState(
            Date.now() + 1500,
            grpc.connectivityState.IDLE,
            guard(err => {
              if (err) return done(err);

              assert.strictEqual(client.getChannelState(), grpc.connectivityState.IDLE);
              client.sendRequest(
                guard(error => {
                  assert.ifError(error);
                  done();
                }),
              );
            }),
          );
        }),
      );
    });
  });

  it.concurrent("Should go idle after the specified time after waitForReady ends", () => {
    const client = TestClient.createFromServer(server);
    return runWithClient(client, (done, guard) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 3);
      client.waitForReady(
        deadline,
        guard(error => {
          assert.ifError(error);
          assert.strictEqual(client.getChannelState(), grpc.connectivityState.READY);

          client.waitForClientState(Date.now() + 1500, grpc.connectivityState.IDLE, done);
        }),
      );
    });
  });
});
