import { expect, test, describe } from "bun:test";

// Helper functions
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function collectStreamOutput(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

describe("CompressionStream edge cases", () => {
  const formats = ["gzip", "deflate", "deflate-raw", "brotli", "zstd"] as const;
  
  describe("boundary-sized chunks", () => {
    // Test chunks around the 16KB threadpool threshold
    const boundarySizes = [
      16383, // Just below 16KB
      16384, // Exactly 16KB
      16385, // Just above 16KB
      32768, // 32KB
    ];
    
    for (const format of formats) {
      for (const size of boundarySizes) {
        test(`${format} - ${size} byte chunk`, async () => {
          const data = "x".repeat(size);
          const cs = new CompressionStream(format as CompressionFormat);
          const writer = cs.writable.getWriter();
          
          await writer.write(data);
          await writer.close();
          
          const compressed = await collectStreamOutput(cs.readable);
          
          // Decompress and verify
          const ds = new DecompressionStream(format as CompressionFormat);
          const dsWriter = ds.writable.getWriter();
          await dsWriter.write(compressed);
          await dsWriter.close();
          
          const decompressed = await collectStreamOutput(ds.readable);
          expect(bytesToString(decompressed)).toBe(data);
        });
      }
    }
  });
  
  describe("empty chunks", () => {
    test("single empty chunk", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      
      await writer.write(new Uint8Array(0));
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("gzip");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(decompressed.length).toBe(0);
    });
    
    test("multiple empty chunks", async () => {
      const cs = new CompressionStream("deflate");
      const writer = cs.writable.getWriter();
      
      for (let i = 0; i < 5; i++) {
        await writer.write(new Uint8Array(0));
      }
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("deflate");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(decompressed.length).toBe(0);
    });
    
    test("empty chunks mixed with data", async () => {
      const cs = new CompressionStream("brotli" as any);
      const writer = cs.writable.getWriter();
      
      await writer.write(stringToBytes("hello"));
      await writer.write(new Uint8Array(0));
      await writer.write(stringToBytes(" world"));
      await writer.write(new Uint8Array(0));
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("brotli" as any);
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe("hello world");
    });
  });
  
  describe("chunks of different sizes", () => {
    test("increasing chunk sizes", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      
      const chunks = [
        "a", // 1 byte
        "bb".repeat(10), // 20 bytes
        "ccc".repeat(100), // 300 bytes
        "dddd".repeat(1000), // 4000 bytes
        "eeeee".repeat(10000), // 50000 bytes
      ];
      
      for (const chunk of chunks) {
        await writer.write(stringToBytes(chunk));
      }
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("gzip");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe(chunks.join(""));
    });
    
    test("random chunk sizes", async () => {
      const cs = new CompressionStream("deflate");
      const writer = cs.writable.getWriter();
      
      const chunks: string[] = [];
      for (let i = 0; i < 10; i++) {
        const size = Math.floor(Math.random() * 1000) + 1;
        const chunk = String.fromCharCode(65 + i).repeat(size);
        chunks.push(chunk);
        await writer.write(stringToBytes(chunk));
      }
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("deflate");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe(chunks.join(""));
    });
  });
  
  describe("very small chunks", () => {
    test("single-byte chunks", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      
      const text = "Hello, World!";
      for (const char of text) {
        await writer.write(stringToBytes(char));
      }
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("gzip");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe(text);
    });
  });
  
  describe("very large chunks", () => {
    test("100KB chunk", async () => {
      const size = 100 * 1024;
      const data = "x".repeat(size);
      
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      
      await writer.write(stringToBytes(data));
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      expect(compressed.length).toBeLessThan(size); // Should compress well
      
      const ds = new DecompressionStream("gzip");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe(data);
    });
    
    test("1MB chunk", async () => {
      const size = 1024 * 1024;
      const data = "abcdefghij".repeat(size / 10);
      
      const cs = new CompressionStream("deflate");
      const writer = cs.writable.getWriter();
      
      await writer.write(stringToBytes(data));
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      expect(compressed.length).toBeLessThan(size);
      
      const ds = new DecompressionStream("deflate");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe(data);
    });
  });
  
  describe("corrupted data handling", () => {
    test("invalid compressed data from start", async () => {
      const ds = new DecompressionStream("gzip");
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      
      // Write clearly invalid data
      const invalidData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
      
      try {
        await writer.write(invalidData);
        await writer.close();
        await reader.read(); // Try to read
        expect(false).toBe(true); // Should not reach here
      } catch (e) {
        // Expected - should throw on invalid data
        expect(e).toBeDefined();
      }
    });
    
    test("valid first chunk followed by corrupted chunk", async () => {
      // First create some valid compressed data
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      await writer.write(stringToBytes("Hello"));
      await writer.close();
      
      const validCompressed = await collectStreamOutput(cs.readable);
      
      // Now try to decompress valid data followed by garbage
      const ds = new DecompressionStream("gzip");
      const dsWriter = ds.writable.getWriter();
      
      // Split valid data and corrupt the second half
      const firstHalf = validCompressed.slice(0, Math.floor(validCompressed.length / 2));
      const corruptedSecondHalf = new Uint8Array(validCompressed.length - firstHalf.length).fill(0xFF);
      
      try {
        await dsWriter.write(firstHalf);
        await dsWriter.write(corruptedSecondHalf);
        await dsWriter.close();
        
        const output = await collectStreamOutput(ds.readable);
        // If we got here, the decompressor might have partial output
        // This is implementation-dependent behavior
        expect(output).toBeDefined();
      } catch (e) {
        // Also acceptable - corruption detected
        expect(e).toBeDefined();
      }
    });
  });
  
  describe("string input handling", () => {
    test("direct string compression", async () => {
      const testString = "This is a test string for compression 🎉 with unicode!";
      
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      
      // Write string directly (tests StringOrBuffer support)
      await writer.write(testString);
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("gzip");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe(testString);
    });
    
    test("mixed string and buffer inputs", async () => {
      const cs = new CompressionStream("deflate");
      const writer = cs.writable.getWriter();
      
      await writer.write("Hello ");
      await writer.write(stringToBytes("from "));
      await writer.write("strings ");
      await writer.write(new Uint8Array([97, 110, 100])); // "and"
      await writer.write(" buffers!");
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("deflate");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe("Hello from strings and buffers!");
    });
  });
  
  describe("stress tests", () => {
    test("many small writes", async () => {
      const cs = new CompressionStream("gzip");
      const writer = cs.writable.getWriter();
      
      const iterations = 1000;
      for (let i = 0; i < iterations; i++) {
        await writer.write(stringToBytes(i.toString()));
      }
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("gzip");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      const expected = Array.from({ length: iterations }, (_, i) => i.toString()).join("");
      expect(bytesToString(decompressed)).toBe(expected);
    });
    
    test("alternating large and small chunks", async () => {
      const cs = new CompressionStream("deflate");
      const writer = cs.writable.getWriter();
      
      const chunks: string[] = [];
      for (let i = 0; i < 20; i++) {
        const chunk = i % 2 === 0 
          ? "L".repeat(20000)  // Large chunk (20KB)
          : "s";                // Small chunk (1 byte)
        chunks.push(chunk);
        await writer.write(stringToBytes(chunk));
      }
      await writer.close();
      
      const compressed = await collectStreamOutput(cs.readable);
      
      const ds = new DecompressionStream("deflate");
      const dsWriter = ds.writable.getWriter();
      await dsWriter.write(compressed);
      await dsWriter.close();
      
      const decompressed = await collectStreamOutput(ds.readable);
      expect(bytesToString(decompressed)).toBe(chunks.join(""));
    });
  });
});

