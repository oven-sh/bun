/*
  Dummy plugin which counts the occurences of the word "foo" in the source code,
  replacing it with "boo".

  It stores the number of occurences in the External struct.
*/
#include <atomic>
#include <bun-native-bundler-plugin-api/bundler_plugin.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <node_api.h>

#ifdef _WIN32
#define BUN_PLUGIN_EXPORT __declspec(dllexport)
#else
#define BUN_PLUGIN_EXPORT
#include <signal.h>
#include <unistd.h>
#endif

extern "C" BUN_PLUGIN_EXPORT const char *BUN_PLUGIN_NAME = "native_plugin_test";

struct External {
  std::atomic<size_t> foo_count;
  std::atomic<size_t> bar_count;
  std::atomic<size_t> baz_count;

  // For testing logging error logic
  std::atomic<bool> throws_an_error;
  // For testing crash reporting
  std::atomic<bool> simulate_crash;

  std::atomic<size_t> compilation_ctx_freed_count;
};

struct CompilationCtx {
  const char *source_ptr;
  size_t source_len;
  std::atomic<size_t> *free_counter;
};

CompilationCtx *compilation_ctx_new(const char *source_ptr, size_t source_len,
                                    std::atomic<size_t> *free_counter) {
  CompilationCtx *ctx = new CompilationCtx;
  ctx->source_ptr = source_ptr;
  ctx->source_len = source_len;
  ctx->free_counter = free_counter;
  return ctx;
}

void compilation_ctx_free(CompilationCtx *ctx) {
  printf("Freed compilation ctx!\n");
  if (ctx->free_counter != nullptr) {
    ctx->free_counter->fetch_add(1);
  }
  free((void *)ctx->source_ptr);
  delete ctx;
}

void log_error(const OnBeforeParseArguments *args,
               const OnBeforeParseResult *result, BunLogLevel level,
               const char *message, size_t message_len) {
  BunLogOptions options;
  options.message_ptr = (uint8_t *)message;
  options.message_len = message_len;
  options.path_ptr = args->path_ptr;
  options.path_len = args->path_len;
  options.source_line_text_ptr = nullptr;
  options.source_line_text_len = 0;
  options.level = (int8_t)level;
  options.line = 0;
  options.lineEnd = 0;
  options.column = 0;
  options.columnEnd = 0;
  (result->log)(args, &options);
}

extern "C" BUN_PLUGIN_EXPORT void
plugin_impl_with_needle(const OnBeforeParseArguments *args,
                        OnBeforeParseResult *result, const char *needle) {
  // if (args->__struct_size < sizeof(OnBeforeParseArguments)) {
  //     log_error(args, result, BUN_LOG_LEVEL_ERROR, "Invalid
  //     OnBeforeParseArguments struct size", sizeof("Invalid
  //     OnBeforeParseArguments struct size") - 1); return;
  // }

  if (args->external) {
    External *external = (External *)args->external;
    if (external->throws_an_error.load()) {
      log_error(args, result, BUN_LOG_LEVEL_ERROR, "Throwing an error",
                sizeof("Throwing an error") - 1);
      return;
    } else if (external->simulate_crash.load()) {
#ifndef _WIN32
      raise(SIGSEGV);
#endif
    }
  }

  int fetch_result = result->fetchSourceCode(args, result);
  if (fetch_result != 0) {
    printf("FUCK\n");
    exit(1);
  }

  size_t needle_len = strlen(needle);

  int needle_count = 0;

  const char *end = (const char *)result->source_ptr + result->source_len;

  char *cursor = (char *)strstr((const char *)result->source_ptr, needle);
  while (cursor != nullptr) {
    needle_count++;
    cursor += needle_len;
    if (cursor + needle_len < end) {
      cursor = (char *)strstr((const char *)cursor, needle);
    } else
      break;
  }

  if (needle_count > 0) {
    char *new_source = (char *)malloc(result->source_len);
    if (new_source == nullptr) {
      printf("FUCK\n");
      exit(1);
    }
    memcpy(new_source, result->source_ptr, result->source_len);
    cursor = strstr(new_source, needle);
    while (cursor != nullptr) {
      cursor[0] = 'q';
      cursor += 3;
      if (cursor + 3 < end) {
        cursor = (char *)strstr((const char *)cursor, needle);
      } else
        break;
    }
    std::atomic<size_t> *free_counter = nullptr;
    if (args->external) {
      External *external = (External *)args->external;
      std::atomic<size_t> *needle_atomic_value = nullptr;
      if (strcmp(needle, "foo") == 0) {
        needle_atomic_value = &external->foo_count;
      } else if (strcmp(needle, "bar") == 0) {
        needle_atomic_value = &external->bar_count;
      } else if (strcmp(needle, "baz") == 0) {
        needle_atomic_value = &external->baz_count;
      }
      printf("FUCK: %d %s\n", needle_count, needle);
      needle_atomic_value->fetch_add(needle_count);
      free_counter = &external->compilation_ctx_freed_count;
    }
    result->source_ptr = (uint8_t *)new_source;
    result->source_len = result->source_len;
    result->plugin_source_code_context =
        compilation_ctx_new(new_source, result->source_len, free_counter);
    result->free_plugin_source_code_context =
        (void (*)(void *))compilation_ctx_free;
  } else {
    result->source_ptr = nullptr;
    result->source_len = 0;
    result->loader = 0;
  }
}

