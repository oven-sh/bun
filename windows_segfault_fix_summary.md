# Windows Segfault Fix Summary

## Root Cause
During Windows process shutdown, `event_loop_handle` becomes null because it's lazily initialized and may never have been set. When destructors run during exit, they try to access `platformEventLoop()` which attempts to unwrap null with `.?`, causing a segfault.

## Fix Applied
Added null checks before accessing `event_loop_handle` in all locations where it could be null during shutdown.

### Files Modified
1. **src/async/windows_event_loop.zig**
   - Fixed 7 functions that were using `.?` or calling `platformEventLoop()` without null checks
   - Added safety checks to handle the case when `event_loop_handle` is null during shutdown

### Functions Fixed

1. **FilePoll.onEnded** (line 281-295)
   - Added null check before calling `deactivate`
   - Only calls deactivate if event_loop_handle exists

2. **FilePoll.unref** (line 298-313)  
   - Added null check before calling `deactivate`
   - Safely handles null event_loop_handle during shutdown

3. **FilePoll.ref** (line 345-359)
   - Added null check before calling `activate`
   - Fixed incorrect logic (`if (this.canRef())` → `if (!this.canRef())`)

4. **FilePoll.disableKeepingProcessAlive** (line 153-167)
   - Added null check before calling `subActive`

5. **FilePoll.enableKeepingProcessAlive** (line 263-277)
   - Added null check before calling `addActive`

6. **FilePoll.deinitWithVM** (line 258-262)
   - Wrapped entire function body in null check

7. **KeepAlive.unref** (line 52-73)
   - Added null check before calling `subActive`

8. **KeepAlive.ref** (line 100-119)
   - Added null check before calling `ref`

9. **KeepAlive.unrefOnNextTick** (line 83-89)
   - Changed `.?` to safe null check pattern

10. **KeepAlive.unrefOnNextTickConcurrently** (line 91-99)
    - Changed `.?` to safe null check pattern

## Pattern Used
```zig
// Before (crashes on null):
vm.event_loop_handle.?.someMethod();
vm.platformEventLoop().someMethod();

// After (safe):
if (vm.event_loop_handle) |handle| {
    handle.someMethod();
}

// For AbstractVM types:
if (comptime @TypeOf(vm) == JSC.JsVM) {
    if (vm.vm.event_loop_handle) |handle| {
        handle.someMethod();
    }
} else {
    vm.platformEventLoop().someMethod();
}
```

## Testing
The fix prevents the segfault by gracefully handling the null case during shutdown. Since the process is exiting anyway, skipping these cleanup operations when event_loop_handle is null is safe and correct.