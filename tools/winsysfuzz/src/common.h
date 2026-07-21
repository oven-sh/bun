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
  Pre,  // skip the real syscall entirely, return injected status (genuine failure)
  Post, // run the real syscall, then report injected status (succeeded-but-told-failed)
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
  uint32_t sys_;
  bool live_;      // false => reentrant call: pass straight through, no log/fault
  uint8_t nframes_;
  ULONG_PTR injected_ = 0;
  Fault fault_ = Fault::None;
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