extern "C" BUN_PLUGIN_EXPORT void
plugin_impl(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  plugin_impl_with_needle(args, result, "foo");
}

extern "C" BUN_PLUGIN_EXPORT void
plugin_impl_bar(const OnBeforeParseArguments *args,
                OnBeforeParseResult *result) {
  plugin_impl_with_needle(args, result, "bar");
}

extern "C" BUN_PLUGIN_EXPORT void
plugin_impl_baz(const OnBeforeParseArguments *args,
                OnBeforeParseResult *result) {
  plugin_impl_with_needle(args, result, "baz");
}

extern "C" void finalizer(napi_env env, void *data, void *hint) {
  External *external = (External *)data;
  if (external != nullptr) {
    delete external;
  }
}

napi_value create_external(napi_env env, napi_callback_info info) {
  napi_status status;

  // Allocate the External struct
  External *external = new External();
  if (external == nullptr) {
    napi_throw_error(env, nullptr, "Failed to allocate memory");
    return nullptr;
  }

  external->foo_count = 0;
  external->compilation_ctx_freed_count = 0;

  // Create the external wrapper
  napi_value result;
  status = napi_create_external(env, external, finalizer, nullptr, &result);
  if (status != napi_ok) {
    delete external;
    napi_throw_error(env, nullptr, "Failed to create external");
    return nullptr;
  }

  return result;
}

napi_value set_will_crash(napi_env env, napi_callback_info info) {
  napi_status status;
  External *external;

  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to parse arguments");
    return nullptr;
  }

  if (argc < 1) {
    napi_throw_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  status = napi_get_value_external(env, args[0], (void **)&external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get external");
    return nullptr;
  }

  bool throws;
  status = napi_get_value_bool(env, args[0], &throws);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get boolean value");
    return nullptr;
  }

  external->simulate_crash.store(throws);

  return nullptr;
}

napi_value set_throws_errors(napi_env env, napi_callback_info info) {
  napi_status status;
  External *external;

  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to parse arguments");
    return nullptr;
  }

  if (argc < 1) {
    napi_throw_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  status = napi_get_value_external(env, args[0], (void **)&external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get external");
    return nullptr;
  }

  bool throws;
  status = napi_get_value_bool(env, args[0], &throws);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get boolean value");
    return nullptr;
  }

  external->throws_an_error.store(throws);

  return nullptr;
}

napi_value get_compilation_ctx_freed_count(napi_env env,
                                           napi_callback_info info) {
  napi_status status;
  External *external;

  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to parse arguments");
    return nullptr;
  }

  if (argc < 1) {
    napi_throw_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  status = napi_get_value_external(env, args[0], (void **)&external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get external");
    return nullptr;
  }

  napi_value result;
  status = napi_create_int32(env, external->compilation_ctx_freed_count.load(),
                             &result);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create array");
    return nullptr;
  }

  return result;
}

