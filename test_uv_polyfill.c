/**
 * test_uv_polyfill.c — Standalone test for uv_poll/async/default_loop polyfills
 *
 * Compiles WITHOUT Bun — uses a minimal shim for the uv types/macros.
 * Tests epoll-based poll, eventfd-based async, and uv_close lifecycle.
 *
 * Build:
 *   gcc -o test_uv_polyfill test_uv_polyfill.c -lpthread -Wall -Wextra
 *
 * Run:
 *   ./test_uv_polyfill
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <unistd.h>
#include <pthread.h>

// ═══════════════════════════════════════════════════════════════════
// Minimal libuv type shim (replaces uv.h for standalone testing)
// ═══════════════════════════════════════════════════════════════════

// Skip Bun's root.h (which pulls in WTF/JSC infrastructure)
// and libuv's uv.h (we provide our own minimal types below)
#define BUN__ROOT__H
#define UV_H

typedef int uv_os_sock_t;
typedef int uv_pid_t;
typedef pthread_once_t uv_once_t;
typedef pthread_mutex_t uv_mutex_t;
#define UV_ONCE_INIT PTHREAD_ONCE_INIT

typedef enum {
    UV_UNKNOWN_HANDLE = 0,
    UV_ASYNC,
    UV_CHECK,
    UV_FS_EVENT,
    UV_FS_POLL,
    UV_HANDLE,
    UV_IDLE,
    UV_NAMED_PIPE,
    UV_POLL,
    UV_PREPARE,
    UV_PROCESS,
    UV_STREAM,
    UV_TCP,
    UV_TIMER,
    UV_TTY,
    UV_UDP,
    UV_SIGNAL,
    UV_FILE,
    UV_HANDLE_TYPE_MAX
} uv_handle_type;

// Event flags
enum uv_poll_event {
    UV_READABLE    = 1,
    UV_WRITABLE    = 2,
    UV_DISCONNECT  = 4,
    UV_PRIORITIZED = 8
};

// Error codes (subset)
#define UV_E2BIG         (-7)
#define UV_EACCES        (-13)
#define UV_EADDRINUSE    (-98)
#define UV_EADDRNOTAVAIL (-99)
#define UV_EAFNOSUPPORT  (-97)
#define UV_EAGAIN        (-11)
#define UV_EAI_ADDRFAMILY (-3000)
#define UV_EAI_AGAIN     (-3001)
#define UV_EAI_BADFLAGS  (-3002)
#define UV_EAI_BADHINTS  (-3013)
#define UV_EAI_CANCELED  (-3003)
#define UV_EAI_FAIL      (-3004)
#define UV_EAI_FAMILY    (-3005)
#define UV_EAI_MEMORY    (-3006)
#define UV_EAI_NODATA    (-3007)
#define UV_EAI_NONAME    (-3008)
#define UV_EAI_OVERFLOW  (-3009)
#define UV_EAI_PROTOCOL  (-3014)
#define UV_EAI_SERVICE   (-3010)
#define UV_EAI_SOCKTYPE  (-3011)
#define UV_EALREADY      (-114)
#define UV_EBADF         (-9)
#define UV_EBUSY         (-16)
#define UV_ECANCELED     (-125)
#define UV_ECHARSET      (-4080)
#define UV_ECONNABORTED  (-103)
#define UV_ECONNREFUSED  (-111)
#define UV_ECONNRESET    (-104)
#define UV_EDESTADDRREQ  (-89)
#define UV_EEXIST        (-17)
#define UV_EFAULT        (-14)
#define UV_EFBIG         (-27)
#define UV_EHOSTUNREACH  (-113)
#define UV_EINTR         (-4)
#define UV_EINVAL        (-22)
#define UV_EIO           (-5)
#define UV_EISCONN       (-106)
#define UV_EISDIR        (-21)
#define UV_ELOOP         (-40)
#define UV_EMFILE        (-24)
#define UV_EMSGSIZE      (-90)
#define UV_ENAMETOOLONG  (-36)
#define UV_ENETDOWN      (-100)
#define UV_ENETUNREACH   (-101)
#define UV_ENFILE        (-23)
#define UV_ENOBUFS       (-105)
#define UV_ENODEV        (-19)
#define UV_ENOENT        (-2)
#define UV_ENOMEM        (-12)
#define UV_ENONET        (-64)
#define UV_ENOPROTOOPT   (-92)
#define UV_ENOSPC        (-28)
#define UV_ENOSYS        (-38)
#define UV_ENOTCONN      (-107)
#define UV_ENOTDIR       (-20)
#define UV_ENOTEMPTY     (-39)
#define UV_ENOTSOCK      (-88)
#define UV_ENOTSUP       (-95)
#define UV_EPERM         (-1)
#define UV_EPIPE         (-32)
#define UV_EPROTO        (-71)
#define UV_EPROTONOSUPPORT (-93)
#define UV_EPROTOTYPE    (-91)
#define UV_ERANGE        (-34)
#define UV_EROFS         (-30)
#define UV_ESHUTDOWN     (-108)
#define UV_ESPIPE        (-29)
#define UV_ESRCH         (-3)
#define UV_ETIMEDOUT     (-110)
#define UV_ETXTBSY       (-26)
#define UV_EXDEV         (-18)
#define UV_UNKNOWN       (-4094)
#define UV_EOF           (-4095)
#define UV_ENXIO         (-6)
#define UV_EMLINK        (-31)

// Forward declarations
typedef struct uv_loop_s uv_loop_t;
typedef struct uv_handle_s uv_handle_t;
typedef struct uv_poll_s uv_poll_t;
typedef struct uv_async_s uv_async_t;

typedef void (*uv_close_cb)(uv_handle_t* handle);
typedef void (*uv_poll_cb)(uv_poll_t* handle, int status, int events);
typedef void (*uv_async_cb)(uv_async_t* handle);

struct uv_loop_s {
    void* data;
    unsigned int active_handles;
    // ... simplified
    char _padding[256];
};

struct uv_handle_s {
    void* data;
    uv_loop_t* loop;
    uv_handle_type type;
    uv_close_cb close_cb;
    char _padding[256];
};

struct uv_poll_s {
    void* data;
    uv_loop_t* loop;
    uv_handle_type type;
    uv_close_cb close_cb;
    char _padding[256];
};

struct uv_async_s {
    void* data;
    uv_loop_t* loop;
    uv_handle_type type;
    uv_close_cb close_cb;
    char _padding[256];
};

// Stub for CrashHandler — not used in polyfill implementations
void CrashHandler__unsupportedUVFunction(const char* name) {
    fprintf(stderr, "FATAL: unsupported uv function: %s\n", name);
    abort();
}

// ═══════════════════════════════════════════════════════════════════
// Include the actual polyfill implementation
// ═══════════════════════════════════════════════════════════════════

// Detect build host platform via compiler predefined macros
#define OS(x) (OS_##x)
#if defined(__linux__)
#define OS_LINUX 1
#define OS_DARWIN 0
#elif defined(__APPLE__) && defined(__MACH__)
#define OS_LINUX 0
#define OS_DARWIN 1
#else
#error "Unsupported platform: expected Linux or macOS"
#endif

// Include the polyfill directly
#include "src/bun.js/bindings/uv-posix-polyfills.c"

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

static int test_count = 0;
static int pass_count = 0;

#define TEST(name) do { \
    test_count++; \
    printf("  TEST: %-50s ", name); \
} while(0)

#define PASS() do { \
    pass_count++; \
    printf("PASS\n"); \
} while(0)

#define FAIL(msg) do { \
    printf("FAIL (%s)\n", msg); \
} while(0)

// ── Test: uv_default_loop ────────────────────────────────────

void test_default_loop(void) {
    printf("\n[uv_default_loop]\n");

    TEST("returns non-NULL");
    uv_loop_t* loop = uv_default_loop();
    if (loop != NULL) PASS(); else FAIL("returned NULL");

    TEST("returns same pointer (singleton)");
    uv_loop_t* loop2 = uv_default_loop();
    if (loop == loop2) PASS(); else FAIL("different pointers");
}

// ── Test: uv_strerror ────────────────────────────────────────

void test_strerror(void) {
    printf("\n[uv_strerror]\n");

    TEST("success returns 'success'");
    const char* s = uv_strerror(0);
    if (strcmp(s, "success") == 0) PASS(); else FAIL(s);

    TEST("UV_EINVAL returns 'invalid argument'");
    s = uv_strerror(UV_EINVAL);
    if (strcmp(s, "invalid argument") == 0) PASS(); else FAIL(s);

    TEST("UV_EBADF returns 'bad file descriptor'");
    s = uv_strerror(UV_EBADF);
    if (strcmp(s, "bad file descriptor") == 0) PASS(); else FAIL(s);

    TEST("unknown error returns 'unknown error'");
    s = uv_strerror(-99999);
    if (strcmp(s, "unknown error") == 0) PASS(); else FAIL(s);
}

// ── Test: uv_poll ────────────────────────────────────────────

static volatile int poll_callback_called = 0;
static volatile int poll_callback_events = 0;

void test_poll_cb(uv_poll_t* handle, int status, int events) {
    (void)handle;
    (void)status;
    poll_callback_called = 1;
    poll_callback_events = events;
}

static volatile int close_cb_called = 0;
void test_close_cb(uv_handle_t* handle) {
    (void)handle;
    close_cb_called = 1;
}

void test_poll(void) {
    printf("\n[uv_poll]\n");

    // Create a pipe for testing
    int pipefd[2];
    if (pipe(pipefd) < 0) {
        perror("pipe");
        return;
    }

    uv_loop_t* loop = uv_default_loop();
    uv_poll_t handle;

    TEST("uv_poll_init returns 0");
    int r = uv_poll_init(loop, &handle, pipefd[0]);
    if (r == 0) PASS(); else { FAIL("non-zero return"); close(pipefd[0]); close(pipefd[1]); return; }

    TEST("handle type is UV_POLL");
    if (handle.type == UV_POLL) PASS(); else FAIL("wrong type");

    TEST("uv_poll_start returns 0");
    poll_callback_called = 0;
    r = uv_poll_start(&handle, UV_READABLE, test_poll_cb);
    if (r == 0) PASS(); else { FAIL("non-zero return"); uv_close((uv_handle_t*)&handle, NULL); close(pipefd[0]); close(pipefd[1]); return; }

    TEST("callback fires on readable data");
    // Write to pipe to trigger readable event
    char c = 'X';
    write(pipefd[1], &c, 1);

    // Wait up to 500ms for callback
    for (int i = 0; i < 50 && !poll_callback_called; i++) {
        usleep(10000); // 10ms
    }
    if (poll_callback_called) PASS(); else FAIL("callback not called within 500ms");

    TEST("callback received UV_READABLE event");
    if (poll_callback_events & UV_READABLE) PASS(); else FAIL("no UV_READABLE");

    TEST("uv_poll_stop returns 0");
    r = uv_poll_stop(&handle);
    if (r == 0) PASS(); else FAIL("non-zero return");

    TEST("uv_close calls close_cb");
    close_cb_called = 0;
    uv_close((uv_handle_t*)&handle, test_close_cb);
    usleep(10000);
    if (close_cb_called) PASS(); else FAIL("close_cb not called");

    close(pipefd[0]);
    close(pipefd[1]);
}

// ── Test: uv_async ───────────────────────────────────────────

static volatile int async_callback_called = 0;

void test_async_cb(uv_async_t* handle) {
    (void)handle;
    async_callback_called = 1;
}

void* async_sender_thread(void* arg) {
    uv_async_t* async = (uv_async_t*)arg;
    usleep(50000); // 50ms delay
    uv_async_send(async);
    return NULL;
}

void test_async(void) {
    printf("\n[uv_async]\n");

    uv_loop_t* loop = uv_default_loop();
    uv_async_t handle;

    TEST("uv_async_init returns 0");
    int r = uv_async_init(loop, &handle, test_async_cb);
    if (r == 0) PASS(); else { FAIL("non-zero return"); return; }

    TEST("handle type is UV_ASYNC");
    if (handle.type == UV_ASYNC) PASS(); else FAIL("wrong type");

    TEST("callback fires on async_send from another thread");
    async_callback_called = 0;
    pthread_t tid;
    if (pthread_create(&tid, NULL, async_sender_thread, &handle) != 0) {
        FAIL("pthread_create failed");
        uv_close((uv_handle_t*)&handle, NULL);
        return;
    }

    // Wait up to 500ms for callback
    for (int i = 0; i < 50 && !async_callback_called; i++) {
        usleep(10000);
    }
    pthread_join(tid, NULL);
    if (async_callback_called) PASS(); else FAIL("callback not called within 500ms");

    TEST("uv_close async handle calls close_cb");
    close_cb_called = 0;
    uv_close((uv_handle_t*)&handle, test_close_cb);
    usleep(10000);
    if (close_cb_called) PASS(); else FAIL("close_cb not called");
}

// ── Main ─────────────────────────────────────────────────────

int main(void) {
    printf("═══════════════════════════════════════════════════\n");
    printf("  Bun libuv polyfill — standalone test suite\n");
    printf("═══════════════════════════════════════════════════\n");

    test_default_loop();
    test_strerror();
    test_poll();
    test_async();

    printf("\n═══════════════════════════════════════════════════\n");
    printf("  Results: %d/%d passed\n", pass_count, test_count);
    printf("═══════════════════════════════════════════════════\n");

    return (pass_count == test_count) ? 0 : 1;
}
