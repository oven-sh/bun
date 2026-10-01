#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <node_api.h>
#include <thread>

#define CHECK(condition)                                                       \
  do {                                                                         \
    if (!(condition)) {                                                        \
      std::fprintf(stderr, "check failed: %s\n", #condition);                  \
      std::abort();                                                            \
    }                                                                          \
  } while (0)

// Each subprocess runs one worker. These counters remain readable after its env
// dies.
static std::atomic<unsigned> accepted{0}, delivered{0}, returned{0},
    finalized{0};
static std::atomic<unsigned> at_finalize{0}, duplicates{0}, late{0},
    released{0};
static std::atomic<uint64_t> seen{0};

struct Context {
  napi_threadsafe_function fn;
  std::mutex mutex;
  std::condition_variable condition;
  bool stopping = false;
  std::thread producer;
};
static thread_local Context *current = nullptr;

static void signal_release(void *data) {
  auto *context = static_cast<Context *>(data);
  std::lock_guard<std::mutex> lock(context->mutex);
  context->stopping = true;
  context->condition.notify_one();
}

static void finish(napi_env env, void *data, void *) {
  auto *context = static_cast<Context *>(data);
  if (context->producer.joinable()) {
    napi_remove_env_cleanup_hook(env, signal_release, context);
    signal_release(context);
    context->producer.join();
  }
  at_finalize.store(delivered.load() + returned.load());
  finalized.fetch_add(1);
  current = nullptr;
  delete context;
}

static void call_js(napi_env env, napi_value callback, void *, void *data) {
  auto *payload = static_cast<unsigned *>(data);
  const uint64_t bit = uint64_t{1} << *payload;
  if (seen.fetch_or(bit) & bit)
    duplicates.fetch_add(1);
  delete payload;
  if (finalized.load())
    late.fetch_add(1);
  if (!env) {
    CHECK(callback == nullptr);
    returned.fetch_add(1);
    return;
  }
  delivered.fetch_add(1);
  napi_value receiver, result;
  napi_get_undefined(env, &receiver);
  // A stopping worker may refuse JS; the native consumer still owns the
  // payload.
  napi_call_function(env, receiver, callback, 0, nullptr, &result);
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4], name, result;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  uint32_t capacity, count, mode;
  napi_get_value_uint32(env, args[1], &capacity);
  napi_get_value_uint32(env, args[2], &count);
  napi_get_value_uint32(env, args[3], &mode);
  CHECK(count <= 64);
  auto *context = new Context;
  current = context;
  napi_create_string_utf8(env, "tsfn-payload-ownership", NAPI_AUTO_LENGTH,
                          &name);
  CHECK(napi_create_threadsafe_function(env, args[0], nullptr, name, capacity,
                                        1, context, finish, context, call_js,
                                        &context->fn) == napi_ok);
  for (unsigned i = 0; i < count; i++) {
    auto *payload = new unsigned(i);
    const auto rc = napi_call_threadsafe_function(context->fn, payload,
                                                  napi_tsfn_nonblocking);
    if (rc == napi_ok)
      accepted.fetch_add(1);
    else {
      delete payload;
      CHECK(rc == napi_queue_full);
    }
  }
  // Unref permits the natural-exit case to tear down with payloads still
  // queued.
  CHECK(napi_unref_threadsafe_function(env, context->fn) == napi_ok);
  if (mode == 0) {
    CHECK(napi_release_threadsafe_function(context->fn, napi_tsfn_release) ==
          napi_ok);
    released.fetch_add(1);
  } else if (mode == 2) {
    CHECK(napi_add_env_cleanup_hook(env, signal_release, context) == napi_ok);
    context->producer = std::thread([context] {
      {
        std::unique_lock<std::mutex> lock(context->mutex);
        context->condition.wait(lock, [context] { return context->stopping; });
      }
      CHECK(napi_release_threadsafe_function(context->fn, napi_tsfn_release) ==
            napi_ok);
      released.fetch_add(1);
    });
  }
  napi_get_undefined(env, &result);
  return result;
}

static napi_value abort_tsfn(napi_env env, napi_callback_info) {
  CHECK(napi_release_threadsafe_function(current->fn, napi_tsfn_abort) ==
        napi_ok);
  released.fetch_add(1);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value stats(napi_env env, napi_callback_info) {
  napi_value result, value;
  napi_create_object(env, &result);
#define FIELD(name)                                                            \
  napi_create_uint32(env, name.load(), &value);                                \
  napi_set_named_property(env, result, #name, value)
  FIELD(accepted);
  FIELD(delivered);
  FIELD(returned);
  FIELD(finalized);
  FIELD(at_finalize);
  FIELD(duplicates);
  FIELD(late);
  FIELD(released);
#undef FIELD
  return result;
}

NAPI_MODULE_INIT() {
  const napi_property_descriptor properties[] = {
      {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"abort", nullptr, abort_tsfn, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"stats", nullptr, stats, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  napi_define_properties(env, exports, 3, properties);
  return exports;
}
