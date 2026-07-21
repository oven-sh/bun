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
  Delay,  // run the real syscall and return its status, but sleep first:
          // a deterministic timing shift at one coordinate (races,
          // completion reordering against other threads)
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
  CallCtx(uint32_t sysId, uintptr_t retAddr, ULONG_PTR* args, int argc);
  // Balances the reentrancy depth on every exit path, including the
  // pre-fault early return that never reaches Exit().
  ~CallCtx();
  // Consult the schedule; on a pre-fault, logs the injection and arms Ret().
  bool PreFault();
  ULONG_PTR Ret() const { return injected_; }
  // Log the exit. On a post-fault, substitutes the injected status.
  ULONG_PTR Exit(ULONG_PTR real);

 private:
  // Formats up to 4 candidate bun.exe callsite RVAs as "a,b,c" ("0" if none) -
  // attribution/display only, never the coordinate identity.
  void FormatRvas(char* out, size_t cap) const;
  // Formats the coordinate key "<tag>:<hexrva>" from a return address:
  // the stable identity the schedule matches on.
  static void Key(char* out, size_t cap, uintptr_t retAddr);
  // Handle-table maintenance (always) plus WSF_ARGS=1 detail records:
  // A (decoded NT path) and D (handle target, AFD ioctl, lengths).
  void LogDetail(LONG64 seq, ULONG_PTR ret) const;
  uint32_t sys_;
  bool live_;      // false => reentrant call: pass straight through, no log/fault
  uint8_t nframes_;
  ULONG_PTR injected_ = 0;
  Fault fault_ = Fault::None;
  MangleKind mangle_ = MangleKind::Short;
  ULONG_PTR* args_; // mutable: pre-call arg mutation (mangle:short shrinks Length)
  int argc_;
  bool shrunk_ = false; // mangle:short realized by shrinking the requested Length
  uintptr_t frames_[kMaxFrames];
  uintptr_t bunFrame_ = 0; // first frame within bun.exe's image, else 0
};

// Append a formatted header/note line to the trace log ('#' lines by convention).
void LogNote(const char* fmt, ...);

// Guard for non-syscall-hook code that makes syscalls of its own (e.g. the
// child-injection housekeeping): raises the reentrancy depth so those calls
// pass through untraced and can never re-enter the logger or match a fault.
void DepthPush();
void DepthPop();

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
