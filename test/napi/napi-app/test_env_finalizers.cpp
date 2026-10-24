#include <node_api.h>
#undef NDEBUG
#include <atomic>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <thread>

static std::atomic<unsigned> counts[4], offThread, nullEnv;

struct Item {
  unsigned kind;
  std::thread::id owner;
  napi_ref ref = nullptr;
};

static void finalize(napi_env env, void *data, void *) {
  auto *item = static_cast<Item *>(data);
  if (item->owner != std::this_thread::get_id())
    ++offThread;
  if (!env)
    ++nullEnv;
  if (item->ref)
    assert(napi_delete_reference(env, item->ref) == napi_ok);
  ++counts[item->kind];
  if (getenv("NAPI_ENV_FINALIZER_TRACE")) {
    printf("finalized %u\n", item->kind);
    fflush(stdout);
  }
  delete item;
}

static void cancelled(napi_env, void *, void *) { abort(); }

static napi_value make(napi_env env, napi_callback_info) {
  napi_value array;
  assert(napi_create_array(env, &array) == napi_ok);
  for (unsigned kind = 0; kind < 4; ++kind) {
    auto *item = new Item{kind, std::this_thread::get_id()};
    napi_value value;
    if (kind == 0) {
      assert(napi_create_external(env, item, finalize, nullptr, &value) ==
             napi_ok);
    } else {
      assert(napi_create_object(env, &value) == napi_ok);
      if (kind == 3)
        assert(napi_wrap(env, value, item, finalize, nullptr, nullptr) ==
               napi_ok);
      else
        assert(napi_add_finalizer(env, value, item, finalize, nullptr,
                                  kind == 2 ? &item->ref : nullptr) == napi_ok);
    }
    assert(napi_set_element(env, array, kind, value) == napi_ok);
  }
  // Deleting an addon-owned ref must cancel its finalizer at GC and env
  // cleanup.
  napi_value value;
  napi_ref ref;
  assert(napi_create_object(env, &value) == napi_ok);
  assert(napi_add_finalizer(env, value, nullptr, cancelled, nullptr, &ref) ==
         napi_ok);
  assert(napi_delete_reference(env, ref) == napi_ok);
  assert(napi_set_element(env, array, 4, value) == napi_ok);
  return array;
}

static napi_value stats(napi_env env, napi_callback_info) {
  napi_value result, array, value;
  assert(napi_create_object(env, &result) == napi_ok);
  assert(napi_create_array(env, &array) == napi_ok);
  for (unsigned kind = 0; kind < 4; ++kind) {
    assert(napi_create_uint32(env, counts[kind].load(), &value) == napi_ok);
    assert(napi_set_element(env, array, kind, value) == napi_ok);
  }
  assert(napi_set_named_property(env, result, "counts", array) == napi_ok);
  assert(napi_create_uint32(env, offThread.load(), &value) == napi_ok);
  assert(napi_set_named_property(env, result, "offThread", value) == napi_ok);
  assert(napi_create_uint32(env, nullEnv.load(), &value) == napi_ok);
  assert(napi_set_named_property(env, result, "nullEnv", value) == napi_ok);
  return result;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"make", nullptr, make, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stats", nullptr, stats, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  assert(napi_define_properties(env, exports, 2, properties) == napi_ok);
  return exports;
}