napi_value get_foo_count(napi_env env, napi_callback_info info) {
  napi_status status;
  External *external;

  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to parse arguments");
    return nullptr;
  }

  if (argc < 1) {
    napi_throw_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  status = napi_get_value_external(env, args[0], (void **)&external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get external");
    return nullptr;
  }

  size_t foo_count = external->foo_count.load();
  if (foo_count > INT32_MAX) {
    napi_throw_error(env, nullptr,
                     "Too many foos! This probably means undefined memory or "
                     "heap corruption.");
    return nullptr;
  }

  napi_value result;
  status = napi_create_int32(env, foo_count, &result);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create array");
    return nullptr;
  }

  return result;
}

napi_value get_bar_count(napi_env env, napi_callback_info info) {
  napi_status status;
  External *external;

  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to parse arguments");
    return nullptr;
  }

  if (argc < 1) {
    napi_throw_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  status = napi_get_value_external(env, args[0], (void **)&external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get external");
    return nullptr;
  }

  size_t bar_count = external->bar_count.load();
  if (bar_count > INT32_MAX) {
    napi_throw_error(env, nullptr,
                     "Too many bars! This probably means undefined memory or "
                     "heap corruption.");
    return nullptr;
  }

  napi_value result;
  status = napi_create_int32(env, bar_count, &result);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create array");
    return nullptr;
  }

  return result;
}

napi_value get_baz_count(napi_env env, napi_callback_info info) {
  napi_status status;
  External *external;

  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to parse arguments");
    return nullptr;
  }

  if (argc < 1) {
    napi_throw_error(env, nullptr, "Wrong number of arguments");
    return nullptr;
  }

  status = napi_get_value_external(env, args[0], (void **)&external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to get external");
    return nullptr;
  }

  size_t baz_count = external->baz_count.load();
  if (baz_count > INT32_MAX) {
    napi_throw_error(env, nullptr,
                     "Too many bazs! This probably means undefined memory or "
                     "heap corruption.");
    return nullptr;
  }

  napi_value result;
  status = napi_create_int32(env, baz_count, &result);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create array");
    return nullptr;
  }

  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_status status;
  napi_value fn_get_foo_count;
  napi_value fn_get_bar_count;
  napi_value fn_get_baz_count;

  napi_value fn_get_compilation_ctx_freed_count;
  napi_value fn_create_external;
  napi_value fn_set_throws_errors;
  napi_value fn_set_will_crash;

  // Register get_foo_count function
  status = napi_create_function(env, nullptr, 0, get_foo_count, nullptr,
                                &fn_get_foo_count);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create get_names function");
    return nullptr;
  }
  status =
      napi_set_named_property(env, exports, "getFooCount", fn_get_foo_count);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr,
                     "Failed to add get_names function to exports");
    return nullptr;
  }

  // Register get_bar_count function
  status = napi_create_function(env, nullptr, 0, get_bar_count, nullptr,
                                &fn_get_bar_count);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create get_names function");
    return nullptr;
  }
  status =
      napi_set_named_property(env, exports, "getBarCount", fn_get_bar_count);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr,
                     "Failed to add get_names function to exports");
    return nullptr;
  }

  // Register get_baz_count function
  status = napi_create_function(env, nullptr, 0, get_baz_count, nullptr,
                                &fn_get_baz_count);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create get_names function");
    return nullptr;
  }
  status =
      napi_set_named_property(env, exports, "getBazCount", fn_get_baz_count);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr,
                     "Failed to add get_names function to exports");
    return nullptr;
  }

  // Register get_compilation_ctx_freed_count function
  status =
      napi_create_function(env, nullptr, 0, get_compilation_ctx_freed_count,
                           nullptr, &fn_get_compilation_ctx_freed_count);
  if (status != napi_ok) {
    napi_throw_error(
        env, nullptr,
        "Failed to create get_compilation_ctx_freed_count function");
    return nullptr;
  }
  status = napi_set_named_property(env, exports, "getCompilationCtxFreedCount",
                                   fn_get_compilation_ctx_freed_count);
  if (status != napi_ok) {
    napi_throw_error(
        env, nullptr,
        "Failed to add get_compilation_ctx_freed_count function to exports");
    return nullptr;
  }

  // Register set_throws_errors function
  status = napi_create_function(env, nullptr, 0, set_throws_errors, nullptr,
                                &fn_set_throws_errors);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr,
                     "Failed to create set_throws_errors function");
    return nullptr;
  }
  status = napi_set_named_property(env, exports, "setThrowsErrors",
                                   fn_set_throws_errors);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr,
                     "Failed to add set_throws_errors function to exports");
    return nullptr;
  }

  // Register set_will_crash function
  status = napi_create_function(env, nullptr, 0, set_will_crash, nullptr,
                                &fn_set_will_crash);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create set_will_crash function");
    return nullptr;
  }
  status =
      napi_set_named_property(env, exports, "setWillCrash", fn_set_will_crash);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr,
                     "Failed to add set_will_crash function to exports");
    return nullptr;
  }

  // Register create_external function
  status = napi_create_function(env, nullptr, 0, create_external, nullptr,
                                &fn_create_external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "Failed to create create_external function");
    return nullptr;
  }
  status = napi_set_named_property(env, exports, "createExternal",
                                   fn_create_external);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr,
                     "Failed to add create_external function to exports");
    return nullptr;
  }

  return exports;
}

