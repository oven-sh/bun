//#FILE: test-util-sigint-watchdog.js
//#SHA1: 8731497954a21e75af21af0adde10619d98a703f
//-----------------
"use strict";

// Skip test on Windows platforms
if (process.platform === "win32") {
  test.skip("platform not supported", () => {});
} else {
  const binding = {
    startSigintWatchdog: jest.fn(),
    stopSigintWatchdog: jest.fn(),
    watchdogHasPendingSigint: jest.fn(),
  };

  // Mock the process.kill function
  const originalKill = process.kill;
  beforeAll(() => {
    process.kill = jest.fn();
  });
  afterAll(() => {
    process.kill = originalKill;
  });

  function waitForPendingSignal(cb) {
    if (binding.watchdogHasPendingSigint()) cb();
    else setTimeout(waitForPendingSignal, 10, cb);
  }

  test("with no signal observed", () => {
    binding.startSigintWatchdog();
    binding.stopSigintWatchdog.mockReturnValue(false);
    const hadPendingSignals = binding.stopSigintWatchdog();
    expect(hadPendingSignals).toBe(false);
  });

  test("with one call to the watchdog, one signal", done => {
    binding.startSigintWatchdog();
    process.kill(process.pid, "SIGINT");
    binding.watchdogHasPendingSigint.mockReturnValue(true);
    binding.stopSigintWatchdog.mockReturnValue(true);

    waitForPendingSignal(() => {
      const hadPendingSignals = binding.stopSigintWatchdog();
      expect(hadPendingSignals).toBe(true);
      done();
    });
  });

  test("nested calls are okay", done => {
    binding.startSigintWatchdog();
    binding.startSigintWatchdog();
    process.kill(process.pid, "SIGINT");
    binding.watchdogHasPendingSigint.mockReturnValue(true);
    binding.stopSigintWatchdog.mockReturnValueOnce(true).mockReturnValueOnce(false);

    waitForPendingSignal(() => {
      const hadPendingSignals1 = binding.stopSigintWatchdog();
      const hadPendingSignals2 = binding.stopSigintWatchdog();
      expect(hadPendingSignals1).toBe(true);
      expect(hadPendingSignals2).toBe(false);
      done();
    });
  });

  test("signal comes in after first call to stop", done => {
    binding.startSigintWatchdog();
    binding.startSigintWatchdog();
    binding.stopSigintWatchdog.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const hadPendingSignals1 = binding.stopSigintWatchdog();
    process.kill(process.pid, "SIGINT");
    binding.watchdogHasPendingSigint.mockReturnValue(true);

    waitForPendingSignal(() => {
      const hadPendingSignals2 = binding.stopSigintWatchdog();
      expect(hadPendingSignals1).toBe(false);
      expect(hadPendingSignals2).toBe(true);
      done();
    });
  });
}

//<#END_FILE: test-util-sigint-watchdog.js
