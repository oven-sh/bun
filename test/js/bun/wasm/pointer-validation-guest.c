// Source of pointer-validation-guest.wasm, used by wasi.test.js. Freestanding (no
// wasi-libc), so the guest only does what the test needs: read argv and environ the
// way a libc start-up would, then hand the host pointers that do not fit in linear
// memory and report the errnos it gets back, all through a single fd_write.
//
//   clang --target=wasm32 -Oz -nostdlib -Wl,--strip-all -Wl,-z,stack-size=4096 \
//     -o pointer-validation-guest.wasm pointer-validation-guest.c

typedef unsigned int u32;
typedef unsigned long long u64;

#define HOSTCALL(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name))) u32 name

HOSTCALL(args_sizes_get)(u32 *argc, u32 *argv_buf_size);
HOSTCALL(args_get)(u32 *argv, char *argv_buf);
HOSTCALL(environ_sizes_get)(u32 *environ_count, u32 *environ_buf_size);
HOSTCALL(environ_get)(u32 *environ, char *environ_buf);
HOSTCALL(clock_time_get)(u32 clock_id, u64 precision, u64 *time);
HOSTCALL(fd_fdstat_get)(u32 fd, void *fdstat);
HOSTCALL(random_get)(void *buf, u32 buf_len);
HOSTCALL(fd_write)(u32 fd, const void *iovs, u32 iovs_len, u32 *nwritten);

static char out[512];
static u32 out_len;

static void put(const char *s) {
  while (*s && out_len < sizeof(out)) out[out_len++] = *s++;
}

static void put_u32(u32 value) {
  char digits[10];
  u32 n = 0;
  do {
    digits[n++] = '0' + value % 10;
    value /= 10;
  } while (value);
  while (n) {
    char digit[2] = {digits[--n], 0};
    put(digit);
  }
}

static void put_string_table(u32 (*sizes)(u32 *, u32 *), u32 (*get)(u32 *, char *)) {
  static u32 table[16];
  static char buf[1024];
  u32 count, buf_size;
  u32 err = sizes(&count, &buf_size);
  if (err == 0 && count <= sizeof(table) / sizeof(table[0]) && buf_size <= sizeof(buf)) err = get(table, buf);
  if (err != 0) {
    put(" errno ");
    put_u32(err);
    return;
  }
  for (u32 i = 0; i < count; i++) {
    put(" ");
    put((const char *)table[i]);
  }
}

void _start(void) {
  put("args:");
  put_string_table(args_sizes_get, args_get);
  put("\nenviron:");
  put_string_table(environ_sizes_get, environ_get);

  // The address just past the last byte of linear memory, and an address in the top
  // half of the 32-bit address space, which reaches a JS host as a negative i32.
  char *end = (char *)(__builtin_wasm_memory_size(0) * 65536u);
  char *high = (char *)0xfffffff0u;
  u32 scratch;
  u32 errnos[] = {
      fd_fdstat_get(1, end),
      fd_fdstat_get(1, high),
      args_sizes_get((u32 *)end, &scratch),
      environ_sizes_get((u32 *)high, &scratch),
      clock_time_get(1, 0, (u64 *)end),
      random_get(high, 4),
      random_get(end - 2, 4),
  };
  put("\nerrnos:");
  for (u32 i = 0; i < sizeof(errnos) / sizeof(errnos[0]); i++) {
    put(" ");
    put_u32(errnos[i]);
  }
  put("\n");

  struct {
    const char *buf;
    u32 len;
  } iov = {out, out_len};
  u32 written;
  fd_write(1, &iov, 1, &written);
}
