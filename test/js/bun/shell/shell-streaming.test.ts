import { test, expect, describe } from "bun:test";
import { $ } from "bun";

describe("Shell streaming stdout/stderr", () => {
  test("stdout returns a ReadableStream", async () => {
    const shell = $`echo "hello world"`;
    const stdout = shell.stdout;

    expect(stdout).toBeInstanceOf(ReadableStream);

    // Consume the stream
    const chunks: Uint8Array[] = [];
    for await (const chunk of stdout) {
      chunks.push(chunk);
    }

    const text = new TextDecoder().decode(Buffer.concat(chunks));
    expect(text.trim()).toBe("hello world");

    // Wait for shell to complete
    await shell;
  });

  test("stderr returns a ReadableStream", async () => {
    const shell = $`node -e "console.error('error message')"`.nothrow();
    const stderr = shell.stderr;

    expect(stderr).toBeInstanceOf(ReadableStream);

    // Consume the stream
    const chunks: Uint8Array[] = [];
    for await (const chunk of stderr) {
      chunks.push(chunk);
    }

    const text = new TextDecoder().decode(Buffer.concat(chunks));
    expect(text.trim()).toBe("error message");

    // Wait for shell to complete
    await shell;
  });

  test("can read stdout stream while command is running", async () => {
    const shell = $`node -e "
      for (let i = 0; i < 3; i++) {
        console.log('line ' + i);
      }
    "`;

    const chunks: string[] = [];
    const reader = shell.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }

    const output = chunks.join('');
    expect(output).toContain("line 0");
    expect(output).toContain("line 1");
    expect(output).toContain("line 2");

    await shell;
  });

  test("stdout and stderr work independently", async () => {
    const shell = $`node -e "
      console.log('stdout message');
      console.error('stderr message');
    "`.nothrow();

    const stdoutPromise = (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of shell.stdout) {
        chunks.push(chunk);
      }
      return new TextDecoder().decode(Buffer.concat(chunks));
    })();

    const stderrPromise = (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of shell.stderr) {
        chunks.push(chunk);
      }
      return new TextDecoder().decode(Buffer.concat(chunks));
    })();

    const [stdoutText, stderrText] = await Promise.all([stdoutPromise, stderrPromise]);

    expect(stdoutText.trim()).toBe("stdout message");
    expect(stderrText.trim()).toBe("stderr message");

    await shell;
  });

  test("can access stdout stream multiple times", async () => {
    const shell = $`echo "test"`;

    const stream1 = shell.stdout;
    const stream2 = shell.stdout;

    // Should return the same stream instance
    expect(stream1).toBe(stream2);

    await shell;
  });
});
