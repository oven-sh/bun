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

import * as duration from "@grpc/grpc-js/build/src/duration";
import { describe, it } from "bun:test";
import assert from "node:assert";

describe("Duration", () => {
  describe("parseDuration", () => {
    const expectationList: {
      input: string;
      result: duration.Duration | null;
    }[] = [
      {
        input: "1.0s",
        result: { seconds: 1, nanos: 0 },
      },
      {
        input: "1.5s",
        result: { seconds: 1, nanos: 500_000_000 },
      },
      {
        input: "1s",
        result: { seconds: 1, nanos: 0 },
      },
      {
        input: "1",
        result: null,
      },
    ];
    for (const { input, result } of expectationList) {
      it(`${input} -> ${JSON.stringify(result)}`, () => {
        assert.deepStrictEqual(duration.parseDuration(input), result);
      });
    }
  });
});
