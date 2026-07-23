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
export type Mode = "pre" | "post" | "mangle:short" | "mangle:zero" | "mangle:garbage" | "delay";
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
// The o:-key exclusion (no faults inside another module's own machinery)
// has one deliberate exception: ALPC calls are only ever issued from inside
// rpcrt4, and their failure models a genuinely reachable state - the RPC
// service (DNS client, console host) being unreachable - which bun sees as
// an API-level error. These specific syscalls may carry a 'pre' fault even
// at an o: key. Nothing else does.
export const ALPC_OK = new Set(["NtAlpcConnectPort", "NtAlpcSendWaitReceivePort"]);
export const FAULTS: Record<string, Fault[]> = {
  NtCreateFile: [F("C0000034"), F("C0000022"), F("C0000043")],
  NtOpenFile: [F("C0000034"), F("C0000022")],
  NtReadFile: [
    F("C0000185"),
    F("C0000185", "post", "judgment"),
    F("0", "mangle:short"),
    F("0", "mangle:zero"),
    // garbage: the read really succeeds, the bytes are corrupted (lying
    // driver / bad hardware) - the mode that reaches parsers and buffers.
    // Status field = corruption seed.
    F("A5", "mangle:garbage"),
    F("3C", "mangle:garbage"),
  ],
  NtWriteFile: [
    F("C000007F"),
    F("C000007F", "post", "judgment"),
    F("0", "mangle:short"),
    F(DELAY_MS, "delay", "judgment"),
  ],
  // C0000023 BUFFER_TOO_SMALL: the fixed struct didn't fit; a caller that
  // sizes a follow-up buffer from this answer produces logic bugs.
  NtQueryInformationFile: [F("C0000023"), F("C0000185")],
  NtSetInformationFile: [F("C0000022")],
  // 80000005 BUFFER_OVERFLOW: partial results, caller must re-query with a
  // bigger buffer / continue enumeration - the double-fetch sizing trap
  // that produces truncated or duplicated readdir entries when mishandled.
  NtQueryDirectoryFile: [F("80000005"), F("C0000185"), F("0", "mangle:short"), F("A5", "mangle:garbage")],
  NtQueryDirectoryFileEx: [F("80000005"), F("C0000185"), F("0", "mangle:short"), F("A5", "mangle:garbage")],
  NtQueryVolumeInformationFile: [F("C0000185")],
  NtQueryAttributesFile: [F("C0000034")],
  NtQueryFullAttributesFile: [F("C0000034")],
  NtDeleteFile: [F("C0000022")],
  NtFsControlFile: [F("C000009A")],
  NtCreateNamedPipeFile: [F("C000009A")],
  // Socket transfers are INDIRECT through WSABUF arrays inside the AFD
  // info struct; the runtime follows them (halves the first WSABUF.len on
  // AFD_SEND = genuine partial send; poisons the received bytes across the
  // WSABUFs on AFD_RECV = a hostile/broken peer's data). Info-struct
  // lengths are never touched - truncating those was a malformed call.
  NtDeviceIoControlFile: [
    F("C000009A"),
    F("C000009A", "post", "judgment"),
    F("0", "mangle:short"),   // partial send (first WSABUF halved pre-call)
    F("A5", "mangle:garbage"), // malformed peer data (received bytes poisoned)
    F(DELAY_MS, "delay", "judgment"),
  ],
  // Directory watchers (fs.watch -> ReadDirectoryChangesW). The field's
  // top actionable Windows crash is a use-after-free of the watcher context
  // (a change completion delivered after the watcher is gone), so this surface
  // gets the levers that open that window deterministically:
  //   DELETE_PENDING  - the watched directory is being deleted out from
  //                     under the watch (the classic rug-pull);
  //   delay           - stall the (re)arm / cancel / close so a pending
  //                     completion races the watcher's teardown.
  NtNotifyChangeDirectoryFile: [F("C0000056"), F("C000009A"), F(DELAY_MS, "delay", "judgment")],
  NtNotifyChangeDirectoryFileEx: [F("C0000056"), F("C000009A"), F(DELAY_MS, "delay", "judgment")],
  // "Nothing to cancel" (STATUS_NOT_FOUND) and a delayed cancel both perturb
  // watcher/socket teardown ordering.
  NtCancelIoFile: [F("C0000225"), F(DELAY_MS, "delay", "judgment")],
  NtCancelIoFileEx: [F("C0000225"), F(DELAY_MS, "delay", "judgment")],
  // A delayed close widens close-vs-completion races (watchers, sockets,
  // pipes); the removed post-close lie stays gone.
  NtClose: [F(DELAY_MS, "delay", "judgment")],
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
  // --- Windows-native surfaces beyond plain I/O ------------------------------
  // Registry: 80000005 BUFFER_OVERFLOW = value larger than the first-call
  // buffer (the size-then-fetch trap: truncated or mis-sized reads).
  NtQueryValueKey: [F("C0000034"), F("80000005"), F("C0000023")],
  NtQueryKey: [F("80000005")],
  NtEnumerateValueKey: [F("80000005"), F("8000001A")],
  NtOpenKeyEx: [F("C0000034"), F("C0000022")],
  // System / object information: C0000004 INFO_LENGTH_MISMATCH is the
  // canonical grow-the-buffer retry contract (uptime/loadavg/cpu-info,
  // handle enumeration) - mishandled it truncates or loops forever.
  NtQuerySystemInformation: [F("C0000004"), F("C0000001")],
  NtQuerySystemInformationEx: [F("C0000004")],
  NtQueryObject: [F("C0000004"), F("80000005")],
  NtQueryInformationProcess: [F("C0000004"), F("C0000022")],
  NtQueryInformationThread: [F("C0000004")],
  // Tokens: a restricted/filtered token is a real deployment (services,
  // AppContainer, low-integrity) - ACCESS_DENIED on token opens/queries.
  NtOpenProcessToken: [F("C0000022")],
  NtOpenThreadToken: [F("C0000022"), F("C000007C")],
  NtQueryInformationToken: [F("C0000023"), F("C0000022")],
  // NT objects mid-run: named events/sections/mutants can be gone or
  // access-controlled (another instance won the race, sandbox denies).
  NtOpenEvent: [F("C0000034"), F("C0000022")],
  NtOpenSection: [F("C0000034"), F("C0000022")],
  NtOpenSemaphore: [F("C0000034")],
  NtCreateMutant: [F("C0000035"), F("C0000022")],
  // ALPC: bun reaches the DNS/console services over RPC; the transport
  // failing = "service unreachable" (C0000037 PORT_DISCONNECTED). These are
  // issued from inside rpcrt4, so they ride the ALPC_OK allowlist below.
  NtAlpcConnectPort: [F("C0000037")],
  NtAlpcSendWaitReceivePort: [F("C0000037"), F(DELAY_MS, "delay", "judgment")],
  // (NtClose post-fault removed: "close succeeded but reported failure" is a
  // near non-event for real code - top slow-generator, zero findings.)
  NtDuplicateObject: [F("C000009A")],
  // Allocation-failure faults deliberately absent: crash-on-OOM is by design
  // and not a finding worth compute or triage. (NtAllocateVirtualMemory[Ex]
  // used to carry an abort-expected fault; removed.)
};

