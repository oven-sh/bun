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

import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

import grpc, { sendUnaryData, ServerUnaryCall, ServiceError } from "@grpc/grpc-js";
import { CallCredentials } from "@grpc/grpc-js/build/src/call-credentials";
import { FileWatcherCertificateProvider } from "@grpc/grpc-js/build/src/certificate-provider";
import {
  ChannelCredentials,
  createCertificateProviderChannelCredentials,
} from "@grpc/grpc-js/build/src/channel-credentials";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";
import { createCertificateProviderServerCredentials } from "@grpc/grpc-js/build/src/server-credentials";
import { afterAll as after, afterEach, beforeAll as before, beforeEach, describe, it } from "bun:test";
import assert from "node:assert";

import { assert2, loadProtoFile, mockFunction } from "./common";

const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
const echoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;

class CallCredentialsMock implements CallCredentials {
  child: CallCredentialsMock | null = null;
  constructor(child?: CallCredentialsMock) {
    if (child) {
      this.child = child;
    }
  }

  generateMetadata = mockFunction;

  compose(callCredentials: CallCredentialsMock): CallCredentialsMock {
    return new CallCredentialsMock(callCredentials);
  }

  _equals(other: CallCredentialsMock): boolean {
    if (!this.child) {
      return this === other;
    } else if (!other || !other.child) {
      return false;
    } else {
      return this.child._equals(other.child);
    }
  }
}

// tslint:disable-next-line:no-any
const readFile: (...args: any[]) => Promise<Buffer> = promisify(fs.readFile);
// A promise which resolves to loaded files in the form { ca, key, cert }
const pFixtures = Promise.all(
  ["ca.pem", "server1.key", "server1.pem"].map(file => readFile(`${__dirname}/fixtures/${file}`)),
).then(result => {
  return { ca: result[0], key: result[1], cert: result[2] };
});

describe("ChannelCredentials Implementation", () => {
  // grpc-js 1.14 has no _getConnectionOptions() and no _getCallCredentials(), and its own suite dropped the six cases
  // that read them. They stay here through _isSecure(), _createSecureConnector() and _equals(): createSsl() gives each
  // argument shape to tls.createSecureContext().
  describe("createSsl", () => {
    function assertConnectionOptions(creds: ChannelCredentials) {
      assert.ok(creds._isSecure());
      creds._createSecureConnector({ scheme: "dns", path: "localhost" }, {}).destroy();
    }

    it("should work when given no arguments", () => {
      assertConnectionOptions(assert2.noThrowAndReturn(() => ChannelCredentials.createSsl()));
    });

    it("should work with just a CA override", async () => {
      const { ca } = await pFixtures;
      assertConnectionOptions(assert2.noThrowAndReturn(() => ChannelCredentials.createSsl(ca)));
    });

    it("should work with just a private key and cert chain", async () => {
      const { key, cert } = await pFixtures;
      assertConnectionOptions(assert2.noThrowAndReturn(() => ChannelCredentials.createSsl(null, key, cert)));
    });

    it("should work with three parameters specified", async () => {
      const { ca, key, cert } = await pFixtures;
      assertConnectionOptions(assert2.noThrowAndReturn(() => ChannelCredentials.createSsl(ca, key, cert)));
    });

    it("should throw if just one of private key and cert chain are missing", async () => {
      const { ca, key, cert } = await pFixtures;
      assert.throws(() => ChannelCredentials.createSsl(ca, key));
      assert.throws(() => ChannelCredentials.createSsl(ca, key, null));
      assert.throws(() => ChannelCredentials.createSsl(ca, null, cert));
      assert.throws(() => ChannelCredentials.createSsl(null, key));
      assert.throws(() => ChannelCredentials.createSsl(null, key, null));
      assert.throws(() => ChannelCredentials.createSsl(null, null, cert));
    });
  });

  describe("compose", () => {
    it("should return a ChannelCredentials object", () => {
      const channelCreds = ChannelCredentials.createSsl();
      const callCreds = new CallCredentialsMock();
      const composedChannelCreds = channelCreds.compose(callCreds);
      assert.ok(composedChannelCreds instanceof ChannelCredentials);
    });

    it("should preserve unwrapped CallCredentials when creating a connector", () => {
      const channelCreds = ChannelCredentials.createSsl();
      const callCreds = CallCredentials.createFromMetadataGenerator((options, cb) => cb(null, new grpc.Metadata()));
      const composedChannelCreds = channelCreds.compose(callCreds);
      const connector = composedChannelCreds._createSecureConnector({ scheme: "dns", path: "localhost" }, {});
      assert.strictEqual(connector.getCallCredentials(), callCreds);
      connector.destroy();
    });

    it("should be chainable", () => {
      const channelCreds = ChannelCredentials.createSsl();
      const callCreds1 = new CallCredentialsMock();
      const callCreds2 = new CallCredentialsMock();
      // Associate both call credentials with channelCreds
      const composedChannelCreds = channelCreds.compose(callCreds1).compose(callCreds2);
      // Build credentials that should be an identical copy
      const composedCallCreds = callCreds1.compose(callCreds2);
      assert.ok(composedChannelCreds._equals(channelCreds.compose(composedCallCreds)));
      assert.ok(!composedChannelCreds._equals(channelCreds.compose(callCreds1)));
    });
  });

  describe("createInsecure", () => {
    it("should return a ChannelCredentials object with no associated secure context", () => {
      const creds = assert2.noThrowAndReturn(() => ChannelCredentials.createInsecure());
      assert.ok(!creds._isSecure());
    });

    it("should return the same default CallCredentials instance from a connector", () => {
      const insecureCreds = ChannelCredentials.createInsecure();
      const connector = insecureCreds._createSecureConnector({ scheme: "dns", path: "localhost" }, {});
      assert.strictEqual(connector.getCallCredentials(), connector.getCallCredentials());
      connector.destroy();
    });
  });
});

