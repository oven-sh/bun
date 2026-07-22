// The fault menu, shared by the deterministic sweeper (sweep.ts) and the
// randomized planner (chaos.ts).

// Injectable syscalls with realistic failure statuses. Being IN this table is
// what makes a syscall a fault site — waits/scheduling/query-loops are
// deliberately absent. mode 'post' = the call succeeds but reports failure.
//
// expect = the severity model for a CRASH under this fault:
//   must-handle    — I/O the app must survive (fs/net/pipe/spawn); a crash
//                    or hang here is a real bug candidate. Sorts first.
//   abort-expected — allocator failure; crash-on-OOM is by design (WebKit
//                    CRASH(), Rust alloc abort). A crash here is expected.
//   judgment       — lying-API (post-mode) / edge cases where "correct"
//                    behavior is a human call.
export type Mode = "pre" | "post" | "mangle:short" | "mangle:zero" | "delay";
export type Fault = { status: string; mode: Mode; expect?: "must-handle" | "abort-expected" | "judgment" };
export const F = (status: string, mode: Mode = "pre", expect: Fault["expect"] = "must-handle"): Fault => ({
  status,
  mode,
  expect,
});
// mangle:* faults model the misbehaving filter driver: the syscall really
// succeeds but its IO_STATUS_BLOCK.Information is perturbed (short / zero
// bytes). bun must honor the count it is handed, so these are must-handle.
// delay faults keep the real status but pause first (status field = ms):
// a deterministic interleaving shift at one coordinate - completion
// dequeue vs. other threads, a widened race window. A HANG from a delay is
// a real timing bug; classed 'judgment' since the human decides plausibility.
export const DELAY_MS = "250";
export const FAULTS: Record<string, Fault[]> = {
  NtCreateFile: [F("C0000034"), F("C0000022"), F("C0000043")],
  NtOpenFile: [F("C0000034"), F("C0000022")],
  NtReadFile: [F("C0000185"), F("C0000185", "post", "judgment"), F("0", "mangle:short"), F("0", "mangle:zero")],
  NtWriteFile: [
    F("C000007F"),
    F("C000007F", "post", "judgment"),
    F("0", "mangle:short"),
    F(DELAY_MS, "delay", "judgment"),
  ],
  NtQueryInformationFile: [F("C0000185")],
  NtSetInformationFile: [F("C0000022")],
  NtQueryDirectoryFile: [F("C0000185"), F("0", "mangle:short")],
  NtQueryDirectoryFileEx: [F("C0000185"), F("0", "mangle:short")],
  NtQueryVolumeInformationFile: [F("C0000185")],
  NtQueryAttributesFile: [F("C0000034")],
  NtQueryFullAttributesFile: [F("C0000034")],
  NtDeleteFile: [F("C0000022")],
  NtFsControlFile: [F("C000009A")],
  NtCreateNamedPipeFile: [F("C000009A")],
  NtDeviceIoControlFile: [
    F("C000009A"),
    F("C000009A", "post", "judgment"),
    F("0", "mangle:short"),
    F(DELAY_MS, "delay", "judgment"),
  ],
  NtCreateEvent: [F("C000009A")],
  NtCreateSection: [F("C000009A")],
  NtMapViewOfSection: [F("C000009A")],
  NtCreateThreadEx: [F("C000009A")],
  NtCreateUserProcess: [F("C0000022")],
  NtCreateJobObject: [F("C000009A")],
  NtAssignProcessToJobObject: [F("C0000022")],
  NtCreateIoCompletion: [F("C000009A")],
  NtRemoveIoCompletion: [F("C0000185", "post", "judgment")],
  // Delaying the IOCP dequeue reorders completions against other threads:
  // the completion-side lever (completion-after-close, cancel racing
  // completion).
  NtRemoveIoCompletionEx: [F("C0000185", "post", "judgment"), F(DELAY_MS, "delay", "judgment")],
  NtAssociateWaitCompletionPacket: [F("C000009A")],
  NtQueryValueKey: [F("C0000034")],
  NtOpenKeyEx: [F("C0000034")],
  // (NtClose post-fault removed: "close succeeded but reported failure" is a
  // near non-event for real code - top slow-generator, zero findings.)
  NtDuplicateObject: [F("C000009A")],
  NtAllocateVirtualMemory: [F("C0000017", "pre", "abort-expected")],
  NtAllocateVirtualMemoryEx: [F("C0000017", "pre", "abort-expected")],
};

