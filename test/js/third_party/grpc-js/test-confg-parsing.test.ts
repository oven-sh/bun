/*
 * Copyright 2023 gRPC authors.
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

import { experimental } from "@grpc/grpc-js";
import { describe, it } from "bun:test";
import assert from "node:assert";

import parseLoadBalancingConfig = experimental.parseLoadBalancingConfig;

/**
 * Describes a test case for config parsing. input is passed to
 * parseLoadBalancingConfig. If error is set, the expectation is that that
 * operation throws an error with a matching message. Otherwise, toJsonObject
 * is called on the result, and it is expected to match output, or input if
 * output is unset.
 */
interface TestCase {
  name: string;
  input: object;
  output?: object;
  error?: RegExp;
}

/* The main purpose of these tests is to verify that configs that are expected
 * to be valid parse successfully, and configs that are expected to be invalid
 * throw errors. The specific output of this parsing is a lower priority
 * concern.
 * Note: some tests have an expected output that is different from the output,
 * but all non-error tests additionally verify that parsing the output again
 * produces the same output. */
const allTestCases: { [lbPolicyName: string]: TestCase[] } = {
  pick_first: [
    {
      name: "no fields set",
      input: {},
      output: {
        shuffleAddressList: false,
      },
    },
    {
      name: "shuffleAddressList set",
      input: {
        shuffleAddressList: true,
      },
    },
  ],
  round_robin: [
    {
      name: "no fields set",
      input: {},
    },
  ],
  outlier_detection: [
    {
      name: "only required fields set",
      input: {
        child_policy: [{ round_robin: {} }],
      },
      output: {
        interval: {
          seconds: 10,
          nanos: 0,
        },
        base_ejection_time: {
          seconds: 30,
          nanos: 0,
        },
        max_ejection_time: {
          seconds: 300,
          nanos: 0,
        },
        max_ejection_percent: 10,
        success_rate_ejection: undefined,
        failure_percentage_ejection: undefined,
        child_policy: [{ round_robin: {} }],
      },
    },
    {
      name: "all optional fields undefined",
      input: {
        interval: undefined,
        base_ejection_time: undefined,
        max_ejection_time: undefined,
        max_ejection_percent: undefined,
        success_rate_ejection: undefined,
        failure_percentage_ejection: undefined,
        child_policy: [{ round_robin: {} }],
      },
      output: {
        interval: {
          seconds: 10,
          nanos: 0,
        },
        base_ejection_time: {
          seconds: 30,
          nanos: 0,
        },
        max_ejection_time: {
          seconds: 300,
          nanos: 0,
        },
        max_ejection_percent: 10,
        success_rate_ejection: undefined,
        failure_percentage_ejection: undefined,
        child_policy: [{ round_robin: {} }],
      },
    },
    {
      name: "empty ejection configs",
      input: {
        success_rate_ejection: {},
        failure_percentage_ejection: {},
        child_policy: [{ round_robin: {} }],
      },
      output: {
        interval: {
          seconds: 10,
          nanos: 0,
        },
        base_ejection_time: {
          seconds: 30,
          nanos: 0,
        },
        max_ejection_time: {
          seconds: 300,
          nanos: 0,
        },
        max_ejection_percent: 10,
        success_rate_ejection: {
          stdev_factor: 1900,
          enforcement_percentage: 100,
          minimum_hosts: 5,
          request_volume: 100,
        },
        failure_percentage_ejection: {
          threshold: 85,
          enforcement_percentage: 100,
          minimum_hosts: 5,
          request_volume: 50,
        },
        child_policy: [{ round_robin: {} }],
      },
    },
    {
      name: "all fields populated",
      input: {
        interval: {
          seconds: 20,
          nanos: 0,
        },
        base_ejection_time: {
          seconds: 40,
          nanos: 0,
        },
        max_ejection_time: {
          seconds: 400,
          nanos: 0,
        },
        max_ejection_percent: 20,
        success_rate_ejection: {
          stdev_factor: 1800,
          enforcement_percentage: 90,
          minimum_hosts: 4,
          request_volume: 200,
        },
        failure_percentage_ejection: {
          threshold: 95,
          enforcement_percentage: 90,
          minimum_hosts: 4,
          request_volume: 60,
        },
        child_policy: [{ round_robin: {} }],
      },
    },
  ],
};

describe("Load balancing policy config parsing", () => {
  for (const [lbPolicyName, testCases] of Object.entries(allTestCases)) {
    describe(lbPolicyName, () => {
      for (const testCase of testCases) {
        it(testCase.name, () => {
          const lbConfigInput = { [lbPolicyName]: testCase.input };
          if (testCase.error) {
            assert.throws(() => {
              parseLoadBalancingConfig(lbConfigInput);
            }, testCase.error);
          } else {
            const expectedOutput = testCase.output ?? testCase.input;
            const parsedJson = parseLoadBalancingConfig(lbConfigInput).toJsonObject();
            assert.deepStrictEqual(parsedJson, {
              [lbPolicyName]: expectedOutput,
            });
            // Test idempotency
            assert.deepStrictEqual(parseLoadBalancingConfig(parsedJson).toJsonObject(), parsedJson);
          }
        });
      }
    });
  }
});
