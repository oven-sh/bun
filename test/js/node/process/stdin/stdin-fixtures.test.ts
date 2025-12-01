import { spawn } from "child_process";
import path from "path";
import { bunExe } from "harness";

type Test = {
  file: string;
  stdin: string[];
  end: boolean;
};

type RunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  autoKilled: boolean;
};

async function run(cmd: string, test: Test): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(import.meta.dir, test.file);

    const child = spawn(cmd, [scriptPath], {
      stdio: "pipe",
    });

    let autoKilled = false;
    setTimeout(() => {
      autoKilled = true;
      child.kill("SIGTERM");
    }, 1000);

    child.on("error", err => {
      reject(err);
    });

    let stdout = "";
    let stderr = "";
    const remainingToSend = [...test.stdin];
    let processedReadyCount = 0;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", chunk => {
      chunk = chunk.replaceAll("\r", "");
      stdout += chunk;
      // Count occurrences of "%READY%" to know when to send stdin
      const currentReadyCount = (stdout.match(/%READY%/g) || []).length;

      if (currentReadyCount > processedReadyCount) {
        const numNewReady = currentReadyCount - processedReadyCount;
        processedReadyCount = currentReadyCount;

        for (let i = 0; i < numNewReady; i++) {
          const toSend = remainingToSend.shift();
          if (toSend !== undefined) {
            child.stdin.write(toSend);
          } else {
            if (test.end) {
              // If we've run out of input and the test expects stdin to be closed.
              if (child.stdin.writable && !child.stdin.writableEnded) {
                child.stdin.end();
              }
            } else {
              // Script is asking for more input, but we have none. This is an error.
              child.kill(); // Ensure the process is terminated
              reject(new Error(`[${cmd}] No more stdin to send, but script requested more.`));
              return; // Prevent further processing
            }
          }
        }
      }
    });

    child.stderr.on("data", chunk => {
      chunk = chunk.replaceAll("\r", "");
      stderr += chunk;
    });

    let exitCode: number | null = null;
    child.on("exit", code => {
      exitCode = code;
    });

    // The 'close' event fires after the process exits and all stdio streams are closed.
    // This is the safest point to resolve the promise with the final results.
    child.on("close", () => {
      // Check if we failed to send all required input.
      if (remainingToSend.length > 0) {
        reject(new Error(`[${cmd}] Not all stdin was sent. Unsent: ${JSON.stringify(remainingToSend)}`));
        return;
      }

      resolve({
        exitCode,
        stdout,
        stderr,
        autoKilled,
      });
    });
  });
}

async function runBoth(test: Test): Promise<RunResult> {
  const nodeResult = await run("node", test);
  // console.log("Node.js Result:", nodeResult);

  const bunResult = await run(bunExe(), test);
  // console.log("Bun Result:", bunResult);

  expect(bunResult).toEqual(nodeResult);
  return bunResult;
}

describe("stdin", () => {
  it("pause allows process to exit", async () => {
    // in node, raw stdin behaves differently than pty. run this test in bun only for now.
    expect(await run(bunExe(), { file: "pause.fixture.js", stdin: ["abc\n", "pause\n", "def\n"], end: false }))
      .toMatchInlineSnapshot(`
      {
        "autoKilled": false,
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "%READY%
      got stdin "abc"
      %READY%
      got stdin "pause"
      %READY%
      beforeExit with code 0
      exit with code 0
      "
      ,
      }
    `);
  });
  it("pause with readable listener does not allow process to exit", async () => {
    expect(
      await runBoth({
        file: "pause.fixture.js",
        stdin: ["attachReadable\n", "abc\n", "pause\n", "def\n", "exit\n"],
        end: false,
      }),
    ).toMatchInlineSnapshot(`
      {
        "autoKilled": false,
        "exitCode": 123,
        "stderr": "",
        "stdout": 
      "%READY%
      got stdin "attachReadable"
      %READY%
      got stdin "abc"
      %READY%
      got readable "abc\\n"
      got stdin "pause"
      %READY%
      got readable "pause\\n"
      got stdin "def"
      %READY%
      got readable "def\\n"
      got stdin "exit"
      exit with code 123
      "
      ,
      }
    `);
  });
  it("unref-should-exit", async () => {
    expect(await runBoth({ file: "unref-should-exit.fixture.js", stdin: [], end: false })).toMatchInlineSnapshot(`
      {
        "autoKilled": false,
        "exitCode": 0,
        "stderr": "",
        "stdout": "",
      }
    `);
  });
  it("works with data listener", async () => {
    expect(await runBoth({ file: "data.fixture.js", stdin: ["abc\n", "def\n"], end: true })).toMatchInlineSnapshot(`
      {
        "autoKilled": false,
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "%READY%
      got data "abc\\n"
      %READY%
      got data "def\\n"
      %READY%
      "
      ,
      }
    `);
  });
  it("works with readable listener", async () => {
    expect(await runBoth({ file: "readable.fixture.js", stdin: ["abc\n", "def\n"], end: true })).toMatchInlineSnapshot(`
      {
        "autoKilled": false,
        "exitCode": 0,
        "stderr": "",
        "stdout": 
      "%READY%
      got readable "abc\\n"
      %READY%
      got readable "def\\n"
      %READY%
      "
      ,
      }
    `);
  });
});
