#include "async_tests.h"

#include "utils.h"
#include <cassert>
#include <chrono>
#include <thread>

namespace napitests {

struct AsyncWorkData {
  int result;
  napi_deferred deferred;
  napi_async_work work;
  bool do_throw;

  AsyncWorkData()
      : result(0), deferred(nullptr), work(nullptr), do_throw(false) {}

  static void execute(napi_env env, void *data) {
    AsyncWorkData *async_work_data = reinterpret_cast<AsyncWorkData *>(data);
    async_work_data->result = 42;
  }

  static void complete(napi_env c_env, napi_status status, void *data) {
    Napi::Env env(c_env);
    AsyncWorkData *async_work_data = reinterpret_cast<AsyncWorkData *>(data);
    NODE_API_ASSERT_CUSTOM_RETURN(env, void(), status == napi_ok);

    if (async_work_data->do_throw) {
      // still have to resolve/reject otherwise the process times out
      // we should not see the resolution as our unhandled exception handler
      // exits the process before that can happen
      napi_value result = env.Undefined();
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_resolve_deferred(env, async_work_data->deferred, result));

      Napi::Error::New(env, "error from napi").ThrowAsJavaScriptException();
    } else {
      char buf[64] = {0};
      snprintf(buf, sizeof(buf), "the number is %d", async_work_data->result);
      napi_value result = Napi::String::New(env, buf);
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_resolve_deferred(env, async_work_data->deferred, result));
    }

    NODE_API_CALL_CUSTOM_RETURN(
        env, void(), napi_delete_async_work(env, async_work_data->work));
    delete async_work_data;
  }
};

// create_promise(void *unused_run_gc_callback, bool do_throw): makes a promise
// using napi_Async_work that either resolves or throws in the complete callback
static napi_value create_promise(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  auto *data = new AsyncWorkData();
  // info[0] is a callback to run the GC
  data->do_throw = info[1].As<Napi::Boolean>();

  napi_value promise;
  NODE_API_CALL(env, napi_create_promise(env, &data->deferred, &promise));

  napi_value resource_name =
      Napi::String::New(env, "napitests__create_promise");
  NODE_API_CALL(
      env, napi_create_async_work(env, /* async resource */ nullptr,
                                  resource_name, AsyncWorkData::execute,
                                  AsyncWorkData::complete, data, &data->work));
  NODE_API_CALL(env, napi_queue_async_work(env, data->work));
  return promise;
}

class EchoWorker : public Napi::AsyncWorker {
public:
  EchoWorker(Napi::Env env, Napi::Promise::Deferred deferred,
             const std::string &&echo)
      : Napi::AsyncWorker(env), m_echo(echo), m_deferred(deferred) {}
  ~EchoWorker() override {}

  void Execute() override {
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  void OnOK() override { m_deferred.Resolve(Napi::String::New(Env(), m_echo)); }

private:
  std::string m_echo;
  Napi::Promise::Deferred m_deferred;
};

static Napi::Value
create_promise_with_napi_cpp(const Napi::CallbackInfo &info) {
  auto deferred = Napi::Promise::Deferred::New(info.Env());
  auto *work = new EchoWorker(info.Env(), deferred, "hello world");
  work->Queue();
  return deferred.Promise();
}

struct ThreadsafeFunctionData {
  napi_threadsafe_function tsfn;
  napi_deferred deferred;

  static void thread_entry(ThreadsafeFunctionData *data) {
    using namespace std::literals::chrono_literals;
    std::this_thread::sleep_for(10ms);
    // nonblocking means it will return an error if the threadsafe function's
    // queue is full, which it should never do because we only use it once and
    // we init with a capacity of 1
    assert(napi_call_threadsafe_function(data->tsfn, nullptr,
                                         napi_tsfn_nonblocking) == napi_ok);
  }

  static void tsfn_finalize_callback(napi_env env, void *finalize_data,
                                     void *finalize_hint) {
    printf("tsfn_finalize_callback\n");
    ThreadsafeFunctionData *data =
        reinterpret_cast<ThreadsafeFunctionData *>(finalize_data);
    delete data;
  }

