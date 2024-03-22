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

import * as grpc from "@grpc/grpc-js";
import * as assert2 from "./assert2";
import { TestClient, TestServer, ca } from "./common";
import { ServiceError, Client } from "@grpc/grpc-js";
import { describe, it, afterAll, beforeAll } from "bun:test";
import assert from "assert";
describe("ChannelCredentials usage", () => {
  let client: Client;
  let server: TestServer;
  beforeAll(async () => {
    const channelCreds = grpc.ChannelCredentials.createSsl(ca);
    const callCreds = grpc.CallCredentials.createFromMetadataGenerator((options: any, cb: Function) => {
      const metadata = new grpc.Metadata();
      metadata.set("test-key", "test-value");
      cb(null, metadata);
    });
    const combinedCreds = channelCreds.compose(callCreds);
    server = new TestServer(true);
    await server.start();
    //@ts-ignore
    client = TestClient.createFromServerWithCredentials(server, combinedCreds, {
      "grpc.ssl_target_name_override": "foo.test.google.fr",
      "grpc.default_authority": "foo.test.google.fr",
    });
  });
  afterAll(() => {
    server.shutdown();
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
});