describe("ChannelCredentials usage", () => {
  let client: ServiceClient;
  let server: grpc.Server;
  let portNum: number;
  let caCert: Buffer;
  const hostnameOverride = "foo.test.google.fr";
  beforeEach(async () => {
    const { ca, key, cert } = await pFixtures;
    caCert = ca;
    const serverCreds = grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }]);
    const channelCreds = ChannelCredentials.createSsl(ca);
    const callCreds = CallCredentials.createFromMetadataGenerator((options, cb) => {
      const metadata = new grpc.Metadata();
      metadata.set("test-key", "test-value");

      cb(null, metadata);
    });
    const combinedCreds = channelCreds.compose(callCreds);
    return new Promise<void>((resolve, reject) => {
      server = new grpc.Server();
      server.addService(echoService.service, {
        echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
          call.sendMetadata(call.metadata);

          callback(null, call.request);
        },
      });

      server.bindAsync("127.0.0.1:0", serverCreds, (err, port) => {
        if (err) {
          reject(err);
          return;
        }
        portNum = port;
        client = new echoService(`127.0.0.1:${port}`, combinedCreds, {
          "grpc.ssl_target_name_override": hostnameOverride,
          "grpc.default_authority": hostnameOverride,
        });
        server.start();
        resolve();
      });
    });
  });
  afterEach(() => {
    server.forceShutdown();
  });

  it("Should send the metadata from call credentials attached to channel credentials", done => {
    const call = client.echo(
      { value: "test value", value2: 3 },
      assert2.mustCall((error: ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
      }),
    );
    call.on(
      "metadata",
      assert2.mustCall((metadata: grpc.Metadata) => {
        assert.deepStrictEqual(metadata.get("test-key"), ["test-value"]);
      }),
    );
    assert2.afterMustCallsSatisfied(done);
  });

  it.todo("Should call the checkServerIdentity callback", done => {
    const channelCreds = ChannelCredentials.createSsl(caCert, null, null, {
      checkServerIdentity: assert2.mustCall((hostname, cert) => {
        assert.strictEqual(hostname, hostnameOverride);
        return undefined;
      }),
    });
    const client = new echoService(`localhost:${portNum}`, channelCreds, {
      "grpc.ssl_target_name_override": hostnameOverride,
      "grpc.default_authority": hostnameOverride,
    });
    client.echo(
      { value: "test value", value2: 3 },
      assert2.mustCall((error: ServiceError, response: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(response, { value: "test value", value2: 3 });
      }),
    );
    assert2.afterMustCallsSatisfied(done);
  });
  it("Should handle certificate providers", done => {
    const certificateProvider = new FileWatcherCertificateProvider({
      caCertificateFile: `${__dirname}/fixtures/ca.pem`,
      certificateFile: `${__dirname}/fixtures/server1.pem`,
      privateKeyFile: `${__dirname}/fixtures/server1.key`,
      refreshIntervalMs: 1000,
    });
    const channelCreds = createCertificateProviderChannelCredentials(certificateProvider, null);
    const client = new echoService(`localhost:${portNum}`, channelCreds, {
      "grpc.ssl_target_name_override": hostnameOverride,
      "grpc.default_authority": hostnameOverride,
    });
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      client.close();
      assert.ifError(error);
      assert.deepStrictEqual(response, { value: "test value", value2: 3 });
      done();
    });
  });
  it("Should never connect when using insecure creds with a secure server", done => {
    const client = new echoService(`localhost:${portNum}`, grpc.credentials.createInsecure());
    const deadline = new Date();
    deadline.setSeconds(deadline.getSeconds() + 1);
    client.echo(
      { value: "test value", value2: 3 },
      new grpc.Metadata({ waitForReady: true }),
      { deadline },
      (error: ServiceError, response: any) => {
        client.close();
        assert(error);
        assert.strictEqual(error.code, grpc.status.DEADLINE_EXCEEDED);
        done();
      },
    );
  });
  it("Should provide certificates in getAuthContext", done => {
    const call = client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert.ifError(error);
      const authContext = call.getAuthContext();
      assert(authContext);
      assert.strictEqual(authContext.transportSecurityType, "ssl");
      assert(authContext.sslPeerCertificate);
      done();
    });
  });
  it("Should accept self-signed certs with acceptUnauthorized", done => {
    const client = new echoService(
      `localhost:${portNum}`,
      grpc.credentials.createSsl(null, null, null, { rejectUnauthorized: false }),
    );
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError | null, response: any) => {
      client.close();
      assert.ifError(error);
      assert.deepStrictEqual(response, { value: "test value", value2: 3 });
      done();
    });
  });
});

