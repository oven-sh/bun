// Native bundler plugin for plugins.test.ts: each onBeforeParse hook logs one error whose location has a line but a different kind of column.
#include <bun-native-bundler-plugin-api/bundler_plugin.h>
#include <string.h>

#ifdef _WIN32
#define PLUGIN_EXPORT __declspec(dllexport)
#else
#define PLUGIN_EXPORT __attribute__((visibility("default")))
#endif

PLUGIN_EXPORT const char *BUN_PLUGIN_NAME = "log-location";

PLUGIN_EXPORT void *napi_register_module_v1(void *env, void *exports) {
  (void)env;
  return exports;
}

static void log_error(const OnBeforeParseArguments *args,
                      const OnBeforeParseResult *result, const char *message,
                      const char *line_text, int line, int column,
                      int column_end) {
  BunLogOptions options;
  memset(&options, 0, sizeof(options));
  options.__struct_size = sizeof(options);
  options.message_ptr = (const uint8_t *)message;
  options.message_len = strlen(message);
  options.path_ptr = args->path_ptr;
  options.path_len = args->path_len;
  options.source_line_text_ptr = (const uint8_t *)line_text;
  options.source_line_text_len = strlen(line_text);
  options.level = BUN_LOG_LEVEL_ERROR;
  options.line = line;
  options.lineEnd = line;
  options.column = column;
  options.columnEnd = column_end;
  result->log(args, &options);
}

// Column 7 is the `a`, one-based.
PLUGIN_EXPORT void log_with_column(const OnBeforeParseArguments *args,
                                   OnBeforeParseResult *result) {
  log_error(args, result, "with column", "const a = 1;", 1, 7, 8);
}

PLUGIN_EXPORT void log_zero_column(const OnBeforeParseArguments *args,
                                   OnBeforeParseResult *result) {
  log_error(args, result, "zero column", "const b = 2;", 2, 0, 0);
}

PLUGIN_EXPORT void log_negative_column(const OnBeforeParseArguments *args,
                                       OnBeforeParseResult *result) {
  log_error(args, result, "negative column", "const c = 3;", 3, -1, -1);
}
