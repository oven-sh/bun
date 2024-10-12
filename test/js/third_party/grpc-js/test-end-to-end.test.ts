/*
 * Copyright 2024 gRPC authors.
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
import { loadProtoFile } from "./common";
import assert from "node:assert";
import grpc, {
  Metadata,
  Server,
  ServerDuplexStream,
  ServerUnaryCall,
  ServiceError,
  experimental,
  sendUnaryData,
} from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, it, afterEach } from "bun:test";
import { ServiceClient, ServiceClientConstructor } from "@grpc/grpc-js/build/src/make-client";

const protoFile = path.join(__dirname, "fixtures", "echo_service.proto");
const EchoService = loadProtoFile(protoFile).EchoService as ServiceClientConstructor;
const echoServiceImplementation = {
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

// is something with the file watcher?
describe("Client should successfully communicate with server", () => {
  let server: Server | null = null;
  let client: ServiceClient | null = null;
  afterEach(() => {
    client?.close();
    client = null;
    server?.forceShutdown();
    server = null;
  });
  it.skip("With file watcher credentials", done => {
    const [caPath, keyPath, certPath] = ["ca.pem", "server1.key", "server1.pem"].map(file =>
      path.join(__dirname, "fixtures", file),
    );
    const fileWatcherConfig: experimental.FileWatcherCertificateProviderConfig = {
      caCertificateFile: caPath,
      certificateFile: certPath,
      privateKeyFile: keyPath,
      refreshIntervalMs: 1000,
    };
    const certificateProvider: experimental.CertificateProvider = new experimental.FileWatcherCertificateProvider(
      fileWatcherConfig,
    );
    const serverCreds = experimental.createCertificateProviderServerCredentials(
      certificateProvider,
      certificateProvider,
      true,
    );
    const clientCreds = experimental.createCertificateProviderChannelCredentials(
      certificateProvider,
      certificateProvider,
    );
    server = new Server();
    server.addService(EchoService.service, echoServiceImplementation);
    server.bindAsync("localhost:0", serverCreds, (error, port) => {
      assert.ifError(error);
      client = new EchoService(`localhost:${port}`, clientCreds, {
        "grpc.ssl_target_name_override": "foo.test.google.fr",
        "grpc.default_authority": "foo.test.google.fr",
      });
      const metadata = new Metadata({ waitForReady: true });
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 3);
      const testMessage = { value: "test value", value2: 3 };
      client.echo(testMessage, metadata, { deadline }, (error: ServiceError, value: any) => {
        assert.ifError(error);
        assert.deepStrictEqual(value, testMessage);
        done();
      });
    });
  }, 5000);
});
