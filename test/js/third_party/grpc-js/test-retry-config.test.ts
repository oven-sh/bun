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

import assert from "assert";
import { validateServiceConfig } from "@grpc/grpc-js/build/src/service-config";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

function createRetryServiceConfig(retryConfig: object): object {
  return {
    loadBalancingConfig: [],
    methodConfig: [
      {
        name: [
          {
            service: "A",
            method: "B",
          },
        ],

        retryPolicy: retryConfig,
      },
    ],
  };
}

function createHedgingServiceConfig(hedgingConfig: object): object {
  return {
    loadBalancingConfig: [],
    methodConfig: [
      {
        name: [
          {
            service: "A",
            method: "B",
          },
        ],

        hedgingPolicy: hedgingConfig,
      },
    ],
  };
}

function createThrottlingServiceConfig(retryThrottling: object): object {
  return {
    loadBalancingConfig: [],
    methodConfig: [],
    retryThrottling: retryThrottling,
  };
}

interface TestCase {
  description: string;
  config: object;
  error: RegExp;
}

const validRetryConfig = {
  maxAttempts: 2,
  initialBackoff: "1s",
  maxBackoff: "1s",
  backoffMultiplier: 1,
  retryableStatusCodes: [14, "RESOURCE_EXHAUSTED"],
};

const RETRY_TEST_CASES: TestCase[] = [
  {
    description: "omitted maxAttempts",
    config: {
      initialBackoff: "1s",
      maxBackoff: "1s",
      backoffMultiplier: 1,
      retryableStatusCodes: [14],
    },
    error: /retry policy: maxAttempts must be an integer at least 2/,
  },
  {
    description: "a low maxAttempts",
    config: { ...validRetryConfig, maxAttempts: 1 },
    error: /retry policy: maxAttempts must be an integer at least 2/,
  },
  {
    description: "omitted initialBackoff",
    config: {
      maxAttempts: 2,
      maxBackoff: "1s",
      backoffMultiplier: 1,
      retryableStatusCodes: [14],
    },
    error: /retry policy: initialBackoff must be a string consisting of a positive integer or decimal followed by s/,
  },
  {
    description: "a non-numeric initialBackoff",
    config: { ...validRetryConfig, initialBackoff: "abcs" },
    error: /retry policy: initialBackoff must be a string consisting of a positive integer or decimal followed by s/,
  },
  {
    description: "an initialBackoff without an s",
    config: { ...validRetryConfig, initialBackoff: "123" },
    error: /retry policy: initialBackoff must be a string consisting of a positive integer or decimal followed by s/,
  },
  {
    description: "omitted maxBackoff",
    config: {
      maxAttempts: 2,
      initialBackoff: "1s",
      backoffMultiplier: 1,
      retryableStatusCodes: [14],
    },
    error: /retry policy: maxBackoff must be a string consisting of a positive integer or decimal followed by s/,
  },
  {
    description: "a non-numeric maxBackoff",
    config: { ...validRetryConfig, maxBackoff: "abcs" },
    error: /retry policy: maxBackoff must be a string consisting of a positive integer or decimal followed by s/,
  },
  {
    description: "an maxBackoff without an s",
    config: { ...validRetryConfig, maxBackoff: "123" },
    error: /retry policy: maxBackoff must be a string consisting of a positive integer or decimal followed by s/,
  },
  {
    description: "omitted backoffMultiplier",
    config: {
      maxAttempts: 2,
      initialBackoff: "1s",
      maxBackoff: "1s",
      retryableStatusCodes: [14],
    },
    error: /retry policy: backoffMultiplier must be a number greater than 0/,
  },
  {
    description: "a negative backoffMultiplier",
    config: { ...validRetryConfig, backoffMultiplier: -1 },
    error: /retry policy: backoffMultiplier must be a number greater than 0/,
  },
  {
    description: "omitted retryableStatusCodes",
    config: {
      maxAttempts: 2,
      initialBackoff: "1s",
      maxBackoff: "1s",
      backoffMultiplier: 1,
    },
    error: /retry policy: retryableStatusCodes is required/,
  },
  {
    description: "empty retryableStatusCodes",
    config: { ...validRetryConfig, retryableStatusCodes: [] },
    error: /retry policy: retryableStatusCodes must be non-empty/,
  },
  {
    description: "unknown status code name",
    config: { ...validRetryConfig, retryableStatusCodes: ["abcd"] },
    error: /retry policy: retryableStatusCodes value not a status code name/,
  },
  {
    description: "out of range status code number",
    config: { ...validRetryConfig, retryableStatusCodes: [12345] },
    error: /retry policy: retryableStatusCodes value not in status code range/,
  },
];

