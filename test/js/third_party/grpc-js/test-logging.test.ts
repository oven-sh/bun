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

import * as logging from "@grpc/grpc-js/build/src/logging";

import assert from "node:assert";
import grpc from "@grpc/grpc-js";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

describe("Logging", () => {
  afterEach(() => {
    // Ensure that the logger is restored to its defaults after each test.
    grpc.setLogger(console);
    grpc.setLogVerbosity(grpc.logVerbosity.DEBUG);
  });

  it("sets the logger to a new value", () => {
    const logger: Partial<Console> = {};

    logging.setLogger(logger);
    assert.strictEqual(logging.getLogger(), logger);
  });

  it("gates logging based on severity", () => {
    const output: Array<string | string[]> = [];
    const logger: Partial<Console> = {
      error(...args: string[]): void {
        output.push(args);
      },
    };

    logging.setLogger(logger);

    // The default verbosity (DEBUG) should log everything.
    logging.log(grpc.logVerbosity.DEBUG, "a", "b", "c");
    logging.log(grpc.logVerbosity.INFO, "d", "e");
    logging.log(grpc.logVerbosity.ERROR, "f");

    // The INFO verbosity should not log DEBUG data.
    logging.setLoggerVerbosity(grpc.logVerbosity.INFO);
    logging.log(grpc.logVerbosity.DEBUG, 1, 2, 3);
    logging.log(grpc.logVerbosity.INFO, "g");
    logging.log(grpc.logVerbosity.ERROR, "h", "i");

    // The ERROR verbosity should not log DEBUG or INFO data.
    logging.setLoggerVerbosity(grpc.logVerbosity.ERROR);
    logging.log(grpc.logVerbosity.DEBUG, 4, 5, 6);
    logging.log(grpc.logVerbosity.INFO, 7, 8);
    logging.log(grpc.logVerbosity.ERROR, "j", "k");

    assert.deepStrictEqual(output, [["a", "b", "c"], ["d", "e"], ["f"], ["g"], ["h", "i"], ["j", "k"]]);
  });
});
