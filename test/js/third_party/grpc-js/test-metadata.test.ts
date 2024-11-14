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
import http2 from "http2";
import { range } from "lodash";
import { Metadata, MetadataObject, MetadataValue } from "@grpc/grpc-js/build/src/metadata";
import { afterAll as after, beforeAll as before, describe, it, afterEach, beforeEach } from "bun:test";

class TestMetadata extends Metadata {
  getInternalRepresentation() {
    return this.internalRepr;
  }

  static fromHttp2Headers(headers: http2.IncomingHttpHeaders): TestMetadata {
    const result = Metadata.fromHttp2Headers(headers) as TestMetadata;
    result.getInternalRepresentation = TestMetadata.prototype.getInternalRepresentation;
    return result;
  }
}

const validKeyChars = "0123456789abcdefghijklmnopqrstuvwxyz_-.";
const validNonBinValueChars = range(0x20, 0x7f)
  .map(code => String.fromCharCode(code))
  .join("");

describe("Metadata", () => {
  let metadata: TestMetadata;

  beforeEach(() => {
    metadata = new TestMetadata();
  });

  describe("set", () => {
    it('Only accepts string values for non "-bin" keys', () => {
      assert.throws(() => {
        metadata.set("key", Buffer.from("value"));
      });
      assert.doesNotThrow(() => {
        metadata.set("key", "value");
      });
    });

    it('Only accepts Buffer values for "-bin" keys', () => {
      assert.throws(() => {
        metadata.set("key-bin", "value");
      });
      assert.doesNotThrow(() => {
        metadata.set("key-bin", Buffer.from("value"));
      });
    });

    it("Rejects invalid keys", () => {
      assert.doesNotThrow(() => {
        metadata.set(validKeyChars, "value");
      });
      assert.throws(() => {
        metadata.set("key$", "value");
      }, /Error: Metadata key "key\$" contains illegal characters/);
      assert.throws(() => {
        metadata.set("", "value");
      });
    });

    it("Rejects values with non-ASCII characters", () => {
      assert.doesNotThrow(() => {
        metadata.set("key", validNonBinValueChars);
      });
      assert.throws(() => {
        metadata.set("key", "résumé");
      });
    });

    it("Saves values that can be retrieved", () => {
      metadata.set("key", "value");
      assert.deepStrictEqual(metadata.get("key"), ["value"]);
    });

    it("Overwrites previous values", () => {
      metadata.set("key", "value1");
      metadata.set("key", "value2");
      assert.deepStrictEqual(metadata.get("key"), ["value2"]);
    });

    it("Normalizes keys", () => {
      metadata.set("Key", "value1");
      assert.deepStrictEqual(metadata.get("key"), ["value1"]);
      metadata.set("KEY", "value2");
      assert.deepStrictEqual(metadata.get("key"), ["value2"]);
    });
  });

  describe("add", () => {
    it('Only accepts string values for non "-bin" keys', () => {
      assert.throws(() => {
        metadata.add("key", Buffer.from("value"));
      });
      assert.doesNotThrow(() => {
        metadata.add("key", "value");
      });
    });

    it('Only accepts Buffer values for "-bin" keys', () => {
      assert.throws(() => {
        metadata.add("key-bin", "value");
      });
      assert.doesNotThrow(() => {
        metadata.add("key-bin", Buffer.from("value"));
      });
    });

    it("Rejects invalid keys", () => {
      assert.throws(() => {
        metadata.add("key$", "value");
      });
      assert.throws(() => {
        metadata.add("", "value");
      });
    });

    it("Saves values that can be retrieved", () => {
      metadata.add("key", "value");
      assert.deepStrictEqual(metadata.get("key"), ["value"]);
    });

    it("Combines with previous values", () => {
      metadata.add("key", "value1");
      metadata.add("key", "value2");
      assert.deepStrictEqual(metadata.get("key"), ["value1", "value2"]);
    });

    it("Normalizes keys", () => {
      metadata.add("Key", "value1");
      assert.deepStrictEqual(metadata.get("key"), ["value1"]);
      metadata.add("KEY", "value2");
      assert.deepStrictEqual(metadata.get("key"), ["value1", "value2"]);
    });
  });

  describe("remove", () => {
    it("clears values from a key", () => {
      metadata.add("key", "value");
      metadata.remove("key");
      assert.deepStrictEqual(metadata.get("key"), []);
    });

    it("Normalizes keys", () => {
      metadata.add("key", "value");
      metadata.remove("KEY");
      assert.deepStrictEqual(metadata.get("key"), []);
    });
  });

  describe("get", () => {
    beforeEach(() => {
      metadata.add("key", "value1");
      metadata.add("key", "value2");
      metadata.add("key-bin", Buffer.from("value"));
    });

    it("gets all values associated with a key", () => {
      assert.deepStrictEqual(metadata.get("key"), ["value1", "value2"]);
    });

    it("Normalizes keys", () => {
      assert.deepStrictEqual(metadata.get("KEY"), ["value1", "value2"]);
    });

    it("returns an empty list for non-existent keys", () => {
      assert.deepStrictEqual(metadata.get("non-existent-key"), []);
    });

    it('returns Buffers for "-bin" keys', () => {
      assert.ok(metadata.get("key-bin")[0] instanceof Buffer);
    });
  });

  describe("getMap", () => {
    it("gets a map of keys to values", () => {
      metadata.add("key1", "value1");
      metadata.add("Key2", "value2");
      metadata.add("KEY3", "value3a");
      metadata.add("KEY3", "value3b");
      assert.deepStrictEqual(metadata.getMap(), {
        key1: "value1",
        key2: "value2",
        key3: "value3a",
      });
    });
  });

  describe("clone", () => {
    it("retains values from the original", () => {
      metadata.add("key", "value");
      const copy = metadata.clone();
      assert.deepStrictEqual(copy.get("key"), ["value"]);
    });

    it("Does not see newly added values", () => {
      metadata.add("key", "value1");
      const copy = metadata.clone();
      metadata.add("key", "value2");
      assert.deepStrictEqual(copy.get("key"), ["value1"]);
    });

    it("Does not add new values to the original", () => {
      metadata.add("key", "value1");
      const copy = metadata.clone();
      copy.add("key", "value2");
      assert.deepStrictEqual(metadata.get("key"), ["value1"]);
    });

    it("Copy cannot modify binary values in the original", () => {
      const buf = Buffer.from("value-bin");
      metadata.add("key-bin", buf);
      const copy = metadata.clone();
      const copyBuf = copy.get("key-bin")[0] as Buffer;
      assert.deepStrictEqual(copyBuf, buf);
      copyBuf.fill(0);
      assert.notDeepStrictEqual(copyBuf, buf);
    });
  });

  describe("merge", () => {
    it("appends values from a given metadata object", () => {
      metadata.add("key1", "value1");
      metadata.add("Key2", "value2a");
      metadata.add("KEY3", "value3a");
      metadata.add("key4", "value4");
      const metadata2 = new TestMetadata();
      metadata2.add("KEY1", "value1");
      metadata2.add("key2", "value2b");
      metadata2.add("key3", "value3b");
      metadata2.add("key5", "value5a");
      metadata2.add("key5", "value5b");
      const metadata2IR = metadata2.getInternalRepresentation();
      metadata.merge(metadata2);
      // Ensure metadata2 didn't change
      assert.deepStrictEqual(metadata2.getInternalRepresentation(), metadata2IR);
      assert.deepStrictEqual(metadata.get("key1"), ["value1", "value1"]);
      assert.deepStrictEqual(metadata.get("key2"), ["value2a", "value2b"]);
      assert.deepStrictEqual(metadata.get("key3"), ["value3a", "value3b"]);
      assert.deepStrictEqual(metadata.get("key4"), ["value4"]);
      assert.deepStrictEqual(metadata.get("key5"), ["value5a", "value5b"]);
    });
  });

  describe("toHttp2Headers", () => {
    it("creates an OutgoingHttpHeaders object with expected values", () => {
      metadata.add("key1", "value1");
      metadata.add("Key2", "value2");
      metadata.add("KEY3", "value3a");
      metadata.add("key3", "value3b");
      metadata.add("key-bin", Buffer.from(range(0, 16)));
      metadata.add("key-bin", Buffer.from(range(16, 32)));
      metadata.add("key-bin", Buffer.from(range(0, 32)));
      const headers = metadata.toHttp2Headers();
      assert.deepStrictEqual(headers, {
        key1: ["value1"],
        key2: ["value2"],
        key3: ["value3a", "value3b"],
        "key-bin": [
          "AAECAwQFBgcICQoLDA0ODw==",
          "EBESExQVFhcYGRobHB0eHw==",
          "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        ],
      });
    });

    it("creates an empty header object from empty Metadata", () => {
      assert.deepStrictEqual(metadata.toHttp2Headers(), {});
    });
  });

  describe("fromHttp2Headers", () => {
    it("creates a Metadata object with expected values", () => {
      const headers = {
        key1: "value1",
        key2: ["value2"],
        key3: ["value3a", "value3b"],
        key4: ["part1, part2"],
        "key-bin": [
          "AAECAwQFBgcICQoLDA0ODw==",
          "EBESExQVFhcYGRobHB0eHw==",
          "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        ],
      };
      const metadataFromHeaders = TestMetadata.fromHttp2Headers(headers);
      const internalRepr = metadataFromHeaders.getInternalRepresentation();
      const expected: MetadataObject = new Map<string, MetadataValue[]>([
        ["key1", ["value1"]],
        ["key2", ["value2"]],
        ["key3", ["value3a", "value3b"]],
        ["key4", ["part1, part2"]],
        ["key-bin", [Buffer.from(range(0, 16)), Buffer.from(range(16, 32)), Buffer.from(range(0, 32))]],
      ]);
      assert.deepStrictEqual(internalRepr, expected);
    });

    it("creates an empty Metadata object from empty headers", () => {
      const metadataFromHeaders = TestMetadata.fromHttp2Headers({});
      const internalRepr = metadataFromHeaders.getInternalRepresentation();
      assert.deepStrictEqual(internalRepr, new Map<string, MetadataValue[]>());
    });
  });
});
