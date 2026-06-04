import { expect, test } from "bun:test";

// Looked up at call time (instead of a named ESM import) so that running this
// file against a build without the binding reports each test as failed with a
// clear error instead of aborting the whole file at module load.
const { hwTimerInternals } = require("bun:internal-for-testing");

// CPUID 0x15 values the way a Skylake-class part reports them on bare metal:
// TSC/crystal ratio = 188/2 with a 24 MHz crystal -> 2.256 GHz.
const leaf15 = { eax: 2, ebx: 188, ecx: 24_000_000 };
const leaf15Hz = (leaf15.ecx * leaf15.ebx) / leaf15.eax;

test("hw_timer exposes the TSC frequency decision to bun:internal-for-testing", () => {
  expect(hwTimerInternals).toBeDefined();
  expect(typeof hwTimerInternals.resolveTscFrequency).toBe("function");
  expect(typeof hwTimerInternals.calibrationState).toBe("function");
});

test("CPUID leaf 0x15 is not trusted inside a hypervisor guest", () => {
  // The GCP/KVM mis-calibration shape: the guest sees the hypervisor bit plus a
  // populated leaf 0x15 describing the *host* crystal, which does not match the
  // rate the guest's (scaled) TSC actually ticks at. With no hypervisor timing
  // leaf available there is no trustworthy CPUID source, so the decision must
  // be 0 (OS-clock fallback) instead of the leaf-0x15 value.
  expect(hwTimerInternals.resolveTscFrequency(true, 0x4000_0001, 0, leaf15.eax, leaf15.ebx, leaf15.ecx)).toBe(0);
});

test("hypervisor timing leaf wins over leaf 0x15 in a guest", () => {
  // KVM/VMware advertise the guest TSC rate (in kHz) via leaf 0x4000_0010; that
  // value accounts for TSC scaling, so it is the only CPUID source trusted
  // under a hypervisor — even when leaf 0x15 is also populated.
  expect(hwTimerInternals.resolveTscFrequency(true, 0x4000_0010, 2_899_987, leaf15.eax, leaf15.ebx, leaf15.ecx)).toBe(
    2_899_987_000,
  );
});

test("implausible hypervisor timing-leaf values fall back to the OS clock", () => {
  // Timing leaf advertised but empty.
  expect(hwTimerInternals.resolveTscFrequency(true, 0x4000_0010, 0, leaf15.eax, leaf15.ebx, leaf15.ecx)).toBe(0);
  // 1 kHz and ~4.3 THz are not real TSC rates.
  expect(hwTimerInternals.resolveTscFrequency(true, 0x4000_0010, 1, leaf15.eax, leaf15.ebx, leaf15.ecx)).toBe(0);
  expect(hwTimerInternals.resolveTscFrequency(true, 0xffff_ffff, 0xffff_ffff, leaf15.eax, leaf15.ebx, leaf15.ecx)).toBe(
    0,
  );
});

test("bare metal still uses CPUID leaf 0x15", () => {
  expect(hwTimerInternals.resolveTscFrequency(false, 0, 0, leaf15.eax, leaf15.ebx, leaf15.ecx)).toBe(leaf15Hz);
  // Partially populated leaf 0x15 (AMD, pre-Skylake Intel) stays on the OS clock.
  expect(hwTimerInternals.resolveTscFrequency(false, 0, 0, leaf15.eax, leaf15.ebx, 0)).toBe(0);
  expect(hwTimerInternals.resolveTscFrequency(false, 0, 0, 0, 0, 0)).toBe(0);
});

test("calibration frequency matches the OS monotonic clock on this machine", async () => {
  // End-to-end guard for the original report (setTimeout firing at ~2.8x the
  // requested delay on some KVM guests): whatever frequency hw_timer decides to
  // calibrate with must describe the rate the hardware counter actually ticks
  // at, as measured against the OS monotonic clock.
  const a = hwTimerInternals.calibrationState();
  expect(a.frequencyHz).toBeGreaterThanOrEqual(0);
  if (a.frequencyHz === 0) {
    // No trustworthy CPUID frequency on this machine; hw_timer reads the OS
    // clock per call, which cannot mis-calibrate.
    return;
  }

  await Bun.sleep(150);

  const b = hwTimerInternals.calibrationState();
  expect(b.osNs).toBeGreaterThan(a.osNs);
  const measuredHz = ((b.counter - a.counter) / (b.osNs - a.osNs)) * 1e9;
  expect(measuredHz).toBeGreaterThan(0);
  // Scheduling noise between the counter read and the clock read inside one
  // sample is far below a millisecond over a 150 ms window (<1%), while the
  // failure mode being guarded against is a 2.8x mismatch.
  expect(Math.abs(measuredHz - a.frequencyHz) / measuredHz).toBeLessThan(0.2);
});
