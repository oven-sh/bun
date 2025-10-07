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
import * as protoLoader from "@grpc/proto-loader";
import assert from "assert";
import * as fs from "fs";
import * as http2 from "http2";
import * as net from "net";
import * as path from "path";

import * as grpc from "@grpc/grpc-js/build/src";
import { Server, ServerCredentials } from "@grpc/grpc-js/build/src";
import { ServiceError } from "@grpc/grpc-js/build/src/call";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";
import { sendUnaryData, ServerDuplexStream, ServerUnaryCall } from "@grpc/grpc-js/build/src/server-call";

import { CompressionAlgorithms } from "@grpc/grpc-js/build/src/compression-algorithms";
import { afterEach as after, afterEach, beforeEach as before, beforeEach, describe, it } from "bun:test";
import { SecureContextOptions } from "tls";
import { assert2, loadProtoFile } from "./common";
import { Request__Output } from "./generated/Request";
import { TestServiceClient, TestServiceHandlers } from "./generated/TestService";
import { ProtoGrpcType as TestServiceGrpcType } from "./generated/test_service";

const loadedTestServiceProto = protoLoader.loadSync(path.join(__dirname, "fixtures/test_service.proto"), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const testServiceGrpcObject = grpc.loadPackageDefinition(loadedTestServiceProto) as unknown as TestServiceGrpcType;

const ca = fs.readFileSync(path.join(__dirname, "fixtures", "ca.pem"));
const key = fs.readFileSync(path.join(__dirname, "fixtures", "server1.key"));
const cert = fs.readFileSync(path.join(__dirname, "fixtures", "server1.pem"));
function noop(): void {}

describe("Server", () => {
  let server: Server;
  beforeEach(() => {
    server = new Server();
  });
  afterEach(() => {
    server.forceShutdown();
  });
  describe("constructor", () => {
    it("should work with no arguments", () => {
      assert.doesNotThrow(() => {
        new Server(); // tslint:disable-line:no-unused-expression
      });
    });

    it("should work with an empty object argument", () => {
      assert.doesNotThrow(() => {
        new Server({}); // tslint:disable-line:no-unused-expression
      });
    });

    it("should be an instance of Server", () => {
      const server = new Server();

      assert(server instanceof Server);
    });
  });

  describe("bindAsync", () => {
    it("binds with insecure credentials", done => {
      const server = new Server();

      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        assert(typeof port === "number" && port > 0);
        server.forceShutdown();
        done();
      });
    });

    it("binds with secure credentials", done => {
      const server = new Server();
      const creds = ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }], true);

      server.bindAsync("localhost:0", creds, (err, port) => {
        assert.ifError(err);
        assert(typeof port === "number" && port > 0);
        server.forceShutdown();
        done();
      });
    });

    it("throws on invalid inputs", () => {
      const server = new Server();

      assert.throws(() => {
        server.bindAsync(null as any, ServerCredentials.createInsecure(), noop);
      }, /port must be a string/);

      assert.throws(() => {
        server.bindAsync("localhost:0", null as any, noop);
      }, /creds must be a ServerCredentials object/);

      assert.throws(() => {
        server.bindAsync("localhost:0", grpc.credentials.createInsecure() as any, noop);
      }, /creds must be a ServerCredentials object/);

      assert.throws(() => {
        server.bindAsync("localhost:0", ServerCredentials.createInsecure(), null as any);
      }, /callback must be a function/);
    });

    it("succeeds when called with an already bound port", done => {
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        server.bindAsync(`localhost:${port}`, ServerCredentials.createInsecure(), (err2, port2) => {
          assert.ifError(err2);
          assert.strictEqual(port, port2);
          done();
        });
      });
    });

    it("fails when called on a bound port with different credentials", done => {
      const secureCreds = ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }], true);
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        server.bindAsync(`localhost:${port}`, secureCreds, (err2, port2) => {
          assert(err2 !== null);
          assert.match(err2.message, /credentials/);
          done();
        });
      });
    });
  });

  describe("unbind", () => {
    let client: grpc.Client | null = null;
    beforeEach(() => {
      client = null;
    });
    afterEach(() => {
      client?.close();
    });
    it("refuses to unbind port 0", done => {
      assert.throws(() => {
        server.unbind("localhost:0");
      }, /port 0/);
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        assert.notStrictEqual(port, 0);
        assert.throws(() => {
          server.unbind("localhost:0");
        }, /port 0/);
        done();
      });
    });

    it("successfully unbinds a bound ephemeral port", done => {
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        client = new grpc.Client(`localhost:${port}`, grpc.credentials.createInsecure());
        client.makeUnaryRequest(
          "/math.Math/Div",
          x => x,
          x => x,
          Buffer.from("abc"),
          (callError1, result) => {
            assert(callError1);
            // UNIMPLEMENTED means that the request reached the call handling code
            assert.strictEqual(callError1.code, grpc.status.UNIMPLEMENTED);
            server.unbind(`localhost:${port}`);
            const deadline = new Date();
            deadline.setSeconds(deadline.getSeconds() + 1);
            client!.makeUnaryRequest(
              "/math.Math/Div",
              x => x,
              x => x,
              Buffer.from("abc"),
              { deadline: deadline },
              (callError2, result) => {
                assert(callError2);
                // DEADLINE_EXCEEDED means that the server is unreachable
                assert(
                  callError2.code === grpc.status.DEADLINE_EXCEEDED || callError2.code === grpc.status.UNAVAILABLE,
                );
                done();
              },
            );
          },
        );
      });
    });

    it("cancels a bindAsync in progress", done => {
      server.bindAsync("localhost:50051", ServerCredentials.createInsecure(), (err, port) => {
        assert(err);
        assert.match(err.message, /cancelled by unbind/);
        done();
      });
      server.unbind("localhost:50051");
    });
  });

  describe("drain", () => {
    let client: ServiceClient;
    let portNumber: number;
    const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
    const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

    const serviceImplementation = {
      echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
        callback(null, call.request);
      },
      echoBidiStream(call: ServerDuplexStream<any, any>) {
        call.on("data", data => {
          call.write(data);
        });
        call.on("end", () => {
          call.end();
        });
      },
    };

    beforeEach(done => {
      server.addService(echoService.service, serviceImplementation);

      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        portNumber = port;
        client = new echoService(`localhost:${port}`, grpc.credentials.createInsecure());
        server.start();
        done();
      });
    });

    afterEach(() => {
      client.close();
      server.forceShutdown();
    });

    it.todo("Should cancel open calls after the grace period ends", done => {
      const call = client.echoBidiStream();
      call.on("error", (error: ServiceError) => {
        assert.strictEqual(error.code, grpc.status.CANCELLED);
        done();
      });
      call.on("data", () => {
        server.drain(`localhost:${portNumber!}`, 100);
      });
      call.write({ value: "abc" });
    });
  });

  describe("start", () => {
    let server: Server;

    beforeEach(done => {
      server = new Server();
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), done);
    });

    afterEach(() => {
      server.forceShutdown();
    });

    it("starts without error", () => {
      assert.doesNotThrow(() => {
        server.start();
      });
    });

    it("throws if started twice", () => {
      server.start();
      assert.throws(() => {
        server.start();
      }, /server is already started/);
    });

    it("throws if the server is not bound", () => {
      const server = new Server();

      assert.throws(() => {
        server.start();
      }, /server must be bound in order to start/);
    });
  });

  describe("addService", () => {
    const mathProtoFile = path.join(__dirname, "fixtures", "math.proto");
    const mathClient = (loadProtoFile(mathProtoFile).math as any).Math;
    const mathServiceAttrs = mathClient.service;
    const dummyImpls = { div() {}, divMany() {}, fib() {}, sum() {} };
    const altDummyImpls = { Div() {}, DivMany() {}, Fib() {}, Sum() {} };

    it("succeeds with a single service", () => {
      const server = new Server();

      assert.doesNotThrow(() => {
        server.addService(mathServiceAttrs, dummyImpls);
      });
    });

    it("fails to add an empty service", () => {
      const server = new Server();

      assert.throws(() => {
        server.addService({}, dummyImpls);
      }, /Cannot add an empty service to a server/);
    });

    it("fails with conflicting method names", () => {
      const server = new Server();

      server.addService(mathServiceAttrs, dummyImpls);
      assert.throws(() => {
        server.addService(mathServiceAttrs, dummyImpls);
      }, /Method handler for .+ already provided/);
    });

    it("supports method names as originally written", () => {
      const server = new Server();

      assert.doesNotThrow(() => {
        server.addService(mathServiceAttrs, altDummyImpls);
      });
    });

    it("succeeds after server has been started", done => {
      const server = new Server();

      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        server.start();
        assert.doesNotThrow(() => {
          server.addService(mathServiceAttrs, dummyImpls);
        });
        server.forceShutdown();
        done();
      });
    });
  });

  describe("removeService", () => {
    let server: Server;
    let client: ServiceClient;

    const mathProtoFile = path.join(__dirname, "fixtures", "math.proto");
    const mathClient = (loadProtoFile(mathProtoFile).math as any).Math;
    const mathServiceAttrs = mathClient.service;
    const dummyImpls = { div() {}, divMany() {}, fib() {}, sum() {} };

    beforeEach(done => {
      server = new Server();
      server.addService(mathServiceAttrs, dummyImpls);
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        client = new mathClient(`localhost:${port}`, grpc.credentials.createInsecure());
        server.start();
        done();
      });
    });

    afterEach(() => {
      client.close();
      server.forceShutdown();
    });

    it("succeeds with a single service by removing all method handlers", done => {
      server.removeService(mathServiceAttrs);

      let methodsVerifiedCount = 0;
      const methodsToVerify = Object.keys(mathServiceAttrs);

      const assertFailsWithUnimplementedError = (error: ServiceError) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.UNIMPLEMENTED);
        methodsVerifiedCount++;
        if (methodsVerifiedCount === methodsToVerify.length) {
          done();
        }
      };

      methodsToVerify.forEach(method => {
        const call = client[method]({}, assertFailsWithUnimplementedError); // for unary
        call.on("error", assertFailsWithUnimplementedError); // for streamed
      });
    });

    it("fails for non-object service definition argument", () => {
      assert.throws(() => {
        server.removeService("upsie" as any);
      }, /removeService.*requires object as argument/);
    });
  });

  describe("unregister", () => {
    let server: Server;
    let client: ServiceClient;

    const mathProtoFile = path.join(__dirname, "fixtures", "math.proto");
    const mathClient = (loadProtoFile(mathProtoFile).math as any).Math;
    const mathServiceAttrs = mathClient.service;

    beforeEach(done => {
      server = new Server();
      server.addService(mathServiceAttrs, {
        div(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
          callback(null, { quotient: "42" });
        },
      });
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        client = new mathClient(`localhost:${port}`, grpc.credentials.createInsecure());
        server.start();
        done();
      });
    });

    afterEach(() => {
      client.close();
      server.forceShutdown();
    });

    it("removes handler by name and returns true", done => {
      const name = mathServiceAttrs["Div"].path;
      assert.strictEqual(server.unregister(name), true, "Server#unregister should return true on success");

      client.div({ divisor: 4, dividend: 3 }, (error: ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.UNIMPLEMENTED);
        done();
      });
    });

    it("returns false for unknown handler", () => {
      assert.strictEqual(server.unregister("noOneHere"), false, "Server#unregister should return false on failure");
    });
  });

  it("throws when unimplemented methods are called", () => {
    const server = new Server();

    assert.throws(() => {
      server.addProtoService();
    }, /Not implemented. Use addService\(\) instead/);

    assert.throws(() => {
      server.addHttp2Port();
    }, /Not yet implemented/);

    assert.throws(() => {
      server.bind("localhost:0", ServerCredentials.createInsecure());
    }, /Not implemented. Use bindAsync\(\) instead/);
  });

  describe("Default handlers", () => {
    let server: Server;
    let client: ServiceClient;

    const mathProtoFile = path.join(__dirname, "fixtures", "math.proto");
    const mathClient = (loadProtoFile(mathProtoFile).math as any).Math;
    const mathServiceAttrs = mathClient.service;

    before(done => {
      server = new Server();
      server.addService(mathServiceAttrs, {});
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        client = new mathClient(`localhost:${port}`, grpc.credentials.createInsecure());
        server.start();
        done();
      });
    });

    after(() => {
      client.close();
      server.forceShutdown();
    });

    it("should respond to a unary call with UNIMPLEMENTED", done => {
      client.div({ divisor: 4, dividend: 3 }, (error: ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.UNIMPLEMENTED);
        assert.match(error.details, /does not implement the method.*Div/);
        done();
      });
    });

    it("should respond to a client stream with UNIMPLEMENTED", done => {
      const call = client.sum((error: ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.UNIMPLEMENTED);
        assert.match(error.details, /does not implement the method.*Sum/);
        done();
      });

      call.end();
    });

    it("should respond to a server stream with UNIMPLEMENTED", done => {
      const call = client.fib({ limit: 5 });

      call.on("data", (value: any) => {
        assert.fail("No messages expected");
      });

      call.on("error", (err: ServiceError) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
        assert.match(err.details, /does not implement the method.*Fib/);
        done();
      });
    });

    it("should respond to a bidi call with UNIMPLEMENTED", done => {
      const call = client.divMany();

      call.on("data", (value: any) => {
        assert.fail("No messages expected");
      });

      call.on("error", (err: ServiceError) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
        assert.match(err.details, /does not implement the method.*DivMany/);
        done();
      });

      call.end();
    });
  });

  describe("Unregistered service", () => {
    let server: Server;
    let client: ServiceClient;

    const mathProtoFile = path.join(__dirname, "fixtures", "math.proto");
    const mathClient = (loadProtoFile(mathProtoFile).math as any).Math;

    before(done => {
      server = new Server();
      // Don't register a service at all
      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        client = new mathClient(`localhost:${port}`, grpc.credentials.createInsecure());
        server.start();
        done();
      });
    });

    after(() => {
      client.close();
      server.forceShutdown();
    });

    it("should respond to a unary call with UNIMPLEMENTED", done => {
      client.div({ divisor: 4, dividend: 3 }, (error: ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.UNIMPLEMENTED);
        assert.match(error.details, /does not implement the method.*Div/);
        done();
      });
    });

    it("should respond to a client stream with UNIMPLEMENTED", done => {
      const call = client.sum((error: ServiceError, response: any) => {
        assert(error);
        assert.strictEqual(error.code, grpc.status.UNIMPLEMENTED);
        assert.match(error.details, /does not implement the method.*Sum/);
        done();
      });

      call.end();
    });

    it("should respond to a server stream with UNIMPLEMENTED", done => {
      const call = client.fib({ limit: 5 });

      call.on("data", (value: any) => {
        assert.fail("No messages expected");
      });

      call.on("error", (err: ServiceError) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
        assert.match(err.details, /does not implement the method.*Fib/);
        done();
      });
    });

    it("should respond to a bidi call with UNIMPLEMENTED", done => {
      const call = client.divMany();

      call.on("data", (value: any) => {
        assert.fail("No messages expected");
      });

      call.on("error", (err: ServiceError) => {
        assert(err);
        assert.strictEqual(err.code, grpc.status.UNIMPLEMENTED);
        assert.match(err.details, /does not implement the method.*DivMany/);
        done();
      });

      call.end();
    });
  });
});

