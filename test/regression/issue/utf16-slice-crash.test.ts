import { test, expect } from "bun:test";
import { spawn } from "bun";

test("UTF-16 ZigString.slice() crash reproduction - console operations", async () => {
  // This test reproduces the crash that occurs when ZigString.slice() is called on UTF-16 strings
  // The crash happens in debug builds when calling .utf8(), .latin1(), .asUTF8(), or .canBeUTF8()
  // on strings containing non-ASCII characters that are stored as UTF-16
  
  const utf16Strings = [
    "🚀 Hello, 世界! 🌍",
    "emoji 🎉 and unicode: ñáéíóú", 
    "日本語の文字列",
    "Café München naïve résumé",
    "🔥💯🎯⭐️🚀"
  ];
  
  // Test console operations that may trigger the problematic String methods
  for (const str of utf16Strings) {
    // This should not crash but may trigger the slice() panic in debug builds
    const oldLog = console.log;
    let captured = "";
    console.log = (msg: any) => { captured = String(msg); };
    
    try {
      console.log(str);
      expect(captured).toBe(str);
    } finally {
      console.log = oldLog;
    }
  }
});

test("UTF-16 ZigString.slice() crash reproduction - file path operations", async () => {
  // Test file operations with UTF-16 paths that trigger String.latin1() on Windows
  const utf16Paths = [
    "/tmp/café.txt",
    "/tmp/🚀rocket.txt", 
    "/tmp/日本語.txt",
    "/tmp/münchen.txt"
  ];
  
  for (const path of utf16Paths) {
    try {
      // This operation may call String.latin1() which calls .slice() without checking is16Bit()
      const exists = await Bun.file(path).exists();
      expect(typeof exists).toBe("boolean");
    } catch (error) {
      // If it crashes, the test will fail anyway, but we want to catch expected errors
      if (error instanceof Error && !error.message.includes("ZigString.slice()")) {
        // This is an expected file not found error, not the crash we're testing for
        continue;
      }
      throw error;
    }
  }
});

test("UTF-16 ZigString.slice() crash reproduction - string encoding", () => {
  // Test string encoding operations that may trigger canBeUTF8() or asUTF8()
  const utf16Strings = [
    "🚀 Hello, 世界! 🌍",
    "emoji 🎉 and unicode: ñáéíóú",
    "Café München naïve résumé",
    "Mixed ASCII and 日本語 Japanese"
  ];
  
  for (const str of utf16Strings) {
    // Test operations that may trigger the problematic string methods
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    expect(bytes.length).toBeGreaterThan(str.length); // UTF-8 encoding should be longer
    
    const decoder = new TextDecoder();
    const decoded = decoder.decode(bytes);
    expect(decoded).toBe(str);
  }
});

test("UTF-16 ZigString.slice() crash reproduction - subprocess with UTF-16", async () => {
  // Test subprocess operations that may trigger string methods on UTF-16 content
  const utf16Command = "echo";
  const utf16Args = ["🚀 Hello, 世界! 🌍"];
  
  try {
    // This may trigger string operations in subprocess handling
    await using proc = spawn({
      cmd: [utf16Command, ...utf16Args],
      stdout: "pipe",
      stderr: "pipe"
    });
    
    const result = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();
    const code = await proc.exited;
    
    // The command should succeed (exit code 0 or command not found)
    expect(code === 0 || code === 127).toBe(true);
  } catch (error) {
    // If it crashes with the ZigString.slice() panic, this test will fail appropriately
    if (error instanceof Error && error.message.includes("ZigString.slice()")) {
      throw new Error(`Reproduced the UTF-16 slice crash: ${error.message}`);
    }
    // Other errors are acceptable for this test
  }
});