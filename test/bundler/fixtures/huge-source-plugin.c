// A native bundler plugin whose `onBeforeParse` callbacks give the bundler a source of
// about 4 GiB. The source is an anonymous mapping: a page that nothing writes reads as
// zeros and takes no memory, so only the two pages with the markers are committed.
#include <bundler_plugin.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>

const char *BUN_PLUGIN_NAME = "huge_source";

#define FOUR_GIB ((size_t)1 << 32)
#define HEAD "HEADHEADHEADHEADHEADHEADHEADHEAD"
#define TAIL "TAIL"

static void serve(OnBeforeParseResult *result, size_t len, void (*release)(void *)) {
  int flags = MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE;
  uint8_t *source = mmap(NULL, len, PROT_READ | PROT_WRITE, flags, -1, 0);
  if (source == MAP_FAILED) {
    perror("huge_source: mmap");
    return;
  }
  if (len > FOUR_GIB) {
    memcpy(source, HEAD, strlen(HEAD));
    memcpy(source + len - strlen(TAIL), TAIL, strlen(TAIL));
  }
  result->source_ptr = source;
  result->source_len = len;
  result->plugin_source_code_context = source;
  result->free_plugin_source_code_context = release;
}

static void release_four_gib_less_one(void *source) { munmap(source, FOUR_GIB - 1); }
static void release_four_gib(void *source) { munmap(source, FOUR_GIB); }
static void release_four_gib_and_markers(void *source) { munmap(source, FOUR_GIB + strlen(HEAD)); }

// 2^32 - 1 zero bytes: the longest source whose length is a `u32`.
void four_gib_less_one(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  (void)args;
  serve(result, FOUR_GIB - 1, release_four_gib_less_one);
}

// 2^32 zero bytes: as a `u32` the length is 0.
void four_gib(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  (void)args;
  serve(result, FOUR_GIB, release_four_gib);
}

// 2^32 + 32 bytes, HEAD first and TAIL last: as a `u32` the length is 32, which is HEAD alone.
void four_gib_and_markers(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  (void)args;
  serve(result, FOUR_GIB + strlen(HEAD), release_four_gib_and_markers);
}

// `process.dlopen` loads a NAPI module.
void *napi_register_module_v1(void *env, void *exports) {
  (void)env;
  return exports;
}
