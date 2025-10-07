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