describe("Channel credentials mtls", () => {
  let client: ServiceClient;
  let server: grpc.Server;
  let portNum: number;
  let caCert: Buffer;
  let keyValue: Buffer;
  let certValue: Buffer;
  const hostnameOverride = "foo.test.google.fr";
  before(async () => {
    const { ca, key, cert } = await pFixtures;
    caCert = ca;
    keyValue = key;
    certValue = cert;
    const serverCreds = grpc.ServerCredentials.createSsl(ca, [{ private_key: key, cert_chain: cert }], true);
    return new Promise<void>((resolve, reject) => {
      server = new grpc.Server();
      server.addService(echoService.service, {
        echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
          call.sendMetadata(call.metadata);
          callback(null, call.request);
        },
      });

      server.bindAsync("localhost:0", serverCreds, (err, port) => {
        if (err) {
          reject(err);
          return;
        }
        portNum = port;
        resolve();
      });
    });
  });
  afterEach(() => {
    client.close();
  });
  after(() => {
    server.forceShutdown();
  });

  it("Should work with client provided certificates", done => {
    const channelCreds = ChannelCredentials.createSsl(caCert, keyValue, certValue);
    client = new echoService(`localhost:${portNum}`, channelCreds, {
      "grpc.ssl_target_name_override": hostnameOverride,
      "grpc.default_authority": hostnameOverride,
    });
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert.ifError(error);
      done();
    });
  });
  it("Should fail if the client does not provide certificates", done => {
    const channelCreds = ChannelCredentials.createSsl(caCert);
    client = new echoService(`localhost:${portNum}`, channelCreds, {
      "grpc.ssl_target_name_override": hostnameOverride,
      "grpc.default_authority": hostnameOverride,
    });
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.UNAVAILABLE);
      done();
    });
  });
});

describe("Channel credentials certificate provider mtls", () => {
  const certificateProvider = new FileWatcherCertificateProvider({
    caCertificateFile: `${__dirname}/fixtures/ca.pem`,
    certificateFile: `${__dirname}/fixtures/server1.pem`,
    privateKeyFile: `${__dirname}/fixtures/server1.key`,
    refreshIntervalMs: 1000,
  });
  const hostnameOverride = "foo.test.google.fr";
  let client: ServiceClient;
  let server: grpc.Server;
  let portNum: number;
  before(done => {
    const serverCreds = createCertificateProviderServerCredentials(certificateProvider, certificateProvider, true);
    server = new grpc.Server();
    server.addService(echoService.service, {
      echo(call: ServerUnaryCall<any, any>, callback: sendUnaryData<any>) {
        call.sendMetadata(call.metadata);
        callback(null, call.request);
      },
    });

    server.bindAsync("localhost:0", serverCreds, (err, port) => {
      if (err) {
        done(err);
        return;
      }
      portNum = port;
      done();
    });
  });
  afterEach(() => {
    client.close();
  });
  after(() => {
    server.forceShutdown();
  });

  it("Should work with client provided certificates", done => {
    const channelCreds = createCertificateProviderChannelCredentials(certificateProvider, certificateProvider);
    client = new echoService(`localhost:${portNum}`, channelCreds, {
      "grpc.ssl_target_name_override": hostnameOverride,
      "grpc.default_authority": hostnameOverride,
    });
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert.ifError(error);
      done();
    });
  });
  it("Should fail if the client does not provide certificates", done => {
    const channelCreds = createCertificateProviderChannelCredentials(certificateProvider, null);
    client = new echoService(`localhost:${portNum}`, channelCreds, {
      "grpc.ssl_target_name_override": hostnameOverride,
      "grpc.default_authority": hostnameOverride,
    });
    client.echo({ value: "test value", value2: 3 }, (error: ServiceError, response: any) => {
      assert(error);
      assert.strictEqual(error.code, grpc.status.UNAVAILABLE);
      done();
    });
  });
});
