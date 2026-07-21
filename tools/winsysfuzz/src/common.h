// Shared declarations for the winsysfuzz interceptor DLL.
#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>
#include <intrin.h>
#include <stdint.h>

#pragma intrinsic(_ReturnAddress)

namespace wsf {

// Frames of caller context captured per syscall. Frame 0 is the immediate
// caller (often kernelbase); we walk up to find the first frame inside
// bun.exe, which is the attribution key that survives wrapper layers.
constexpr int kMaxFrames = 8;

enum class Fault : uint8_t {
  None,
  Pre,    // skip the real syscall entirely, return injected status (genuine failure)
  Post,   // run the real syscall, then report injected status (succeeded-but-told-failed)
  Mangle, // run the real syscall, keep its status, perturb its OUTPUT
          // (the misbehaving filter-driver class: malformed successes)
};

// Mangle kinds — all target the IO_STATUS_BLOCK a synchronous I/O
// syscall filled in on success. Real filter drivers do exactly these.
enum class MangleKind : uint8_t {
  Short, // Information (bytes transferred) reported smaller than actual
  Zero,  // "successful" zero-byte transfer where data was expected
};

// Per-syscall-invocation context. Constructed at hook entry; drives the
// fault decision and writes the trace record at exit.
class CallCtx {
 public:
  CallCtx(uint32_t sysId, uintptr_t retAddr, const ULONG_PTR* args, int argc);
  // Balances the reentrancy depth on every exit path, including the
  // pre-fault early return that never reaches Exit().
  ~CallCtx();
  // Consult the schedule; on a pre-fault, logs the injection and arms Ret().
  bool PreFault();
  ULONG_PTR Ret() const { return injected_; }
  // Log the exit. On a post-fault, substitutes the injected status.
  ULONG_PTR Exit(ULONG_PTR real);

 private:
  // Formats up to 3 candidate bun.exe callsite RVAs as "a,b,c" ("0" if none).
  // The first is the schedule's key; the rest let the analyzer walk past an
  // inlined std:: frame to the owning module.
  void FormatRvas(char* out, size_t cap) const;
  // WSF_ARGS=1: emit an 'A' record with the decoded NT path (path-bearing
  // syscalls only), sharing seq with the X record it belongs to.
  void LogArgs(LONG64 seq) const;
  uint32_t sys_;
  bool live_;      // false => reentrant call: pass straight through, no log/fault
  uint8_t nframes_;
  ULONG_PTR injected_ = 0;
  Fault fault_ = Fault::None;
  MangleKind mangle_ = MangleKind::Short;
  const ULONG_PTR* args_;
  int argc_;
  uintptr_t frames_[kMaxFrames];
  uintptr_t bunFrame_ = 0; // first frame within bun.exe's image, else 0
};

// Append a formatted header/note line to the trace log ('#' lines by convention).
void LogNote(const char* fmt, ...);

// Entry-only 'E' record for syscalls that never return (see codegen noReturn).
void LogEntryOnly(uint32_t sysId, uintptr_t retAddr);

// Runtime setup/teardown, called from DllMain.
bool RuntimeInit();
void RuntimeShutdown();
// Arms/disarms hooks; flipped only after AttachHooks commits.
void SetReady(bool r);
// Attach/detach every hook whose export resolved.
bool AttachHooks();
void DetachHooks();

} // namespace wsf