struct NewOnBeforeParseArguments {
  size_t __struct_size;
  void *bun;
  const uint8_t *path_ptr;
  size_t path_len;
  const uint8_t *namespace_ptr;
  size_t namespace_len;
  uint8_t default_loader;
  void *external;
  size_t new_field_one;
  size_t new_field_two;
  size_t new_field_three;
};

struct NewOnBeforeParseResult {
  size_t __struct_size;
  uint8_t *source_ptr;
  size_t source_len;
  uint8_t loader;
  int (*fetchSourceCode)(const NewOnBeforeParseArguments *args,
                         struct NewOnBeforeParseResult *result);
  void *plugin_source_code_context;
  void (*free_plugin_source_code_context)(void *ctx);
  void (*log)(const NewOnBeforeParseArguments *args, BunLogOptions *options);
  size_t new_field_one;
  size_t new_field_two;
  size_t new_field_three;
};

void new_log_error(const NewOnBeforeParseArguments *args,
                   const NewOnBeforeParseResult *result, BunLogLevel level,
                   const char *message, size_t message_len) {
  BunLogOptions options;
  options.message_ptr = (uint8_t *)message;
  options.message_len = message_len;
  options.path_ptr = args->path_ptr;
  options.path_len = args->path_len;
  options.source_line_text_ptr = nullptr;
  options.source_line_text_len = 0;
  options.level = (int8_t)level;
  options.line = 0;
  options.lineEnd = 0;
  options.column = 0;
  options.columnEnd = 0;
  (result->log)(args, &options);
}

extern "C" BUN_PLUGIN_EXPORT void
incompatible_version_plugin_impl(const NewOnBeforeParseArguments *args,
                                 NewOnBeforeParseResult *result) {
  if (args->__struct_size < sizeof(NewOnBeforeParseArguments)) {
    const char *msg = "This plugin is built for a newer version of Bun than "
                      "the one currently running.";
    new_log_error(args, result, BUN_LOG_LEVEL_ERROR, msg, strlen(msg));
    return;
  }

  if (result->__struct_size < sizeof(NewOnBeforeParseResult)) {
    const char *msg = "This plugin is built for a newer version of Bun than "
                      "the one currently running.";
    new_log_error(args, result, BUN_LOG_LEVEL_ERROR, msg, strlen(msg));
    return;
  }
}

struct RandomUserContext {
  const char *foo;
  size_t bar;
};

extern "C" BUN_PLUGIN_EXPORT void random_user_context_free(void *ptr) {
  free(ptr);
}

extern "C" BUN_PLUGIN_EXPORT void
plugin_impl_bad_free_function_pointer(const OnBeforeParseArguments *args,
                                      OnBeforeParseResult *result) {

  // Intentionally not setting the context here:
  // result->plugin_source_code_context = ctx;
  result->free_plugin_source_code_context = random_user_context_free;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
