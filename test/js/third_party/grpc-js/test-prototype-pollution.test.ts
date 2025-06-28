/*
 * Copyright 2020 gRPC authors.
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

import { loadPackageDefinition } from "@grpc/grpc-js";
import * as assert from "assert";
import { describe, it } from "bun:test";

describe("loadPackageDefinition", () => {
  it("Should not allow prototype pollution", () => {
    loadPackageDefinition({ "__proto__.polluted": true } as any);
    assert.notStrictEqual(({} as any).polluted, true);
  });
  it("Should not allow prototype pollution #2", () => {
    loadPackageDefinition({ "constructor.prototype.polluted": true } as any);
    assert.notStrictEqual(({} as any).polluted, true);
  });
});
