#include "leak_tests.h"

#include "utils.h"
#include <cassert>

namespace napitests {

Napi::Value make_weak_ref(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  // weak reference
  auto ref = Napi::Reference<Napi::Value>::New(info[0], 0);
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

    unsigned canary = static_cast<unsigned>(random());
    WrappedObject *native_object =
        new WrappedObject(string, canary, supports_node_api_post_finalize);
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
  WrappedObject(char *string, unsigned canary,
                bool supports_node_api_post_finalize)
      : m_string(string), m_canary(canary), m_pcanary(new unsigned(canary)),
        m_supports_node_api_post_finalize(supports_node_api_post_finalize) {}

  ~WrappedObject() {
    delete[] m_string;
    assert(*m_pcanary == m_canary);
    delete m_pcanary;
    m_pcanary = nullptr;
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
  unsigned m_canary;
  unsigned *m_pcanary;
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

void register_leak_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, make_weak_ref);
  exports.Set("wrapped_object_factory",
              Napi::Function::New(env, WrappedObject::factory));
  exports.Set("external_factory",
              Napi::Function::New(env, ExternalObject::factory));
  exports.Set("external_get", Napi::Function::New(env, ExternalObject::get));
}

} // namespace napitests
