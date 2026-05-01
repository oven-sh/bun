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

import * as grpc from "@grpc/grpc-js/build/src";
import { StatusBuilder } from "@grpc/grpc-js/build/src/status-builder";
import { describe, it } from "bun:test";

describe("StatusBuilder", () => {
  it("is exported by the module", () => {
    assert.strictEqual(StatusBuilder, grpc.StatusBuilder);
  });

  it("builds a status object", () => {
    const builder = new StatusBuilder();
    const metadata = new grpc.Metadata();
    let result;

    assert.deepStrictEqual(builder.build(), {});
    result = builder.withCode(grpc.status.OK);
    assert.strictEqual(result, builder);
    assert.deepStrictEqual(builder.build(), { code: grpc.status.OK });
    result = builder.withDetails("foobar");
    assert.strictEqual(result, builder);
    assert.deepStrictEqual(builder.build(), {
      code: grpc.status.OK,
      details: "foobar",
    });
    result = builder.withMetadata(metadata);
    assert.strictEqual(result, builder);
    assert.deepStrictEqual(builder.build(), {
      code: grpc.status.OK,
      details: "foobar",
      metadata,
    });
  });
});
