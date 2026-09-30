#include <node_api.h>

#include <condition_variable>
#include <mutex>
#include <thread>

// A worker thread kept in a static and stopped from a cleanup hook. Where the hook
// does not run, the static is still joinable, and destroying a joinable std::thread
// calls std::terminate().
static std::mutex mutex;
static std::condition_variable wake;
static bool stopping = false;
static std::thread worker;

static void stop_worker(void *) {
  {
    std::lock_guard<std::mutex> lock(mutex);
    stopping = true;
  }
  wake.notify_all();
  worker.join();
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  worker = std::thread([] {
    std::unique_lock<std::mutex> lock(mutex);
    wake.wait(lock, [] { return stopping; });
  });
  napi_add_env_cleanup_hook(env, stop_worker, nullptr);
  return exports;
}
