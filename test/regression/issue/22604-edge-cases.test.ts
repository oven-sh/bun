import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Issue #22604: source maps handle all JSON escape requirements", async () => {
  // Create a file with various characters that need different escaping in JSON
  const content = [
    '// Regular text',
    'console.log("Hello");',
    '// Tab:\there',
    '// Newline below:',
    '',
    '// Carriage return:\rhere',
    '// Quotes: "double" and \'single\'',
    '// Backslash: \\escaped',
    '// Template literals:',
    'const t = `multi',
    'line\tstring`;',
    '// Unicode: 你好 🎉',
    '// Form feed:\fhere',
    '// Vertical tab:\vhere',
  ].join('\n');
  
  using dir = tempDir("issue-22604-escaping", {
    "index.ts": content,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "index.ts", "--sourcemap", "--outdir", "out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  const sourceMapPath = `${dir}/out/index.js.map`;
  const sourceMapText = await Bun.file(sourceMapPath).text();
  
  // Most importantly: the source map must be valid JSON
  let sourceMap;
  expect(() => {
    sourceMap = JSON.parse(sourceMapText);
  }).not.toThrow();
  
  // The parsed content should match the original exactly
  expect(sourceMap.sourcesContent).toHaveLength(1);
  expect(sourceMap.sourcesContent[0]).toBe(content);
  
  // Verify specific escaping in the raw JSON:
  // - Tabs should be escaped as \\t
  // - Newlines should be escaped as \\n
  // - Carriage returns as \\r
  // - Form feeds as \\f
  // - Backslashes as \\\\
  
  // Check that within the sourcesContent JSON string, these are properly escaped
  const sourcesContentMatch = sourceMapText.match(/"sourcesContent":\s*\[\s*"([^"\\]*(\\.[^"\\]*)*)"\s*\]/);
  expect(sourcesContentMatch).toBeTruthy();
  
  const escapedContent = sourcesContentMatch![1];
  // These patterns should exist in the escaped JSON string
  expect(escapedContent).toContain('\\t');  // Escaped tab
  expect(escapedContent).toContain('\\n');  // Escaped newline
  expect(escapedContent).toContain('\\r');  // Escaped carriage return
  expect(escapedContent).toContain('\\f');  // Escaped form feed
  expect(escapedContent).toContain('\\\\'); // Escaped backslash
  expect(escapedContent).toContain('\\"');  // Escaped double quote
});

test("Issue #22604: source maps work with files containing only whitespace", async () => {
  const files = {
    "spaces.ts": "   ",
    "tabs.ts": "\t\t\t",
    "newlines.ts": "\n\n\n",
    "mixed.ts": " \t\n\r\n ",
  };
  
  using dir = tempDir("issue-22604-whitespace", files);

  for (const [filename, content] of Object.entries(files)) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", filename, "--sourcemap", "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const mapFile = filename.replace(".ts", ".js.map");
    const sourceMapPath = `${dir}/out/${mapFile}`;
    const sourceMapText = await Bun.file(sourceMapPath).text();
    
    // Should be valid JSON
    const sourceMap = JSON.parse(sourceMapText);
    
    // Whitespace-only files might have empty source content or the whitespace preserved
    if (sourceMap.sourcesContent && sourceMap.sourcesContent.length > 0) {
      expect(sourceMap.sourcesContent[0]).toBe(content);
    }
  }
});