describe("Echo service", () => {
  let server: Server;
  let client: ServiceClient;
  const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
  const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

  const serviceImplementation = {
    echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
      callback(null, call.request);
    },
    echoBidiStream(call: ServerDuplexStream<any, any>) {
      call.on("data", data => {
        call.write(data);
      });
      call.on("end", () => {
        call.end();
      });
    },
  };

  before(done => {
    server = new Server();
    server.addService(echoService.service, serviceImplementation);

    server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
      assert.ifError(err);
      client = new echoService(`localhost:${port}`, grpc.credentials.createInsecure());
      server.start();
      done();
    });
  });

  after(() => {
    client.close();
    server.forceShutdown();
  });

  it("should echo the received message directly", done => {
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert.ifError(error);
      assert.deepStrictEqual(response, { value: "test value", value2: 3 });
      done();
    });
  });

  describe("ServerCredentials watcher", () => {
    let server: Server;
    let serverPort: number;
    const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
    const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

    class ToggleableSecureServerCredentials extends ServerCredentials {
      private contextOptions: SecureContextOptions;
      constructor(key: Buffer, cert: Buffer) {
        super();
        this.contextOptions = { key, cert };
        this.enable();
      }
      enable() {
        this.updateSecureContextOptions(this.contextOptions);
      }
      disable() {
        this.updateSecureContextOptions(null);
      }
      _isSecure(): boolean {
        return true;
      }
      _equals(other: grpc.ServerCredentials): boolean {
        return this === other;
      }
    }

    const serverCredentials = new ToggleableSecureServerCredentials(key, cert);

    const serviceImplementation = {
      echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
        callback(null, call.request);
      },
      echoBidiStream(call: ServerDuplexStream<any, any>) {
        call.on("data", data => {
          call.write(data);
        });
        call.on("end", () => {
          call.end();
        });
      },
    };

    before(done => {
      server = new Server();
      server.addService(echoService.service, serviceImplementation);

      server.bindAsync("localhost:0", serverCredentials, (err, port) => {
        assert.ifError(err);
        serverPort = port;
        done();
      });
    });

    after(() => {
      client.close();
      server.forceShutdown();
    });

    it("should make successful requests only when the credentials are enabled", done => {
      const client1 = new echoService(`localhost:${serverPort}`, grpc.credentials.createSsl(ca), {
        "grpc.ssl_target_name_override": "foo.test.google.fr",
        "grpc.default_authority": "foo.test.google.fr",
        "grpc.use_local_subchannel_pool": 1,
      });
      const testMessage = { value: "test value", value2: 3 };
      client1.echo(testMessage, (error: ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, testMessage);
        serverCredentials.disable();
        const client2 = new echoService(`localhost:${serverPort}`, grpc.credentials.createSsl(ca), {
          "grpc.ssl_target_name_override": "foo.test.google.fr",
          "grpc.default_authority": "foo.test.google.fr",
          "grpc.use_local_subchannel_pool": 1,
        });
        client2.echo(testMessage, (error: ServiceError, response: any) => {
          assert(error);
          assert.strictEqual(error.code, grpc.status.UNAVAILABLE);
          serverCredentials.enable();
          const client3 = new echoService(`localhost:${serverPort}`, grpc.credentials.createSsl(ca), {
            "grpc.ssl_target_name_override": "foo.test.google.fr",
            "grpc.default_authority": "foo.test.google.fr",
            "grpc.use_local_subchannel_pool": 1,
          });
          client3.echo(testMessage, (error: ServiceError, response: any) => {
            assert.ifError(error);
            done();
          });
        });
      });
    });
  });

  /* This test passes on Node 18 but fails on Node 16. The failure appears to
   * be caused by https://github.com/nodejs/node/issues/42713 */
  it.skip("should continue a stream after server shutdown", done => {
    const server2 = new Server();
    server2.addService(echoService.service, serviceImplementation);
    server2.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
      if (err) {
        done(err);
        return;
      }
      const client2 = new echoService(`localhost:${port}`, grpc.credentials.createInsecure());
      server2.start();
      const stream = client2.echoBidiStream();
      const totalMessages = 5;
      let messagesSent = 0;
      stream.write({ value: "test value", value2: messagesSent });
      messagesSent += 1;
      stream.on("data", () => {
        if (messagesSent === 1) {
          server2.tryShutdown(assert2.mustCall(() => {}));
        }
        if (messagesSent >= totalMessages) {
          stream.end();
        } else {
          stream.write({ value: "test value", value2: messagesSent });
          messagesSent += 1;
        }
      });
      stream.on(
        "status",
        assert2.mustCall((status: grpc.StatusObject) => {
          assert.strictEqual(status.code, grpc.status.OK);
          assert.strictEqual(messagesSent, totalMessages);
        }),
      );
      stream.on("error", () => {});
      assert2.afterMustCallsSatisfied(done);
    });
  });
});

