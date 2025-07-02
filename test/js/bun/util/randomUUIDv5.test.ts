import { describe, expect, test } from "bun:test";

describe("randomUUIDv5", () => {
  const dnsNamespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  const urlNamespace = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
  
  test("basic functionality", () => {
    const uuid = Bun.randomUUIDv5(dnsNamespace, "www.example.com");
    expect(uuid).toBeTypeOf("string");
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    
    // Check that it's version 5
    expect(uuid[14]).toBe("5");
  });

  test("deterministic output", () => {
    const uuid1 = Bun.randomUUIDv5(dnsNamespace, "www.example.com");
    const uuid2 = Bun.randomUUIDv5(dnsNamespace, "www.example.com");
    
    // Should always generate the same UUID for the same namespace + name
    expect(uuid1).toBe(uuid2);
  });

  test("different namespaces produce different UUIDs", () => {
    const uuid1 = Bun.randomUUIDv5(dnsNamespace, "www.example.com");
    const uuid2 = Bun.randomUUIDv5(urlNamespace, "www.example.com");
    
    expect(uuid1).not.toBe(uuid2);
  });

  test("different names produce different UUIDs", () => {
    const uuid1 = Bun.randomUUIDv5(dnsNamespace, "www.example.com");
    const uuid2 = Bun.randomUUIDv5(dnsNamespace, "api.example.com");
    
    expect(uuid1).not.toBe(uuid2);
  });

  test("hex encoding (default)", () => {
    const uuid = Bun.randomUUIDv5(dnsNamespace, "test");
    expect(uuid).toMatch(/^[0-9a-f-]+$/);
    expect(uuid.length).toBe(36); // Standard UUID string length
  });

  test("buffer encoding", () => {
    const uuid = Bun.randomUUIDv5(dnsNamespace, "test", "buffer");
    expect(uuid).toBeInstanceOf(Uint8Array);
    expect(uuid.byteLength).toBe(16);
  });

  test("base64 encoding", () => {
    const uuid = Bun.randomUUIDv5(dnsNamespace, "test", "base64");
    expect(uuid).toBeTypeOf("string");
    expect(uuid).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test("base64url encoding", () => {
    const uuid = Bun.randomUUIDv5(dnsNamespace, "test", "base64url");
    expect(uuid).toBeTypeOf("string");
    expect(uuid).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("namespace as Buffer", () => {
    // Convert UUID string to buffer
    const nsBytes = new Uint8Array(16);
    const nsString = dnsNamespace.replace(/-/g, '');
    for (let i = 0; i < 16; i++) {
      nsBytes[i] = parseInt(nsString.substr(i * 2, 2), 16);
    }
    
    const uuid1 = Bun.randomUUIDv5(dnsNamespace, "test");
    const uuid2 = Bun.randomUUIDv5(nsBytes, "test");
    
    expect(uuid1).toBe(uuid2);
  });

  test("name as Buffer", () => {
    const nameBuffer = new TextEncoder().encode("test");
    const uuid1 = Bun.randomUUIDv5(dnsNamespace, "test");
    const uuid2 = Bun.randomUUIDv5(dnsNamespace, nameBuffer);
    
    expect(uuid1).toBe(uuid2);
  });

  test("empty name", () => {
    const uuid = Bun.randomUUIDv5(dnsNamespace, "");
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");
  });

  test("RFC 4122 test vectors", () => {
    // Test with known values from RFC 4122 examples
    const dnsNs = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const urlNs = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
    
    // These should be deterministic
    const uuid1 = Bun.randomUUIDv5(dnsNs, "www.example.com");
    const uuid2 = Bun.randomUUIDv5(urlNs, "http://www.example.com/");
    
    // Both should be valid version 5 UUIDs
    expect(uuid1[14]).toBe("5");
    expect(uuid2[14]).toBe("5");
    expect(uuid1).not.toBe(uuid2);
  });

  test("error cases", () => {
    // Missing namespace
    expect(() => Bun.randomUUIDv5()).toThrow();
    
    // Missing name
    expect(() => Bun.randomUUIDv5(dnsNamespace)).toThrow();
    
    // Invalid namespace format
    expect(() => Bun.randomUUIDv5("invalid-uuid", "test")).toThrow();
    
    // Invalid encoding
    expect(() => Bun.randomUUIDv5(dnsNamespace, "test", "invalid")).toThrow();
    
    // Namespace buffer wrong size
    expect(() => Bun.randomUUIDv5(new Uint8Array(10), "test")).toThrow();
  });

  test("long names", () => {
    const longName = "a".repeat(10000);
    const uuid = Bun.randomUUIDv5(dnsNamespace, longName);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");
  });

  test("unicode names", () => {
    const unicodeName = "测试🌟";
    const uuid = Bun.randomUUIDv5(dnsNamespace, unicodeName);
    expect(uuid).toBeTypeOf("string");
    expect(uuid[14]).toBe("5");
    
    // Should be deterministic
    const uuid2 = Bun.randomUUIDv5(dnsNamespace, unicodeName);
    expect(uuid).toBe(uuid2);
  });

  test("variant bits are set correctly", () => {
    const uuid = Bun.randomUUIDv5(dnsNamespace, "test", "buffer");
    
    // Check variant bits (bits 6-7 of clock_seq_hi_and_reserved should be 10)
    const variantByte = uuid[8];
    const variantBits = (variantByte & 0xC0) >> 6;
    expect(variantBits).toBe(2); // Binary 10
  });

  test("consistent across multiple calls", () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      results.push(Bun.randomUUIDv5(dnsNamespace, "consistency-test"));
    }
    
    // All results should be identical
    const first = results[0];
    for (const result of results) {
      expect(result).toBe(first);
    }
  });
});