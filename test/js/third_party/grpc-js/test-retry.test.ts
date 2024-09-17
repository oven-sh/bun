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

import * as grpc from "@grpc/grpc-js";
import assert from "assert";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "bun:test";
import { TestClient, TestServer } from "./common";

["h2", "h2c"].forEach(protocol => {
  describe(`Retries ${protocol}`, () => {
    let server: TestServer;
    beforeAll(done => {
      server = new TestServer(protocol === "h2", undefined, 1);
      server.start().then(done).catch(done);
    });

    afterAll(done => {
      server.shutdown();
      done();
    });

    describe("Client with retries disabled", () => {
      let client: InstanceType<grpc.ServiceClientConstructor>;
      beforeEach(() => {
        client = TestClient.createFromServer(server, { "grpc.enable_retries": 0 });
      });

      afterEach(() => {
        client.close();
      });

      it("Should be able to make a basic request", done => {
        client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
          assert.ifError(error);
          assert.deepStrictEqual(response, { value: "test value", value2: 3 });
          done();
        });
      });

      it("Should fail if the server fails the first request", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "1");
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert(error);
          assert.strictEqual(error.details, "Failed on retry 0");
          done();
        });
      });
    });

    describe("Client with retries enabled but not configured", () => {
      let client: InstanceType<grpc.ServiceClientConstructor>;
      beforeEach(() => {
        client = TestClient.createFromServer(server);
      });

      afterEach(() => {
        client.close();
      });

      it("Should be able to make a basic request", done => {
        client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
          assert.ifError(error);
          assert.deepStrictEqual(response, { value: "test value", value2: 3 });
          done();
        });
      });

      it("Should fail if the server fails the first request", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "1");
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert(error);
          assert(
            error.details === "Failed on retry 0" || error.details.indexOf("RST_STREAM with code 0") !== -1,
            error.details,
          );
          done();
        });
      });
    });

    describe("Client with retries configured", () => {
      let client: InstanceType<grpc.ServiceClientConstructor>;
      beforeEach(() => {
        const serviceConfig = {
          loadBalancingConfig: [],
          methodConfig: [
            {
              name: [
                {
                  service: "EchoService",
                },
              ],
              retryPolicy: {
                maxAttempts: 3,
                initialBackoff: "0.1s",
                maxBackoff: "10s",
                backoffMultiplier: 1.2,
                retryableStatusCodes: [14, "RESOURCE_EXHAUSTED"],
              },
            },
          ],
        };
        client = TestClient.createFromServer(server, {
          "grpc.service_config": JSON.stringify(serviceConfig),
        });
      });

      afterEach(() => {
        client.close();
      });

      it("Should be able to make a basic request", done => {
        client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
          assert.ifError(error);
          assert.deepStrictEqual(response, { value: "test value", value2: 3 });
          done();
        });
      });

      it("Should succeed with few required attempts", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "2");
        metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert.ifError(error);
          assert.deepStrictEqual(response, { value: "test value", value2: 3 });
          done();
        });
      });

      it("Should fail with many required attempts", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "4");
        metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert(error);
          //RST_STREAM is a graceful close
          assert(
            error.details === "Failed on retry 2" || error.details.indexOf("RST_STREAM with code 0") !== -1,
            error.details,
          );
          done();
        });
      });

      it("Should fail with a fatal status code", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "2");
        metadata.set("respond-with-status", `${grpc.status.NOT_FOUND}`);
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert(error);
          //RST_STREAM is a graceful close
          assert(
            error.details === "Failed on retry 0" || error.details.indexOf("RST_STREAM with code 0") !== -1,
            error.details,
          );
          done();
        });
      });

      it("Should not be able to make more than 5 attempts", done => {
        const serviceConfig = {
          loadBalancingConfig: [],
          methodConfig: [
            {
              name: [
                {
                  service: "EchoService",
                },
              ],
              retryPolicy: {
                maxAttempts: 10,
                initialBackoff: "0.1s",
                maxBackoff: "10s",
                backoffMultiplier: 1.2,
                retryableStatusCodes: [14, "RESOURCE_EXHAUSTED"],
              },
            },
          ],
        };
        const client2 = TestClient.createFromServer(server, {
          "grpc.service_config": JSON.stringify(serviceConfig),
        });
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "6");
        metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
        client2.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          client2.close();
          assert(error);
          assert(
            error.details === "Failed on retry 4" || error.details.indexOf("RST_STREAM with code 0") !== -1,
            error.details,
          );
          done();
        });
      });
    });

    describe("Client with hedging configured", () => {
      let client: InstanceType<grpc.ServiceClientConstructor>;
      beforeAll(() => {
        const serviceConfig = {
          loadBalancingConfig: [],
          methodConfig: [
            {
              name: [
                {
                  service: "EchoService",
                },
              ],
              hedgingPolicy: {
                maxAttempts: 3,
                nonFatalStatusCodes: [14, "RESOURCE_EXHAUSTED"],
              },
            },
          ],
        };
        client = TestClient.createFromServer(server, {
          "grpc.service_config": JSON.stringify(serviceConfig),
        });
      });

      afterAll(() => {
        client.close();
      });

      it("Should be able to make a basic request", done => {
        client.echo({ value: "test value", value2: 3 }, (error: grpc.ServiceError, response: any) => {
          assert.ifError(error);
          assert.deepStrictEqual(response, { value: "test value", value2: 3 });
          done();
        });
      });

      it("Should succeed with few required attempts", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "2");
        metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert.ifError(error);
          assert.deepStrictEqual(response, { value: "test value", value2: 3 });
          done();
        });
      });

      it("Should fail with many required attempts", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "4");
        metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert(error);
          assert(error.details.startsWith("Failed on retry"));
          done();
        });
      });

      it("Should fail with a fatal status code", done => {
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "2");
        metadata.set("respond-with-status", `${grpc.status.NOT_FOUND}`);
        client.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          assert(error);
          assert(error.details.startsWith("Failed on retry"));
          done();
        });
      });

      it("Should not be able to make more than 5 attempts", done => {
        const serviceConfig = {
          loadBalancingConfig: [],
          methodConfig: [
            {
              name: [
                {
                  service: "EchoService",
                },
              ],
              hedgingPolicy: {
                maxAttempts: 10,
                nonFatalStatusCodes: [14, "RESOURCE_EXHAUSTED"],
              },
            },
          ],
        };
        const client2 = TestClient.createFromServer(server, {
          "grpc.service_config": JSON.stringify(serviceConfig),
        });
        const metadata = new grpc.Metadata();
        metadata.set("succeed-on-retry-attempt", "6");
        metadata.set("respond-with-status", `${grpc.status.RESOURCE_EXHAUSTED}`);
        client2.echo({ value: "test value", value2: 3 }, metadata, (error: grpc.ServiceError, response: any) => {
          client2.close();
          assert(error);
          assert(error.details.startsWith("Failed on retry"));
          done();
        });
      });
    });
  });
});