// We dont allow connection injections yet on node:http nor node:http2
describe.todo("Connection injector", () => {
  let tcpServer: net.Server;
  let server: Server;
  let client: ServiceClient;
  const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
  const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

  const serviceImplementation = {
    echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
      callback(null, call.request);
    },
    echoBidiStream(call: ServerDuplexStream<any, any>) {
      call.on("data", data => {
        call.write(data);
      });
      call.on("end", () => {
        call.end();
      });
    },
  };

  before(done => {
    server = new Server();
    const creds = ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }], false);
    const connectionInjector = server.createConnectionInjector(creds);
    tcpServer = net.createServer(socket => {
      connectionInjector.injectConnection(socket);
    });
    server.addService(echoService.service, serviceImplementation);
    tcpServer.listen(0, "localhost", () => {
      const port = (tcpServer.address() as net.AddressInfo).port;
      client = new echoService(`localhost:${port}`, grpc.credentials.createSsl(ca), {
        "grpc.ssl_target_name_override": "foo.test.google.fr",
        "grpc.default_authority": "foo.test.google.fr",
      });
      done();
    });
  });

  after(() => {
    client.close();
    tcpServer.close();
    server.forceShutdown();
  });

  it("should respond to a request", done => {
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert.ifError(error);
      assert.deepStrictEqual(response, { value: "test value", value2: 3 });
      done();
    });
  });
});

