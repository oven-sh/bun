#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

// Return a string pointer in the first 2 GiB of address space.
// Linux only.
char *addr32(void) {
  size_t pagesize = getpagesize();
  char *attempt = (char *)(1 << 20);
  void *mapping = MAP_FAILED;
  // try a few times without clobbering any existing mapping
  for (int i = 0; i < 400 && mapping == MAP_FAILED;
       i++, attempt += 64 * pagesize) {
    mapping = mmap((void *)attempt, pagesize, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED_NOREPLACE, -1, 0);
  }
  if (mapping == MAP_FAILED) {
    return NULL;
  } else {
    const char *string = "hello world";
    memcpy(mapping, string, strlen(string));
    return mapping;
  }
}

// Write an out-parameter containing a pointer into the low 2 GiB (same mmap
// strategy as addr32). The caller reads it back with ffiRead.ptr and then
// passes that JS number back in as a `ptr` FFI arg, exercising the
// Int32-encoded JSValue path in JSVALUE_TO_PTR. The magic at the target
// address is `0xDEADBEEF`.
int addr32_out(void **out) {
  size_t pagesize = getpagesize();
  char *attempt = (char *)(1 << 20);
  void *mapping = MAP_FAILED;
  for (int i = 0; i < 400 && mapping == MAP_FAILED;
       i++, attempt += 64 * pagesize) {
    mapping = mmap((void *)attempt, pagesize, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED_NOREPLACE, -1, 0);
  }
  if (mapping == MAP_FAILED) {
    *out = 0;
    return -1;
  }
  *((unsigned int *)mapping) = 0xDEADBEEFu;
  *out = mapping;
  return 0;
}

// Read the u32 at `handle`. Returns 0xDEADBEEF when the caller passed the
// correct pointer; returns something else (or crashes) when marshaling
// corrupts the JS-number-to-void* conversion.
unsigned int addr32_read(void *handle) {
  if (!handle) return 0;
  return *((unsigned int *)handle);
}
