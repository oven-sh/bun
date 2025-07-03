import { describe, expect, test } from "bun:test";
import * as uuid from "uuid";

describe("randomUUIDv5", () => {
  const dnsNamespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  const urlNamespace = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

  test("basic functionality", () => {
    const uuid = Bun.randomUUIDv5("www.example.com", dnsNamespace);
    expect(uuid).toBeTypeOf("string");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Check that it's version 5
    expect(uuid[14]).toBe("5");
  });

  test("deterministic output", () => {
    const uuid1 = Bun.randomUUIDv5("www.example.com", dnsNamespace);
    const uuid2 = Bun.randomUUIDv5("www.example.com", dnsNamespace);

    // Should always generate the same UUID for the same namespace + name
    expect(uuid1).toBe(uuid2);
  });

  test("compatibility with uuid library", () => {
    const name = "www.example.com";
    const bunUuid = Bun.randomUUIDv5(name, dnsNamespace);
    const uuidLibUuid = uuid.v5(name, dnsNamespace);

    expect(bunUuid).toBe(uuidLibUuid);
  });

  test("predefined namespace strings", () => {
    // Test with predefined namespace strings
    const uuid1 = Bun.randomUUIDv5("www.example.com", "dns");
    const uuid2 = Bun.randomUUIDv5("www.example.com", dnsNamespace);

    expect(uuid1).toBe(uuid2);

    const uuid3 = Bun.randomUUIDv5("http://example.com", "url");
    const uuid4 = Bun.randomUUIDv5("http://example.com", urlNamespace);

    expect(uuid3).toBe(uuid4);
  });

  test("empty name", () => {
    const uuid = Bun.randomUUIDv5("", dnsNamespace);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");
  });

  test("long name", () => {
    const longName = "a".repeat(1000);
    const uuid = Bun.randomUUIDv5(longName, dnsNamespace);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");
  });

  test("unicode name", () => {
    const unicodeName = "测试.example.com";
    const uuid = Bun.randomUUIDv5(unicodeName, dnsNamespace);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");

    // Should be deterministic
    const uuid2 = Bun.randomUUIDv5(unicodeName, dnsNamespace);
    expect(uuid).toBe(uuid2);
  });

  test("name as ArrayBuffer", () => {
    const nameString = "test";
    const nameBuffer = new TextEncoder().encode(nameString);

    const uuid1 = Bun.randomUUIDv5(nameString, dnsNamespace);
    const uuid2 = Bun.randomUUIDv5(nameBuffer, dnsNamespace);

    expect(uuid1).toBe(uuid2);
  });

  test("name as TypedArray", () => {
    const nameString = "test";
    const nameArray = new Uint8Array(new TextEncoder().encode(nameString));

    const uuid1 = Bun.randomUUIDv5(nameString, dnsNamespace);
    const uuid2 = Bun.randomUUIDv5(nameArray, dnsNamespace);

    expect(uuid1).toBe(uuid2);
  });

  test("error handling - invalid namespace", () => {
    expect(() => {
      Bun.randomUUIDv5("test", "invalid-uuid");
    }).toThrow();
  });

  test("error handling - wrong namespace buffer size", () => {
    const wrongSizeBuffer = new Uint8Array(15); // Should be 16 bytes
    expect(() => {
      Bun.randomUUIDv5("test", wrongSizeBuffer);
    }).toThrow();
  });

  test("error handling - invalid encoding", () => {
    expect(() => {
      // @ts-expect-error - testing invalid encoding
      Bun.randomUUIDv5("test", dnsNamespace, "invalid");
    }).toThrow();
  });

  test("variant bits are correct", () => {
    const uuid = Bun.randomUUIDv5("test", dnsNamespace);
    const bytes = uuid.replace(/-/g, "");

    // Extract the variant byte (17th hex character, index 16)
    const variantByte = parseInt(bytes.substr(16, 2), 16);

    // Variant bits should be 10xxxxxx (0x80-0xBF)
    expect(variantByte & 0xc0).toBe(0x80);
  });

  test("version bits are correct", () => {
    const uuid = Bun.randomUUIDv5("test", dnsNamespace);
    const bytes = uuid.replace(/-/g, "");

    // Extract the version byte (13th hex character, index 12)
    const versionByte = parseInt(bytes.substr(12, 2), 16);

    // Version bits should be 0101xxxx (0x50-0x5F)
    expect(versionByte & 0xf0).toBe(0x50);
  });

  test("case insensitive namespace strings", () => {
    const uuid1 = Bun.randomUUIDv5("test", "DNS");
    const uuid2 = Bun.randomUUIDv5("test", "dns");
    const uuid3 = Bun.randomUUIDv5("test", "Dns");

    expect(uuid1).toBe(uuid2);
    expect(uuid2).toBe(uuid3);
  });

  test("all predefined namespaces", () => {
    const name = "test";

    const dnsUuid = Bun.randomUUIDv5(name, "dns");
    const urlUuid = Bun.randomUUIDv5(name, "url");
    const oidUuid = Bun.randomUUIDv5(name, "oid");
    const x500Uuid = Bun.randomUUIDv5(name, "x500");

    // All should be different
    expect(dnsUuid).not.toBe(urlUuid);
    expect(urlUuid).not.toBe(oidUuid);
    expect(oidUuid).not.toBe(x500Uuid);

    // All should be valid UUIDs
    [dnsUuid, urlUuid, oidUuid, x500Uuid].forEach(uuid => {
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(uuid[14]).toBe("5");
    });
  });

  test("different namespaces produce different UUIDs", () => {
    const uuid1 = Bun.randomUUIDv5("www.example.com", dnsNamespace);
    const uuid2 = Bun.randomUUIDv5("www.example.com", urlNamespace);

    expect(uuid1).not.toBe(uuid2);
    expect(uuid.v5("www.example.com", dnsNamespace)).toBe(uuid1);
    expect(uuid.v5("www.example.com", urlNamespace)).toBe(uuid2);
  });

  test("different names produce different UUIDs", () => {
    const uuid1 = Bun.randomUUIDv5("www.example.com", dnsNamespace);
    const uuid2 = Bun.randomUUIDv5("api.example.com", dnsNamespace);

    expect(uuid1).not.toBe(uuid2);
  });

  test("hex encoding (default)", () => {
    const uuid = Bun.randomUUIDv5("test", dnsNamespace);
    expect(uuid).toMatch(/^[0-9a-f-]+$/);
    expect(uuid.length).toBe(36); // Standard UUID string length
  });

  test("buffer encoding", () => {
    const uuid = Bun.randomUUIDv5("test", dnsNamespace, "buffer");
    expect(uuid).toBeInstanceOf(Uint8Array);
    expect(uuid.byteLength).toBe(16);
  });

  test("base64 encoding", () => {
    const uuid = Bun.randomUUIDv5("test", dnsNamespace, "base64");
    expect(uuid).toBeTypeOf("string");
    expect(uuid).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test("base64url encoding", () => {
    const uuid = Bun.randomUUIDv5("test", dnsNamespace, "base64url");
    expect(uuid).toBeTypeOf("string");
    expect(uuid).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("namespace as Buffer", () => {
    // Convert UUID string to buffer
    const nsBytes = new Uint8Array(16);
    const nsString = dnsNamespace.replace(/-/g, "");
    for (let i = 0; i < 16; i++) {
      nsBytes[i] = parseInt(nsString.substr(i * 2, 2), 16);
    }

    const uuid1 = Bun.randomUUIDv5("test", dnsNamespace);
    const uuid2 = Bun.randomUUIDv5("test", nsBytes);

    expect(uuid1).toBe(uuid2);
  });

  test("name as Buffer", () => {
    const nameBuffer = new TextEncoder().encode("test");
    const uuid1 = Bun.randomUUIDv5("test", dnsNamespace);
    const uuid2 = Bun.randomUUIDv5(nameBuffer, dnsNamespace);

    expect(uuid1).toBe(uuid2);
  });

  test("empty name", () => {
    const uuid = Bun.randomUUIDv5("", dnsNamespace);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");
  });

  test("RFC 4122 test vectors", () => {
    // These should be deterministic
    const uuid1 = Bun.randomUUIDv5("http://www.example.com/", dnsNamespace);
    const uuid2 = Bun.randomUUIDv5("http://www.example.com/", urlNamespace);

    // Both should be valid version 5 UUIDs
    expect(uuid1).toEqual("b50f73c9-e407-5ea4-8540-70886e8aa2cd");
    expect(uuid2).toEqual("fcde3c85-2270-590f-9e7c-ee003d65e0e2");
  });

  test("error cases", () => {
    // Missing namespace
    // @ts-expect-error
    expect(() => Bun.randomUUIDv5()).toThrow();

    // Missing name
    // @ts-expect-error
    expect(() => Bun.randomUUIDv5(dnsNamespace)).toThrow();

    // Invalid namespace format
    expect(() => Bun.randomUUIDv5("test", "invalid-uuid")).toThrow();

    // Invalid encoding
    // @ts-expect-error
    expect(() => Bun.randomUUIDv5("test", dnsNamespace, "invalid")).toThrow();

    // Namespace buffer wrong size
    expect(() => Bun.randomUUIDv5("test", new Uint8Array(10))).toThrow();
  });

  test("long names", () => {
    const longName = "a".repeat(10000);
    const uuid = Bun.randomUUIDv5(longName, dnsNamespace);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");
  });

  test("unicode names", () => {
    const unicodeName = "测试🌟";
    const uuid = Bun.randomUUIDv5(unicodeName, dnsNamespace);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");

    // Should be deterministic
    const uuid2 = Bun.randomUUIDv5(unicodeName, dnsNamespace);
    expect(uuid).toBe(uuid2);
  });

  test("variant bits are set correctly", () => {
    const uuid = Bun.randomUUIDv5("test", dnsNamespace, "buffer");

    // Check variant bits (bits 6-7 of clock_seq_hi_and_reserved should be 10)
    const variantByte = uuid[8];
    const variantBits = (variantByte & 0xc0) >> 6;
    expect(variantBits).toBe(2); // Binary 10
  });

  test("url namespace", () => {
    const uuid = Bun.randomUUIDv5("test", "6ba7b811-9dad-11d1-80b4-00c04fd430c8");
    expect(uuid).toBeTypeOf("string");
    expect(uuid).toEqual("da5b8893-d6ca-5c1c-9a9c-91f40a2a3649");
  });

  test("dns namespace", () => {
    const result = Bun.randomUUIDv5("test", "dns");
    expect(result).toBeTypeOf("string");
    expect(result[14]).toBe("5");
    expect(result).toEqual(uuid.v5("test", uuid.v5.DNS));
  });

  test("consistent across multiple calls", () => {
    const results: string[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(Bun.randomUUIDv5("consistency-test", dnsNamespace));
    }

    // All results should be identical
    const first = results[0];
    for (const result of results) {
      expect(result).toBe(first);
    }
  });
});
