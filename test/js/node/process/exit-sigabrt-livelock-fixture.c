// Helper for process-exit-signal-handler-livelock.test.ts. Registers an
// atexit/at_quick_exit callback that repeatedly raises SIGABRT, emulating
// what macOS __abort does when its handler keeps returning. If bun's
// process.on('SIGABRT') handler (forwardSignal) is still installed at this
// point, each raise() is swallowed (queued for a JS loop that will never run
// again) and we spin here forever. Once bun resets the handler to SIG_DFL
// before exit(), the first raise() terminates the process with SIGABRT.
#include <signal.h>
#include <stdlib.h>

static void raise_abort_loop(void) {
    for (;;) {
        raise(SIGABRT);
    }
}

void setup_exit_abort(void) {
    // Bun calls exit() on macOS and ASAN-enabled Linux, quick_exit()
    // elsewhere — register with whichever is available so the callback
    // always fires regardless of build configuration.
    atexit(raise_abort_loop);
#if !defined(__APPLE__)
    at_quick_exit(raise_abort_loop);
#endif
}