const validHedgingConfig = {
  maxAttempts: 2,
};

const HEDGING_TEST_CASES: TestCase[] = [
  {
    description: "omitted maxAttempts",
    config: {},
    error: /hedging policy: maxAttempts must be an integer at least 2/,
  },
  {
    description: "a low maxAttempts",
    config: { ...validHedgingConfig, maxAttempts: 1 },
    error: /hedging policy: maxAttempts must be an integer at least 2/,
  },
  {
    description: "a non-numeric hedgingDelay",
    config: { ...validHedgingConfig, hedgingDelay: "abcs" },
    error: /hedging policy: hedgingDelay must be a string consisting of a positive integer followed by s/,
  },
  {
    description: "a hedgingDelay without an s",
    config: { ...validHedgingConfig, hedgingDelay: "123" },
    error: /hedging policy: hedgingDelay must be a string consisting of a positive integer followed by s/,
  },
  {
    description: "unknown status code name",
    config: { ...validHedgingConfig, nonFatalStatusCodes: ["abcd"] },
    error: /hedging policy: nonFatalStatusCodes value not a status code name/,
  },
  {
    description: "out of range status code number",
    config: { ...validHedgingConfig, nonFatalStatusCodes: [12345] },
    error: /hedging policy: nonFatalStatusCodes value not in status code range/,
  },
];

const validThrottlingConfig = {
  maxTokens: 100,
  tokenRatio: 0.1,
};

const THROTTLING_TEST_CASES: TestCase[] = [
  {
    description: "omitted maxTokens",
    config: { tokenRatio: 0.1 },
    error: /retryThrottling: maxTokens must be a number in \(0, 1000\]/,
  },
  {
    description: "a large maxTokens",
    config: { ...validThrottlingConfig, maxTokens: 1001 },
    error: /retryThrottling: maxTokens must be a number in \(0, 1000\]/,
  },
  {
    description: "zero maxTokens",
    config: { ...validThrottlingConfig, maxTokens: 0 },
    error: /retryThrottling: maxTokens must be a number in \(0, 1000\]/,
  },
  {
    description: "omitted tokenRatio",
    config: { maxTokens: 100 },
    error: /retryThrottling: tokenRatio must be a number greater than 0/,
  },
  {
    description: "zero tokenRatio",
    config: { ...validThrottlingConfig, tokenRatio: 0 },
    error: /retryThrottling: tokenRatio must be a number greater than 0/,
  },
];

describe("Retry configs", () => {
  describe("Retry", () => {
    it("Should accept a valid config", () => {
      assert.doesNotThrow(() => {
        validateServiceConfig(createRetryServiceConfig(validRetryConfig));
      });
    });
    for (const testCase of RETRY_TEST_CASES) {
      it(`Should reject ${testCase.description}`, () => {
        assert.throws(() => {
          validateServiceConfig(createRetryServiceConfig(testCase.config));
        }, testCase.error);
      });
    }
  });
  describe("Hedging", () => {
    it("Should accept valid configs", () => {
      assert.doesNotThrow(() => {
        validateServiceConfig(createHedgingServiceConfig(validHedgingConfig));
      });
      assert.doesNotThrow(() => {
        validateServiceConfig(
          createHedgingServiceConfig({
            ...validHedgingConfig,
            hedgingDelay: "1s",
          }),
        );
      });
      assert.doesNotThrow(() => {
        validateServiceConfig(
          createHedgingServiceConfig({
            ...validHedgingConfig,
            nonFatalStatusCodes: [14, "RESOURCE_EXHAUSTED"],
          }),
        );
      });
    });
    for (const testCase of HEDGING_TEST_CASES) {
      it(`Should reject ${testCase.description}`, () => {
        assert.throws(() => {
          validateServiceConfig(createHedgingServiceConfig(testCase.config));
        }, testCase.error);
      });
    }
  });
  describe("Throttling", () => {
    it("Should accept a valid config", () => {
      assert.doesNotThrow(() => {
        validateServiceConfig(createThrottlingServiceConfig(validThrottlingConfig));
      });
    });
    for (const testCase of THROTTLING_TEST_CASES) {
      it(`Should reject ${testCase.description}`, () => {
        assert.throws(() => {
          validateServiceConfig(createThrottlingServiceConfig(testCase.config));
        }, testCase.error);
      });
    }
  });
});
