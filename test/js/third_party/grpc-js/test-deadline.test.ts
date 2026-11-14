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
import diagnosticsChannel from "node:diagnostics_channel";
import type { ClientHttp2Session, ClientHttp2Stream } from "node:http2";

import { loadProtoFile } from "./common";

const TIMEOUT_SERVICE_CONFIG: grpc.ServiceConfig = {
  loadBalancingConfig: [],
  methodConfig: [
    {
      name: [{ service: "TestService" }],
      timeout: {
        seconds: 0,
        nanos: 300_000_000,
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

  it.concurrent("Should end calls without explicit deadline with DEADLINE_EXCEEDED", done => {
    client.unary({}, (error: grpc.ServiceError, value: unknown) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
      done();
    });
  });

  it.concurrent("Should end calls with a long explicit deadline with DEADLINE_EXCEEDED", done => {
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 20);
    client.unary({}, (error: grpc.ServiceError, value: unknown) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
      done();
    });
  });
});

// The server allows one stream per connection and the first call holds it until release(), so the calls
// behind it wait in the client's http2 session. grpc-js cancels a call with http2Stream.close(NGHTTP2_CANCEL).
describe("Client call that waits for a stream slot", () => {
  let server: grpc.Server;
  let client: ServiceClient;
  const handled: string[] = [];
  let release: () => void;
  let holdDone: Promise<void>;

  beforeAll(async () => {
    const Client = loadProtoFile(__dirname + "/fixtures/test_service.proto").TestService as ServiceClientConstructor;
    server = new grpc.Server({ "grpc.max_concurrent_streams": 1 });
    const { promise: held, resolve: gotHold } = Promise.withResolvers<void>();
    server.addService(Client.service, {
      unary: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
        const { message } = call.request;
        handled.push(message);
        if (message !== "hold") return callback(null, { message });
        release = () => callback(null, { message });
        gotHold();
      },
      clientStream: () => {},
      serverStream: () => {},
      bidiStream: () => {},
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) =>
        error ? reject(error) : resolve(port),
      ),
    );
    client = new Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    let session!: ClientHttp2Session;
    const onCreated = (message: unknown) =>
      void (session = (message as { stream: { session: ClientHttp2Session } }).stream.session);
    diagnosticsChannel.subscribe("http2.client.stream.created", onCreated);
    holdDone = new Promise<void>((resolve, reject) =>
      client.unary({ message: "hold" }, (error: grpc.ServiceError | null) => (error ? reject(error) : resolve())),
    );
    await held;
    diagnosticsChannel.unsubscribe("http2.client.stream.created", onCreated);
    // Calls only wait once the client's session knows the server's limit.
    while (session.remoteSettings.maxConcurrentStreams !== 1) {
      await new Promise(resolve => session.once("remoteSettings", resolve));
    }
  });

  afterAll(() => {
    client.close();
    server.forceShutdown();
  });

  it("doesn't send a call that was cancelled while it waited", async () => {
    const requests: ClientHttp2Stream[] = [];
    const onCreated = (message: unknown) => void requests.push((message as { stream: ClientHttp2Stream }).stream);
    diagnosticsChannel.subscribe("http2.client.stream.created", onCreated);
    try {
      const calls = ["cancelled0", "cancelled1", "cancelled2"].map(message => {
        const { promise, resolve } = Promise.withResolvers<grpc.status | undefined>();
        const call = client.unary({ message }, (error: grpc.ServiceError | null) => resolve(error?.code));
        return { call, code: promise };
      });
      // Wait until grpc-js has written each call's message to its request.
      while (requests.length < 3 || !requests.every(request => !request.pending || request.writableLength > 0)) {
        await new Promise(resolve => setImmediate(resolve));
      }
      const waiting = requests.map(request => request.pending);
      for (const { call } of calls) call.cancel();
      const codes = await Promise.all(calls.map(({ code }) => code));
      release();
      await holdDone;
      // Once this call is answered, the server has read every frame the client sent before it.
      await new Promise<void>((resolve, reject) =>
        client.unary({ message: "live" }, (error: grpc.ServiceError | null) => (error ? reject(error) : resolve())),
      );
      const CANCELLED = grpc.status.CANCELLED;
      assert.deepStrictEqual(
        { waiting, codes, handled },
        { waiting: [true, true, true], codes: [CANCELLED, CANCELLED, CANCELLED], handled: ["hold", "live"] },
      );
    } finally {
      diagnosticsChannel.unsubscribe("http2.client.stream.created", onCreated);
    }
  });
});