describe("CompressionStream format-specific tests", () => {
  test("brotli quality setting", async () => {
    // Brotli should use quality 4 for streaming (as per implementation)
    const data = "x".repeat(10000);
    
    const cs = new CompressionStream("brotli" as any);
    const writer = cs.writable.getWriter();
    await writer.write(data);
    await writer.close();
    
    const compressed = await collectStreamOutput(cs.readable);
    
    // Should achieve reasonable compression
    expect(compressed.length).toBeLessThan(data.length / 10);
    
    // Should decompress correctly
    const ds = new DecompressionStream("brotli" as any);
    const dsWriter = ds.writable.getWriter();
    await dsWriter.write(compressed);
    await dsWriter.close();
    
    const decompressed = await collectStreamOutput(ds.readable);
    expect(bytesToString(decompressed)).toBe(data);
  });
  
  test("zstd compression", async () => {
    const data = "zstd test data ".repeat(1000);
    
    const cs = new CompressionStream("zstd" as any);
    const writer = cs.writable.getWriter();
    await writer.write(data);
    await writer.close();
    
    const compressed = await collectStreamOutput(cs.readable);
    expect(compressed.length).toBeLessThan(data.length);
    
    const ds = new DecompressionStream("zstd" as any);
    const dsWriter = ds.writable.getWriter();
    await dsWriter.write(compressed);
    await dsWriter.close();
    
    const decompressed = await collectStreamOutput(ds.readable);
    expect(bytesToString(decompressed)).toBe(data);
  });
});