describe("Generic client and server", () => {
  function toString(val: any) {
    return val.toString();
  }

  function toBuffer(str: string) {
    return Buffer.from(str);
  }

  function capitalize(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  const stringServiceAttrs = {
    capitalize: {
      path: "/string/capitalize",
      requestStream: false,
      responseStream: false,
      requestSerialize: toBuffer,
      requestDeserialize: toString,
      responseSerialize: toBuffer,
      responseDeserialize: toString,
    },
  };

  describe("String client and server", () => {
    let client: ServiceClient;
    let server: Server;

    before(done => {
      server = new Server();

      server.addService(stringServiceAttrs as any, {
        capitalize(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
          callback(null, capitalize(call.request));
        },
      });

      server.bindAsync("localhost:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        server.start();
        const clientConstr = grpc.makeGenericClientConstructor(
          stringServiceAttrs as any,
          "unused_but_lets_appease_typescript_anyway",
        );
        client = new clientConstr(`localhost:${port}`, grpc.credentials.createInsecure());
        done();
      });
    });

    after(() => {
      client.close();
      server.forceShutdown();
    });

    it("Should respond with a capitalized string", done => {
      client.capitalize("abc", (err: ServiceError, response: string) => {
        assert.ifError(err);
        assert.strictEqual(response, "Abc");
        done();
      });
    });
  });

  it("responds with HTTP status of 415 on invalid content-type", done => {
    const server = new Server();
    const creds = ServerCredentials.createInsecure();

    server.bindAsync("localhost:0", creds, (err, port) => {
      assert.ifError(err);
      const client = http2.connect(`http://localhost:${port}`);
      let count = 0;

      function makeRequest(headers: http2.IncomingHttpHeaders) {
        const req = client.request(headers);
        let statusCode: string;

        req.on("response", headers => {
          statusCode = headers[http2.constants.HTTP2_HEADER_STATUS] as string;
          assert.strictEqual(statusCode, http2.constants.HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE);
        });

        req.on("end", () => {
          assert(statusCode);
          count++;
          if (count === 2) {
            client.close();
            server.forceShutdown();
            done();
          }
        });

        req.end();
      }

      server.start();

      // Missing Content-Type header.
      makeRequest({ ":path": "/" });
      // Invalid Content-Type header.
      makeRequest({ ":path": "/", "content-type": "application/not-grpc" });
    });
  });
});