  static void tsfn_callback(napi_env c_env, napi_value js_callback,
                            void *context, void *data) {
    // context == ThreadsafeFunctionData pointer
    // data == nullptr
    printf("tsfn_callback\n");
    ThreadsafeFunctionData *tsfn_data =
        reinterpret_cast<ThreadsafeFunctionData *>(context);
    Napi::Env env(c_env);

    napi_value recv = env.Undefined();

    // call our JS function with undefined for this and no arguments
    napi_value js_result;
    napi_status call_result =
        napi_call_function(env, recv, js_callback, 0, nullptr, &js_result);
    NODE_API_ASSERT_CUSTOM_RETURN(env, void(),
                                  call_result == napi_ok ||
                                      call_result == napi_pending_exception);

    if (call_result == napi_ok) {
      // only resolve if js_callback did not return an error
      // resolve the promise with the return value of the JS function
      NODE_API_CALL_CUSTOM_RETURN(
          env, void(),
          napi_resolve_deferred(env, tsfn_data->deferred, js_result));
    }

    // clean up the threadsafe function
    NODE_API_CALL_CUSTOM_RETURN(
        env, void(),
        napi_release_threadsafe_function(tsfn_data->tsfn, napi_tsfn_abort));
  }
};

napi_value
create_promise_with_threadsafe_function(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();
  ThreadsafeFunctionData *tsfn_data = new ThreadsafeFunctionData;

  napi_value async_resource_name = Napi::String::New(
      env, "napitests::create_promise_with_threadsafe_function");

  // this is called directly, without the GC callback, so argument 0 is a JS
  // callback used to resolve the promise
  NODE_API_CALL(env,
                napi_create_threadsafe_function(
                    env, info[0], nullptr, async_resource_name,
                    // max_queue_size, initial_thread_count
                    1, 1,
                    // thread_finalize_data, thread_finalize_cb
                    tsfn_data, ThreadsafeFunctionData::tsfn_finalize_callback,
                    // context
                    tsfn_data, ThreadsafeFunctionData::tsfn_callback,
                    &tsfn_data->tsfn));
  // create a promise we can return to JS and put the deferred counterpart in
  // tsfn_data
  napi_value promise;
  NODE_API_CALL(env, napi_create_promise(env, &tsfn_data->deferred, &promise));

  // spawn and release std::thread
  std::thread secondary_thread(ThreadsafeFunctionData::thread_entry, tsfn_data);
  secondary_thread.detach();
  // return the promise to javascript
  return promise;
}

napi_value create_async_work_with_null_execute(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  int32_t *data = new int32_t;
  *data = 0;

  napi_status status;
  napi_async_work work;
  napi_value result;

  status = napi_create_async_work(env, nullptr, nullptr, nullptr, nullptr, data,
                                  &work);

  // status must be napi_invalid_arg
  if (status != napi_invalid_arg) {
    napi_get_boolean(env, false, &result);
    return result;
  }

  status = napi_get_boolean(env, true, &result);

  return result;
}

void execute_for_null_complete(napi_env env, void *data) {
  fprintf(stdout, "execute called!\n");
}

napi_value
create_async_work_with_null_complete(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  // napi_status status;
  napi_async_work work;
  napi_value result;

  napi_value resource_name =
      Napi::String::New(env, "napitests__create_async_work_with_null_complete");

  napi_create_async_work(env, nullptr, resource_name,
                         &execute_for_null_complete, nullptr, nullptr, &work);

  napi_queue_async_work(env, work);

  napi_get_undefined(env, &result);

  return result;
}

struct CancelData {
  napi_ref callback;
  napi_async_work work;
};

void execute_for_cancel(napi_env env, void *data) {
  // nothing
}

void complete_for_cancel(napi_env env, napi_status status, void *data) {
  CancelData *cancel_data = reinterpret_cast<CancelData *>(data);
  napi_value callback;
  napi_get_reference_value(env, cancel_data->callback, &callback);

  napi_value global;
  napi_get_global(env, &global);

  // should be cancelled
  bool result = status == napi_cancelled ? true : false;

  napi_value argv[1];
  napi_get_boolean(env, result, &argv[0]);

  napi_call_function(env, global, callback, 1, argv, nullptr);

  napi_delete_reference(env, cancel_data->callback);
  napi_delete_async_work(env, cancel_data->work);
}

std::atomic<bool> cancel_flag(false);

void blocking_execute_for_cancel(napi_env env, void *data) {
  while (!cancel_flag) {
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
}

napi_value test_cancel_async_work(const Napi::CallbackInfo &info) {
  napi_env env = info.Env();

  napi_ref callback;
  napi_create_reference(env, info[0], 1, &callback);

  napi_status status;
  napi_value result;

  napi_value blocking_resource_name_1 =
      Napi::String::New(env, "napitests__test_cancel_async_work_blocking_1");
  napi_value blocking_resource_name_2 =
      Napi::String::New(env, "napitests__test_cancel_async_work_blocking_2");

  napi_async_work blocking_work_1;
  napi_async_work blocking_work_2;

  napi_create_async_work(env, nullptr, blocking_resource_name_1,
                         &blocking_execute_for_cancel, nullptr, nullptr,
                         &blocking_work_1);
  napi_queue_async_work(env, blocking_work_1);

  napi_create_async_work(env, nullptr, blocking_resource_name_2,
                         &blocking_execute_for_cancel, nullptr, nullptr,
                         &blocking_work_2);
  napi_queue_async_work(env, blocking_work_2);

  struct CancelData *data = new CancelData;
  data->callback = callback;

  napi_value resource_name =
      Napi::String::New(env, "napitests__test_cancel_async_work");

  napi_create_async_work(env, nullptr, resource_name, &execute_for_cancel,
                         &complete_for_cancel, data, &data->work);
  napi_queue_async_work(env, data->work);

  status = napi_cancel_async_work(env, data->work);
  if (status != napi_ok) {
    napi_get_boolean(env, false, &result);
    return result;
  }

  // cancel the blocking work
  cancel_flag = true;

  napi_get_boolean(env, true, &result);
  return result;
}

void register_async_tests(Napi::Env env, Napi::Object exports) {
  REGISTER_FUNCTION(env, exports, create_promise);
  REGISTER_FUNCTION(env, exports, create_promise_with_napi_cpp);
  REGISTER_FUNCTION(env, exports, create_promise_with_threadsafe_function);
  REGISTER_FUNCTION(env, exports, create_async_work_with_null_execute);
  REGISTER_FUNCTION(env, exports, create_async_work_with_null_complete);
  REGISTER_FUNCTION(env, exports, test_cancel_async_work);
}

} // namespace napitests
