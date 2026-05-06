// Minimal WASI program that opens a file from a preopen using path_open
// and reads it, then writes the contents to another file.
//
// We declare the WASI imports by hand so we don't depend on a WASI sysroot.
//
// Compile:
//   clang --target=wasm32 -nostdlib -O2 -fno-builtin \
//     -Wl,--no-entry -Wl,--export=_start -Wl,--export=memory \
//     -Wl,--allow-undefined \
//     -o preopen-wasi.wasm preopen-wasi.c
//
// Regression fixture for oven-sh/bun#30302.

typedef unsigned int u32;
typedef unsigned long long u64;

__attribute__((import_module("wasi_snapshot_preview1"), import_name("path_open")))
unsigned int wasi_path_open(u32 dirfd, u32 dirflags, const char *path, u32 path_len,
                             u32 oflags, u64 fs_rights_base, u64 fs_rights_inheriting,
                             u32 fdflags, u32 *opened_fd);

__attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_read")))
unsigned int wasi_fd_read(u32 fd, const void *iovs, u32 iovs_len, u32 *nread);

__attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_write")))
unsigned int wasi_fd_write(u32 fd, const void *iovs, u32 iovs_len, u32 *nwritten);

__attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_close")))
unsigned int wasi_fd_close(u32 fd);

__attribute__((import_module("wasi_snapshot_preview1"), import_name("proc_exit")))
void wasi_proc_exit(u32 rval) __attribute__((noreturn));

struct ciovec {
    const void *buf;
    u32 buf_len;
};

// WASI rights for read/write files. Using the superset the Bun implementation
// grants to preopen directories keeps things simple.
#define RIGHTS_ALL ((u64)-1)

// O_CREAT | O_TRUNC in WASI oflags
#define WASI_O_CREAT (1 << 0)
#define WASI_O_TRUNC (1 << 3)

static char read_buf[256];
static char out_buf[256];

void _start() {
    // Preopen dirfd is always 3 (first after stdin/stdout/stderr).
    u32 dirfd = 3;

    // Read "input.txt" from the preopen.
    u32 in_fd = 0;
    unsigned int err = wasi_path_open(dirfd, 0, "input.txt", 9, 0,
                                       RIGHTS_ALL, RIGHTS_ALL, 0, &in_fd);
    if (err != 0) wasi_proc_exit(10 + err);

    struct ciovec read_iov = { read_buf, sizeof(read_buf) };
    u32 nread = 0;
    err = wasi_fd_read(in_fd, &read_iov, 1, &nread);
    if (err != 0) wasi_proc_exit(30 + err);
    wasi_fd_close(in_fd);

    // Write "output.txt" in the preopen with "got: " prefix + contents.
    u32 out_fd = 0;
    err = wasi_path_open(dirfd, 0, "output.txt", 10,
                          WASI_O_CREAT | WASI_O_TRUNC,
                          RIGHTS_ALL, RIGHTS_ALL, 0, &out_fd);
    if (err != 0) wasi_proc_exit(50 + err);

    // Build "got: <contents>" in out_buf.
    const char *prefix = "got: ";
    u32 plen = 5;
    for (u32 i = 0; i < plen; i++) out_buf[i] = prefix[i];
    for (u32 i = 0; i < nread && plen + i < sizeof(out_buf); i++) {
        out_buf[plen + i] = read_buf[i];
    }
    u32 total = plen + nread;

    struct ciovec write_iov = { out_buf, total };
    u32 nwritten = 0;
    err = wasi_fd_write(out_fd, &write_iov, 1, &nwritten);
    if (err != 0) wasi_proc_exit(70 + err);

    wasi_fd_close(out_fd);
    wasi_proc_exit(0);
}
