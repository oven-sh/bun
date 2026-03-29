import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// GitHub Issue #25695: Error.captureStackTrace with custom prepareStackTrace
// does not include async continuation frames (awaiter frames), causing NX's
// recursion detection to fail and leading to infinite recursion.
test("Error.captureStackTrace includes async continuation frames in CallSite array", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
let callCount = 0;

function getCallSites() {
    const prepareStackTraceBackup = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stackTraces) => stackTraces;
    const errorObject = {};
    Error.captureStackTrace(errorObject);
    const trace = errorObject.stack;
    Error.prepareStackTrace = prepareStackTraceBackup;
    trace.shift();
    return trace;
}

function preventRecursion() {
    const stackframes = getCallSites().slice(2);
    const found = stackframes.some((f) => {
        return f.getFunctionName() === 'outerAsync';
    });
    if (found) {
        throw new Error('Loop detected');
    }
}

async function outerAsync() {
    callCount++;
    if (callCount > 5) {
        throw new Error('Safety limit');
    }
    preventRecursion();
    await new Promise(resolve => setTimeout(resolve, 1));
    const result = await middleAsync();
    return result;
}

async function middleAsync() {
    return await innerAsync();
}

async function innerAsync() {
    return await outerAsync();
}

try {
    await outerAsync();
    console.log("BUG:" + callCount);
} catch (e) {
    if (e.message === 'Loop detected') {
        console.log("OK:" + callCount);
    } else {
        console.log("FAIL:" + e.message);
    }
}
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should detect the recursion, not hit the safety limit
  expect(stdout.trim()).toStartWith("OK:");
  expect(exitCode).toBe(0);
});

test("Error.captureStackTrace async frames have correct function names", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function getCallSites() {
    const backup = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, sites) => sites;
    const obj = {};
    Error.captureStackTrace(obj);
    const trace = obj.stack;
    Error.prepareStackTrace = backup;
    return trace;
}

let captured = null;

async function alphaAsync() {
    await new Promise(resolve => setTimeout(resolve, 1));
    const result = await betaAsync();
    return result;
}

async function betaAsync() {
    return await gammaAsync();
}

async function gammaAsync() {
    // Capture the stack trace inside the innermost async function
    captured = getCallSites().map(s => s.getFunctionName()).filter(Boolean);
    return 42;
}

await alphaAsync();
// The captured stack should include gammaAsync's callers (betaAsync, alphaAsync)
// via async continuation frames
const hasGamma = captured.includes('gammaAsync');
const hasBeta = captured.includes('betaAsync');
const hasAlpha = captured.includes('alphaAsync');
console.log(JSON.stringify({ hasGamma, hasBeta, hasAlpha, frames: captured }));
`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  // gammaAsync is the current frame (synchronous), should always be present
  expect(result.hasGamma).toBe(true);
  // betaAsync and alphaAsync are async continuation frames
  expect(result.hasBeta).toBe(true);
  expect(result.hasAlpha).toBe(true);
  expect(exitCode).toBe(0);
});
