import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("minify preserves newline type in template literals", async () => {
  using dir = tempDir("test-crlf-minify", {
    "input.js":
      "function test() {\n" +
      '  return "line1\\r\\nline2";\n' + // Regular string literal with escape sequences
      "}\n" +
      "export default test();\n",
  });

  const inputFile = `${dir}/input.js`;
  const outputFile = `${dir}/output.js`;

  const proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "--minify", inputFile, "--outfile", outputFile],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // Read the minified output
  const minified = await Bun.file(outputFile).text();

  // The minified output should NOT convert string literals to template literals
  // when they contain escape sequences like \r\n
  expect(minified).toContain('"line1\\r\\nline2"');

  // Run the minified code to ensure it produces the correct output
  const module = await import(outputFile);
  expect(module.default).toBe("line1\r\nline2");
});

test("minify typescript preserves line endings", async () => {
  using dir = tempDir("test-typescript-minify", {
    "typescript-test.js": `
      export function transpileTest(ts) {
        const source = 'let x: () => string = () => "string"';
        const result = ts.transpileModule(source, {
          compilerOptions: {
            target: 2, // ES3
          },
        });
        return result.outputText;
      }
    `,
  });

  const inputFile = `${dir}/typescript-test.js`;
  const outputFile = `${dir}/typescript-test.min.js`;

  const proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", "--minify", inputFile, "--outfile", outputFile],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode] = await Promise.all([proc.exited]);
  expect(exitCode).toBe(0);

  // Ensure the minified code is valid
  const module = await import(outputFile);
  expect(module.transpileTest).toBeDefined();
});
