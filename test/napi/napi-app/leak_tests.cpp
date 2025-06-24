#include "leak_tests.h"

#include "utils.h"
#include <cassert>
#include <vector>

namespace napitests {

static std::vector<Napi::Reference<Napi::Value>> global_weak_refs;

// add a weak reference to a global array
// this will cause extra memory usage for the ref, but it should not retain the
// JS object being referenced
Napi::Value add_weak_refs(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  for (int i = 0; i < 50; i++) {
    global_weak_refs.emplace_back(
        Napi::Reference<Napi::Value>::New(info[0], 0));
  }
  return env.Undefined();
}

// delete all the weak refs created by add_weak_ref
Napi::Value clear_weak_refs(const Napi::CallbackInfo &info) {
  global_weak_refs.clear();
  return info.Env().Undefined();
}

// create a strong reference to a JS value, and then delete it
Napi::Value create_and_delete_strong_ref(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  // strong reference
  auto ref = Napi::Reference<Napi::Value>::New(info[0], 2);
  // destructor will be called
  return env.Undefined();
}

class WrappedObject {
public:
  static napi_value factory(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    napi_value s = info[0];
    bool supports_node_api_post_finalize = info[1].As<Napi::Boolean>();

    size_t len = 0;
    NODE_API_CALL(env, napi_get_value_string_utf8(env, s, nullptr, 0, &len));
    char *string = new char[len + 1];
    string[len] = 0;
    NODE_API_CALL(env,
                  napi_get_value_string_utf8(env, s, string, len + 1, nullptr));

    napi_value js_object;
    NODE_API_CALL(env, napi_create_object(env, &js_object));

    WrappedObject *native_object =
        new WrappedObject(string, supports_node_api_post_finalize);
    NODE_API_CALL(env, napi_wrap(env, js_object, native_object, basic_finalize,
                                 nullptr, &native_object->m_ref));
    napi_property_descriptor property = {
        .utf8name = "get",
        .name = nullptr,
        .method = get,
        .getter = nullptr,
        .setter = nullptr,
        .value = nullptr,
        .attributes = napi_default_method,
        .data = nullptr,
    };
    NODE_API_CALL(env, napi_define_properties(env, js_object, 1, &property));
    return js_object;
  }

  static napi_value get(napi_env env, napi_callback_info info) {
    napi_value js_this;
    NODE_API_CALL(
        env, napi_get_cb_info(env, info, nullptr, nullptr, &js_this, nullptr));
    WrappedObject *native_object;
    NODE_API_CALL(env, napi_unwrap(env, js_this,
                                   reinterpret_cast<void **>(&native_object)));
    return Napi::String::New(env, native_object->m_string);
  }

private:
  static constexpr size_t big_alloc_size = 5'000'000;

  WrappedObject(char *string, bool supports_node_api_post_finalize)
      : m_string(string), m_big_alloc(new char[big_alloc_size]),
        m_supports_node_api_post_finalize(supports_node_api_post_finalize) {
    memset(m_big_alloc, big_alloc_size, 'x');
  }

  ~WrappedObject() {
    delete[] m_string;
    delete[] m_big_alloc;
  }

  static void delete_ref(napi_env env, void *data, void *hint) {
    napi_delete_reference(env, reinterpret_cast<napi_ref>(data));
  }

  static void basic_finalize(node_api_basic_env env, void *data, void *hint) {
    auto *native_object = reinterpret_cast<WrappedObject *>(data);
    if (native_object->m_supports_node_api_post_finalize) {
      node_api_post_finalizer(env, delete_ref,
                              reinterpret_cast<void *>(native_object->m_ref),
                              nullptr);
    } else {
      napi_delete_reference(env, native_object->m_ref);
    }
    delete native_object;
  }

  char *m_string;
  char *m_big_alloc;
  napi_ref m_ref = nullptr;
  bool m_supports_node_api_post_finalize;
};

class ExternalObject {
public:
  static napi_value factory(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    std::string s = info[0].As<Napi::String>();
    auto *native_object = new ExternalObject(std::move(s));
    napi_value js_external;
    NODE_API_CALL(env, napi_create_external(env, native_object, basic_finalize,
                                            nullptr, &js_external));
    return js_external;
  }

  static napi_value get(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    napi_value v = info[0];
    ExternalObject *native_object;
    NODE_API_CALL(env, napi_get_value_external(
                           env, v, reinterpret_cast<void **>(&native_object)));
    return Napi::String::New(env, native_object->m_string);
  }

private:
  ExternalObject(std::string &&string) : m_string(string) {}
  static void basic_finalize(node_api_basic_env env, void *data, void *hint) {
    auto *native_object = reinterpret_cast<ExternalObject *>(data);
    delete native_object;
  }

  std::string m_string;
};

// creates a threadsafe function wrapping the passed JavaScript function, and
// then deletes it
// parameter 1: JavaScript function
// parameter 2: max queue size (0 means dynamic, like in
// napi_create_threadsafe_function)
// parameter 3: number of times to call the threadsafe function
napi_value
create_and_delete_threadsafe_function(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  napi_value js_func = info[0];
  size_t max_queue_size = info[1].As<Napi::Number>().Uint32Value();
  size_t num_calls = info[2].As<Napi::Number>().Uint32Value();
  NODE_API_ASSERT(env, num_calls <= max_queue_size || max_queue_size == 0);
  napi_threadsafe_function tsfn;
  napi_value async_resource_name;
  NODE_API_CALL(env,
                napi_create_string_utf8(env, "name", 4, &async_resource_name));
  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, js_func, nullptr, async_resource_name, max_queue_size,
                    1, nullptr, nullptr, nullptr, nullptr, &tsfn));
  for (size_t i = 0; i < num_calls; i++) {
    // status should never be napi_queue_full, because we call this exactly as
    // many times as there is capacity in the queue
    NODE_API_CALL(env, napi_call_threadsafe_function(tsfn, nullptr,
                                                     napi_tsfn_nonblocking));
  }
  NODE_API_CALL(env, napi_release_threadsafe_function(tsfn, napi_tsfn_abort));
  return env.Undefined();
}

void register_leak_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, add_weak_refs);
  REGISTER_FUNCTION(env, exports, clear_weak_refs);
  REGISTER_FUNCTION(env, exports, create_and_delete_strong_ref);
  REGISTER_FUNCTION(env, exports, create_and_delete_threadsafe_function);
  exports.Set("wrapped_object_factory",
              Napi::Function::New(env, WrappedObject::factory));
  exports.Set("external_factory",
              Napi::Function::New(env, ExternalObject::factory));
  exports.Set("external_get", Napi::Function::New(env, ExternalObject::get));
}

} // namespace napitests