describe("Compressed requests", () => {
  const testServiceHandlers: TestServiceHandlers = {
    Unary(call, callback) {
      callback(null, { count: 500000, message: call.request.message });
    },

    ClientStream(call, callback) {
      let timesCalled = 0;

      call.on("data", () => {
        timesCalled += 1;
      });

      call.on("end", () => {
        callback(null, { count: timesCalled });
      });
    },

    ServerStream(call) {
      const { request } = call;

      for (let i = 0; i < 5; i++) {
        call.write({ count: request.message.length });
      }

      call.end();
    },

    BidiStream(call) {
      call.on("data", (data: Request__Output) => {
        call.write({ count: data.message.length });
      });

      call.on("end", () => {
        call.end();
      });
    },
  };

  describe("Test service client and server with deflate", () => {
    let client: TestServiceClient;
    let server: Server;
    let assignedPort: number;

    before(done => {
      server = new Server();
      server.addService(testServiceGrpcObject.TestService.service, testServiceHandlers);
      server.bindAsync("127.0.0.1:0", ServerCredentials.createInsecure(), (err, port) => {
        assert.ifError(err);
        server.start();
        assignedPort = port;
        client = new testServiceGrpcObject.TestService(`127.0.0.1:${assignedPort}`, grpc.credentials.createInsecure(), {
          "grpc.default_compression_algorithm": CompressionAlgorithms.deflate,
        });
        done();
      });
    });

    after(() => {
      client.close();
      server.forceShutdown();
    });

    it("Should compress and decompress when performing unary call", done => {
      client.unary({ message: "foo" }, (err, response) => {
        assert.ifError(err);
        done();
      });
    });

    it("Should compress and decompress when performing client stream", done => {
      const clientStream = client.clientStream((err, res) => {
        assert.ifError(err);
        assert.equal(res?.count, 3);
        done();
      });

      clientStream.write({ message: "foo" }, () => {
        clientStream.write({ message: "bar" }, () => {
          clientStream.write({ message: "baz" }, () => {
            setTimeout(() => clientStream.end(), 10);
          });
        });
      });
    });

    it("Should compress and decompress when performing server stream", done => {
      const serverStream = client.serverStream({ message: "foobar" });
      let timesResponded = 0;

      serverStream.on("data", () => {
        timesResponded += 1;
      });

      serverStream.on("error", err => {
        assert.ifError(err);
        done();
      });

      serverStream.on("end", () => {
        assert.equal(timesResponded, 5);
        done();
      });
    });

    it("Should compress and decompress when performing bidi stream", done => {
      const bidiStream = client.bidiStream();
      let timesRequested = 0;
      let timesResponded = 0;

      bidiStream.on("data", () => {
        timesResponded += 1;
      });

      bidiStream.on("error", err => {
        assert.ifError(err);
        done();
      });

      bidiStream.on("end", () => {
        assert.equal(timesResponded, timesRequested);
        done();
      });

      bidiStream.write({ message: "foo" }, () => {
        timesRequested += 1;
        bidiStream.write({ message: "bar" }, () => {
          timesRequested += 1;
          bidiStream.write({ message: "baz" }, () => {
            timesRequested += 1;
            setTimeout(() => bidiStream.end(), 10);
          });
        });
      });
    });

    it("Should compress and decompress with gzip", done => {
      client = new testServiceGrpcObject.TestService(`localhost:${assignedPort}`, grpc.credentials.createInsecure(), {
        "grpc.default_compression_algorithm": CompressionAlgorithms.gzip,
      });

      client.unary({ message: "foo" }, (err, response) => {
        assert.ifError(err);
        done();
      });
    });

    it("Should compress and decompress when performing client stream", done => {
      const clientStream = client.clientStream((err, res) => {
        assert.ifError(err);
        assert.equal(res?.count, 3);
        done();
      });

      clientStream.write({ message: "foo" }, () => {
        clientStream.write({ message: "bar" }, () => {
          clientStream.write({ message: "baz" }, () => {
            setTimeout(() => clientStream.end(), 10);
          });
        });
      });
    });

    it("Should compress and decompress when performing server stream", done => {
      const serverStream = client.serverStream({ message: "foobar" });
      let timesResponded = 0;

      serverStream.on("data", () => {
        timesResponded += 1;
      });

      serverStream.on("error", err => {
        assert.ifError(err);
        done();
      });

      serverStream.on("end", () => {
        assert.equal(timesResponded, 5);
        done();
      });
    });

    it("Should compress and decompress when performing bidi stream", done => {
      const bidiStream = client.bidiStream();
      let timesRequested = 0;
      let timesResponded = 0;

      bidiStream.on("data", () => {
        timesResponded += 1;
      });

      bidiStream.on("error", err => {
        assert.ifError(err);
        done();
      });

      bidiStream.on("end", () => {
        assert.equal(timesResponded, timesRequested);
        done();
      });

      bidiStream.write({ message: "foo" }, () => {
        timesRequested += 1;
        bidiStream.write({ message: "bar" }, () => {
          timesRequested += 1;
          bidiStream.write({ message: "baz" }, () => {
            timesRequested += 1;
            setTimeout(() => bidiStream.end(), 10);
          });
        });
      });
    });

    it("Should handle large messages", done => {
      let longMessage = Buffer.alloc(4000000, "a").toString("utf8");
      client.unary({ message: longMessage }, (err, response) => {
        assert.ifError(err);
        assert.strictEqual(response?.message, longMessage);
        done();
      });
    }, 30000);

    /* As of Node 16, Writable and Duplex streams validate the encoding
     * argument to write, and the flags values we are passing there are not
     * valid. We don't currently have an alternative way to pass that flag
     * down, so for now this feature is not supported. */
    it.skip("Should not compress requests when the NoCompress write flag is used", done => {
      const bidiStream = client.bidiStream();
      let timesRequested = 0;
      let timesResponded = 0;

      bidiStream.on("data", () => {
        timesResponded += 1;
      });

      bidiStream.on("error", err => {
        assert.ifError(err);
        done();
      });

      bidiStream.on("end", () => {
        assert.equal(timesResponded, timesRequested);
        done();
      });

      bidiStream.write({ message: "foo" }, "2", (err: any) => {
        assert.ifError(err);
        timesRequested += 1;
        setTimeout(() => bidiStream.end(), 10);
      });
    });
  });
});