// --- UNIVERSAL FAULT SURFACE ------------------------------------------------
// The curated FAULTS menu is a WEIGHTING of preferred realistic
// (syscall, status) pairs - not the boundary of what can be faulted. A
// hand-picked menu left 480+ observed syscalls with zero probability of ever
// being perturbed. Every syscall NOT in the menu gets this generic realistic
// error set (weighted lower by the planners), except a short denylist of
// pure infrastructure where a fault only manufactures artifacts:
// waits/parks/futexes (deadlocks that are ours), scheduling internals, the
// loader continue, and memory management (OOM policy: not a finding).
export const GENERIC_FAULTS: Fault[] = [
  F("C0000022"), // ACCESS_DENIED
  F("C000009A"), // INSUFFICIENT_RESOURCES
  F("C0000185"), // IO_DEVICE_ERROR
  F("C0000008"), // INVALID_HANDLE
];
export const NEVER_FAULT = new Set([
  // waits / thread parking / futex primitives - faulting them fabricates
  // deadlocks and lost wakeups that no environment produces
  "NtWaitForSingleObject", "NtWaitForMultipleObjects", "NtWaitForAlertByThreadId",
  "NtAlertThreadByThreadId", "NtDelayExecution", "NtYieldExecution", "NtTestAlert",
  // signaling primitives - the WAKE half of wait/wake: failing SetEvent /
  // ReleaseSemaphore / etc. on a VALID handle fabricates a lost wakeup no
  // environment produces (they fail only on bad handles) - a guaranteed
  // fake hang, exactly like faulting the wait itself
  "NtSetEvent", "NtResetEvent", "NtPulseEvent", "NtClearEvent", "NtReleaseSemaphore",
  "NtReleaseMutant", "NtSetTimer", "NtSetTimerEx", "NtCancelTimer", "NtSetIoCompletion",
  // thread resume/suspend: failing ResumeThread on a valid handle is the
  // same fabrication - the child's main thread never wakes, a fake stall
  "NtResumeThread", "NtSuspendThread", "NtAlertResumeThread", "NtSuspendProcess", "NtResumeProcess",
  "NtWaitForWorkViaWorkerFactory", "NtReleaseWorkerFactoryWorker", "NtSignalAndWaitForSingleObject",
  // control-flow / loader / callbacks
  "NtContinue", "NtCallbackReturn", "NtRaiseException", "NtRaiseHardError",
  // memory management (crash-on-OOM is by design; not a finding)
  "NtAllocateVirtualMemory", "NtAllocateVirtualMemoryEx", "NtFreeVirtualMemory",
  "NtProtectVirtualMemory", "NtQueryVirtualMemory", "NtLockVirtualMemory", "NtUnlockVirtualMemory",
  "NtFlushInstructionCache", "NtFlushVirtualMemory", "NtMapUserPhysicalPages",
  // process/thread teardown and pure timekeeping/introspection
  "NtTerminateProcess", "NtTerminateThread", "NtQueryPerformanceCounter",
  "NtQuerySystemTime", "NtQueryTimerResolution", "NtGetCurrentProcessorNumber",
  // scheduler / thread-attribute internals
  "NtSetInformationThread", "NtSetInformationWorkerFactory", "NtCreateWorkerFactory",
  "NtSetTimerResolution",
]);
// The fault menu for ANY syscall: curated entries where we have them,
// otherwise the generic set - never empty for a faultable call.
export function faultsFor(sysName: string): Fault[] | null {
  if (NEVER_FAULT.has(sysName)) return null;
  return FAULTS[sysName] ?? GENERIC_FAULTS;
}
// Curated entries are the preferred draws; generic ones are the fallback.
export const isCurated = (sysName: string) => sysName in FAULTS;
