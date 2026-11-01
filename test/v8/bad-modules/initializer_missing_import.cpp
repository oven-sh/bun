#include <node.h>

#include <cstdio>

extern "C" void bun_test_symbol_that_nothing_defines();

extern "C" NODE_MODULE_EXPORT void
NODE_MODULE_INITIALIZER(v8::Local<v8::Object> exports,
                        v8::Local<v8::Value> module,
                        v8::Local<v8::Context> context) {
  // The loader must refuse this addon: the call below would end the process.
  puts("the initializer ran");
  fflush(stdout);
  bun_test_symbol_that_nothing_defines();
}
