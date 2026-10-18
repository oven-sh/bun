// Built twice (NAPI_VERSION 9 and 10, both with NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS, as
// sharp is): an addon whose module Init, or whose `spin` method, runs N-API calls that Node
// gates behind can_call_into_js() while the parent terminates the worker that loaded it
// (test_terminate_during_gated_calls in module.js).
//
// The worker sets globalThis.__terminateProbe = { signal, probe } (two file paths) before it
// loads the addon. The addon creates the signal file, and the parent terminates the worker
// once it exists, so the termination lands inside the addon frame. The first refused call is
// probed (its status, what the exception readers say, what napi_throw says) and the line is
// written to the probe file for the parent to print. Then one node-addon-api call runs
// refused: that escalates to napi_fatal_error unless the readers and napi_throw agree with
// Node that the env is stopping and no exception is pending.
#include <napi.h>

#include <chrono>
#include <cstdio>
#include <string>

static std::string string_of(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    return "";
  }
  std::string out(length, '\0');
  napi_get_value_string_utf8(env, value, out.data(), length + 1, &length);
  return out;
}

static void touch(const std::string &path) {
  if (FILE *f = fopen(path.c_str(), "w")) {
    fclose(f);
  }
}

static void write_probe(const std::string &path, const std::string &line) {
  if (FILE *f = fopen(path.c_str(), "w")) {
    fputs(line.c_str(), f);
    fclose(f);
  }
}

static void probe(napi_env env, const std::string &signal_path,
                  const std::string &probe_path) {
  napi_value object = nullptr;
  napi_create_object(env, &object);
  touch(signal_path);

#if NAPI_VERSION >= 10
  const napi_status gate_status = napi_cannot_run_js;
#else
  const napi_status gate_status = napi_pending_exception;
#endif
  std::string line = "never refused";
  const auto deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds(20);
  while (std::chrono::steady_clock::now() < deadline) {
    napi_value one = nullptr;
    napi_create_int32(env, 1, &one);
    napi_status status = napi_set_named_property(env, object, "k", one);
    if (status == napi_ok) {
      continue;
    }
    // A call already inside its body when the stop lands answers with whatever
    // status the check that found it maps an exception to (JSC services the
    // stop at checks inside the body; V8 does not). The next call is refused
    // at entry, by the gate; that is the answer probed.
    if (status != gate_status) {
      continue;
    }
    bool pending = false;
    napi_is_exception_pending(env, &pending);
    napi_value message = nullptr, error = nullptr;
    napi_create_string_utf8(env, "probe", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &error);
    napi_status throw_status = napi_throw(env, error);
    bool pending_after_throw = false;
    napi_is_exception_pending(env, &pending_after_throw);
    napi_value exception = nullptr;
    napi_status clear_status =
        napi_get_and_clear_last_exception(env, &exception);
    napi_valuetype type = napi_undefined;
    if (exception != nullptr) {
      napi_typeof(env, exception, &type);
    }
    line = "refused: status=" + std::to_string(status) +
           " pending=" + std::to_string(pending) +
           " napi_throw=" + std::to_string(throw_status) +
           " pending_after_throw=" + std::to_string(pending_after_throw) +
           " get_and_clear=" + std::to_string(clear_status) +
           " exception_type=" + std::to_string(type);
    break;
  }

  write_probe(probe_path, line);

#if NAPI_VERSION < 10
  // Object::Set on a refused napi_set_named_property runs
  // Error::New(env).ThrowAsJavaScriptException(). node-addon-api 8.0.0 swallows
  // only napi_pending_exception there, so under NAPI_VERSION >= 10 (napi_cannot_run_js)
  // it is fatal on Node too.
  Napi::Object(env, object).Set("k", Napi::Number::New(env, 1));
  write_probe(probe_path, line + "; node-addon-api returned");
#endif
}

// spinScript(probe, fn): enter `fn` (a JS loop that never returns on its own)
// until the stop lands inside it. JSC then throws the termination in
// the script, so it is pending on the VM when napi_call_function returns. The
// readers must not hand it out, and napi_throw answers as the closed gate does.
// Bun only: Node's TryCatch stores null as last_exception for a termination,
// so Node reports an exception pending here and hands out null.
static Napi::Value spin_script(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  std::string probe_path = info[0].As<Napi::String>().Utf8Value();
  napi_value fn = info[1];
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);

  // `fn` creates the signal file itself, so the stop lands while it runs.
  napi_value unused = nullptr;
  napi_status call_status =
      napi_call_function(env, undefined, fn, 0, nullptr, &unused);
  bool pending = false;
  napi_is_exception_pending(env, &pending);
  napi_value exception = nullptr;
  napi_status clear_status =
      napi_get_and_clear_last_exception(env, &exception);
  napi_valuetype type = napi_undefined;
  if (exception != nullptr) {
    napi_typeof(env, exception, &type);
  }
  bool pending_after_clear = false;
  napi_is_exception_pending(env, &pending_after_clear);
  napi_value message = nullptr, error = nullptr;
  napi_create_string_utf8(env, "probe", NAPI_AUTO_LENGTH, &message);
  napi_create_error(env, nullptr, message, &error);
  napi_status throw_status = napi_throw(env, error);

  std::string line = "call_function=" + std::to_string(call_status) +
                     " pending=" + std::to_string(pending) +
                     " get_and_clear=" + std::to_string(clear_status) +
                     " exception_type=" + std::to_string(type) +
                     " pending_after_clear=" +
                     std::to_string(pending_after_clear) +
                     " napi_throw=" + std::to_string(throw_status);
  write_probe(probe_path, line);
  return info.Env().Undefined();
}

static Napi::Value spin(const Napi::CallbackInfo &info) {
  probe(info.Env(), info[0].As<Napi::String>().Utf8Value(),
        info[1].As<Napi::String>().Utf8Value());
  return info.Env().Undefined();
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value global = nullptr, config = nullptr, signal = nullptr,
             probe_out = nullptr, in_init = nullptr;
  napi_get_global(env, &global);
  napi_get_named_property(env, global, "__terminateProbe", &config);
  napi_get_named_property(env, config, "signal", &signal);
  napi_get_named_property(env, config, "probe", &probe_out);
  napi_get_named_property(env, config, "inInit", &in_init);
  Napi::Object(env, exports)
      .Set("spin", Napi::Function::New(Napi::Env(env), spin, "spin"));
  Napi::Object(env, exports)
      .Set("spinScript",
           Napi::Function::New(Napi::Env(env), spin_script, "spinScript"));
  bool spin_in_init = false;
  napi_get_value_bool(env, in_init, &spin_in_init);
  if (spin_in_init) {
    probe(env, string_of(env, signal), string_of(env, probe_out));
  }
  return exports;
}

NAPI_MODULE(terminate_probe_addon, init)
