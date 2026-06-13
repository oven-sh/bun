#include <node_api.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
#include <uv.h>

// Test mutex initialization and destruction
static napi_value test_mutex_init_destroy(napi_env env,
                                          napi_callback_info info) {
  uv_mutex_t mutex;
  int result = uv_mutex_init(&mutex);
  if (result != 0) {
    napi_throw_error(env, NULL, "Failed to initialize mutex");
    return NULL;
  }

  uv_mutex_destroy(&mutex);

  napi_value ret;
  napi_get_boolean(env, true, &ret);
  return ret;
}

// Test recursive mutex
static napi_value test_mutex_recursive(napi_env env, napi_callback_info info) {
  uv_mutex_t mutex;
  int result = uv_mutex_init_recursive(&mutex);
  if (result != 0) {
    napi_throw_error(env, NULL, "Failed to initialize recursive mutex");
    return NULL;
  }

  // Try locking multiple times
  uv_mutex_lock(&mutex);
  uv_mutex_lock(&mutex);

  // Unlock the same number of times
  uv_mutex_unlock(&mutex);
  uv_mutex_unlock(&mutex);

  uv_mutex_destroy(&mutex);

  napi_value ret;
  napi_get_boolean(env, true, &ret);
  return ret;
}

// Test mutex trylock
static napi_value test_mutex_trylock(napi_env env, napi_callback_info info) {
  uv_mutex_t mutex;
  uv_mutex_init(&mutex);

  int result = uv_mutex_trylock(&mutex);
  if (result != 0) {
    uv_mutex_destroy(&mutex);
    napi_throw_error(env, NULL, "Failed to trylock mutex");
    return NULL;
  }

  uv_mutex_unlock(&mutex);
  uv_mutex_destroy(&mutex);

  napi_value ret;
  napi_get_boolean(env, true, &ret);
  return ret;
}

// Test getpid and getppid
static napi_value test_process_ids(napi_env env, napi_callback_info info) {
  uv_pid_t pid = uv_os_getpid();
  uv_pid_t ppid = uv_os_getppid();

  // Create return object with pid and ppid
  napi_value obj;
  napi_create_object(env, &obj);

  napi_value pid_value, ppid_value;
  napi_create_int32(env, pid, &pid_value);
  napi_create_int32(env, ppid, &ppid_value);

  napi_set_named_property(env, obj, "pid", pid_value);
  napi_set_named_property(env, obj, "ppid", ppid_value);

  return obj;
}

int count = 0;
// Test uv_once
static void once_callback(void) {
  // Just a dummy callback
  count++;
}
uv_once_t guard = UV_ONCE_INIT;

static napi_value test_uv_once(napi_env env, napi_callback_info info) {
  uv_once(&guard, once_callback);

  napi_value ret;
  napi_create_int32(env, count, &ret);
  return ret;
}

// Test uv_hrtime
static napi_value test_hrtime(napi_env env, napi_callback_info info) {
  uint64_t time1 = uv_hrtime();

  // Sleep for a tiny bit to ensure time passes
  usleep(1000); // Sleep for 1ms

  uint64_t time2 = uv_hrtime();

  // Create return object with both timestamps
  napi_value obj;
  napi_create_object(env, &obj);

  // Convert uint64_t to two int32 values (high and low bits)
  // because JavaScript numbers can't safely handle 64-bit integers
  napi_value time1_low, time1_high, time2_low, time2_high;
  napi_create_int32(env, (int32_t)(time1 & 0xFFFFFFFF), &time1_low);
  napi_create_int32(env, (int32_t)(time1 >> 32), &time1_high);
  napi_create_int32(env, (int32_t)(time2 & 0xFFFFFFFF), &time2_low);
  napi_create_int32(env, (int32_t)(time2 >> 32), &time2_high);

  napi_set_named_property(env, obj, "time1Low", time1_low);
  napi_set_named_property(env, obj, "time1High", time1_high);
  napi_set_named_property(env, obj, "time2Low", time2_low);
  napi_set_named_property(env, obj, "time2High", time2_high);

  return obj;
}

static void set_int32(napi_env env, napi_value obj, const char *name,
                      int32_t value) {
  napi_value v;
  napi_create_int32(env, value, &v);
  napi_set_named_property(env, obj, name, v);
}

static void set_uint32(napi_env env, napi_value obj, const char *name,
                       uint32_t value) {
  napi_value v;
  napi_create_uint32(env, value, &v);
  napi_set_named_property(env, obj, name, v);
}

static void set_bool(napi_env env, napi_value obj, const char *name,
                     bool value) {
  napi_value v;
  napi_get_boolean(env, value, &v);
  napi_set_named_property(env, obj, name, v);
}

static void set_string(napi_env env, napi_value obj, const char *name,
                       const char *value) {
  napi_value v;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, name, v);
}

// Test uv_version and uv_version_string
static napi_value test_version(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_create_object(env, &obj);

  set_uint32(env, obj, "version", uv_version());
  set_string(env, obj, "versionString", uv_version_string());
  set_uint32(env, obj, "major", UV_VERSION_MAJOR);
  set_uint32(env, obj, "minor", UV_VERSION_MINOR);
  set_uint32(env, obj, "patch", UV_VERSION_PATCH);

  return obj;
}

// Test uv_cwd
static napi_value test_cwd(napi_env env, napi_callback_info info) {
  char big[4096];
  size_t big_size = sizeof(big);
  int rc_big = uv_cwd(big, &big_size);

  char small[1];
  size_t small_size = sizeof(small);
  int rc_small = uv_cwd(small, &small_size);

  int rc_invalid = uv_cwd(NULL, NULL);

  napi_value obj;
  napi_create_object(env, &obj);

  set_int32(env, obj, "rcBig", rc_big);
  if (rc_big == 0) {
    set_string(env, obj, "cwd", big);
    set_uint32(env, obj, "bigSize", (uint32_t)big_size);
  }
  set_int32(env, obj, "rcSmall", rc_small);
  set_uint32(env, obj, "smallSize", (uint32_t)small_size);
  set_int32(env, obj, "rcInvalid", rc_invalid);

  return obj;
}

// Test uv_get_osfhandle and uv_open_osfhandle (identity on POSIX)
static napi_value test_osfhandle(napi_env env, napi_callback_info info) {
  bool ok = uv_get_osfhandle(0) == 0 && uv_get_osfhandle(42) == 42 &&
            uv_open_osfhandle((uv_os_fd_t)37) == 37;

  napi_value ret;
  napi_get_boolean(env, ok, &ret);
  return ret;
}

// Test uv_thread_self and uv_thread_equal
static void *thread_self_worker(void *arg) {
  *(uv_thread_t *)arg = uv_thread_self();
  return NULL;
}

static napi_value test_thread_self(napi_env env, napi_callback_info info) {
  uv_thread_t self = uv_thread_self();
  uv_thread_t self_again = uv_thread_self();
  pthread_t raw_self = pthread_self();

  uv_thread_t other;
  pthread_t t;
  if (pthread_create(&t, NULL, thread_self_worker, &other) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }
  pthread_join(t, NULL);

  napi_value obj;
  napi_create_object(env, &obj);
  set_bool(env, obj, "selfEqualsSelf",
           uv_thread_equal(&self, &self_again) != 0);
  set_bool(env, obj, "selfMatchesPthread", pthread_equal(self, raw_self) != 0);
  set_bool(env, obj, "otherThreadDiffers", uv_thread_equal(&self, &other) == 0);
  return obj;
}

// Test uv_ip4_addr, uv_ip4_name, uv_ip_name
static napi_value test_ip4(napi_env env, napi_callback_info info) {
  struct sockaddr_in addr;
  int rc = uv_ip4_addr("127.0.0.1", 8080, &addr);

  char name[64] = {0};
  int name_rc = uv_ip4_name(&addr, name, sizeof(name));

  char generic_name[64] = {0};
  int generic_rc =
      uv_ip_name((const struct sockaddr *)&addr, generic_name, sizeof(generic_name));

  struct sockaddr_in bogus;
  int invalid_octet_rc = uv_ip4_addr("999.1.2.3", 80, &bogus);
  int invalid_string_rc = uv_ip4_addr("not an ip", 80, &bogus);

  napi_value obj;
  napi_create_object(env, &obj);
  set_int32(env, obj, "rc", rc);
  set_bool(env, obj, "familyOk", addr.sin_family == AF_INET);
  set_uint32(env, obj, "port", ntohs(addr.sin_port));
  set_uint32(env, obj, "addrRaw", ntohl(addr.sin_addr.s_addr));
  set_int32(env, obj, "nameRc", name_rc);
  set_string(env, obj, "name", name);
  set_int32(env, obj, "genericRc", generic_rc);
  set_string(env, obj, "genericName", generic_name);
  set_int32(env, obj, "invalidOctetRc", invalid_octet_rc);
  set_int32(env, obj, "invalidStringRc", invalid_string_rc);
  return obj;
}

// Test uv_ip6_addr, uv_ip6_name
static napi_value test_ip6(napi_env env, napi_callback_info info) {
  struct sockaddr_in6 addr;
  int rc = uv_ip6_addr("::1", 9090, &addr);

  char name[64] = {0};
  int name_rc = uv_ip6_name(&addr, name, sizeof(name));

  struct sockaddr_in6 addr2;
  int rc2 = uv_ip6_addr("2001:db8:85a3::8a2e:370:7334", 443, &addr2);
  char name2[64] = {0};
  int name2_rc = uv_ip6_name(&addr2, name2, sizeof(name2));

  struct sockaddr_in6 bogus;
  int invalid_rc = uv_ip6_addr("not an ip", 1, &bogus);

  napi_value obj;
  napi_create_object(env, &obj);
  set_int32(env, obj, "rc", rc);
  set_bool(env, obj, "familyOk", addr.sin6_family == AF_INET6);
  set_uint32(env, obj, "port", ntohs(addr.sin6_port));
  set_bool(env, obj, "isLoopback", IN6_IS_ADDR_LOOPBACK(&addr.sin6_addr));
  set_int32(env, obj, "nameRc", name_rc);
  set_string(env, obj, "name", name);
  set_int32(env, obj, "rc2", rc2);
  set_int32(env, obj, "name2Rc", name2_rc);
  set_string(env, obj, "name2", name2);
  set_int32(env, obj, "invalidRc", invalid_rc);
  return obj;
}

// Test uv_inet_pton and uv_inet_ntop
static napi_value test_inet(napi_env env, napi_callback_info info) {
  unsigned char buf4[4] = {0};
  int pton4_rc = uv_inet_pton(AF_INET, "192.168.100.200", buf4);
  bool bytes_ok =
      buf4[0] == 192 && buf4[1] == 168 && buf4[2] == 100 && buf4[3] == 200;
  char round4[64] = {0};
  int ntop4_rc = uv_inet_ntop(AF_INET, buf4, round4, sizeof(round4));

  unsigned char buf16[16] = {0};
  int pton6_rc = uv_inet_pton(AF_INET6, "2001:db8::ff00:42:8329", buf16);
  char round6[64] = {0};
  int ntop6_rc = uv_inet_ntop(AF_INET6, buf16, round6, sizeof(round6));

  char tiny[2];
  int nospc_rc = uv_inet_ntop(AF_INET, buf4, tiny, sizeof(tiny));
  int einval_rc = uv_inet_pton(AF_INET, NULL, buf4);
  int eafnosupport_rc = uv_inet_pton(12345, "x", buf4);

  napi_value obj;
  napi_create_object(env, &obj);
  set_int32(env, obj, "pton4Rc", pton4_rc);
  set_bool(env, obj, "bytesOk", bytes_ok);
  set_int32(env, obj, "ntop4Rc", ntop4_rc);
  set_string(env, obj, "round4", round4);
  set_int32(env, obj, "pton6Rc", pton6_rc);
  set_int32(env, obj, "ntop6Rc", ntop6_rc);
  set_string(env, obj, "round6", round6);
  set_int32(env, obj, "nospcRc", nospc_rc);
  set_int32(env, obj, "einvalRc", einval_rc);
  set_int32(env, obj, "eafnosupportRc", eafnosupport_rc);
  return obj;
}

// Test uv_cond_init/wait/signal/broadcast/destroy
typedef struct {
  uv_mutex_t mutex;
  uv_cond_t cond;
  int flag;
  int woken;
} cond_ctx_t;

static void *cond_waiter(void *arg) {
  cond_ctx_t *ctx = arg;
  uv_mutex_lock(&ctx->mutex);
  while (!ctx->flag)
    uv_cond_wait(&ctx->cond, &ctx->mutex);
  ctx->woken++;
  uv_mutex_unlock(&ctx->mutex);
  return NULL;
}

static napi_value test_cond_signal(napi_env env, napi_callback_info info) {
  cond_ctx_t ctx = {0};
  if (uv_mutex_init(&ctx.mutex) != 0 || uv_cond_init(&ctx.cond) != 0) {
    napi_throw_error(env, NULL, "init failed");
    return NULL;
  }

  pthread_t t;
  if (pthread_create(&t, NULL, cond_waiter, &ctx) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }

  uv_mutex_lock(&ctx.mutex);
  ctx.flag = 1;
  uv_cond_signal(&ctx.cond);
  uv_mutex_unlock(&ctx.mutex);

  pthread_join(t, NULL);

  int woken = ctx.woken;
  uv_cond_destroy(&ctx.cond);
  uv_mutex_destroy(&ctx.mutex);

  napi_value ret;
  napi_create_int32(env, woken, &ret);
  return ret;
}

static napi_value test_cond_broadcast(napi_env env, napi_callback_info info) {
  cond_ctx_t ctx = {0};
  if (uv_mutex_init(&ctx.mutex) != 0 || uv_cond_init(&ctx.cond) != 0) {
    napi_throw_error(env, NULL, "init failed");
    return NULL;
  }

  pthread_t t1, t2;
  if (pthread_create(&t1, NULL, cond_waiter, &ctx) != 0 ||
      pthread_create(&t2, NULL, cond_waiter, &ctx) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }

  uv_mutex_lock(&ctx.mutex);
  ctx.flag = 1;
  uv_cond_broadcast(&ctx.cond);
  uv_mutex_unlock(&ctx.mutex);

  pthread_join(t1, NULL);
  pthread_join(t2, NULL);

  int woken = ctx.woken;
  uv_cond_destroy(&ctx.cond);
  uv_mutex_destroy(&ctx.mutex);

  napi_value ret;
  napi_create_int32(env, woken, &ret);
  return ret;
}

// Test uv_cond_timedwait timing out. The timeout is relative nanoseconds;
// on Linux the implementation adds it to the monotonic clock, so a clock
// mismatch would make this return immediately (elapsedMs ~ 0).
static napi_value test_cond_timedwait(napi_env env, napi_callback_info info) {
  uv_mutex_t mutex;
  uv_cond_t cond;
  if (uv_mutex_init(&mutex) != 0 || uv_cond_init(&cond) != 0) {
    napi_throw_error(env, NULL, "init failed");
    return NULL;
  }

  const uint64_t timeout_ns = 20 * 1000 * 1000; // 20ms
  uv_mutex_lock(&mutex);
  uint64_t start = uv_hrtime();
  int rc = 0;
  // pthread_cond_timedwait may wake spuriously (rc == 0); retry until the
  // timeout actually elapses.
  for (int i = 0; i < 100; i++) {
    rc = uv_cond_timedwait(&cond, &mutex, timeout_ns);
    if (rc != 0)
      break;
  }
  uint64_t elapsed = uv_hrtime() - start;
  uv_mutex_unlock(&mutex);

  uv_cond_destroy(&cond);
  uv_mutex_destroy(&mutex);

  napi_value obj;
  napi_create_object(env, &obj);
  set_int32(env, obj, "rc", rc);
  set_uint32(env, obj, "elapsedMs", (uint32_t)(elapsed / 1000000));
  return obj;
}

// Test uv_sem_init/post/wait/trywait/destroy
static void *sem_poster(void *arg) {
  uv_sem_post((uv_sem_t *)arg);
  return NULL;
}

static napi_value test_sem(napi_env env, napi_callback_info info) {
  uv_sem_t sem;
  if (uv_sem_init(&sem, 2) != 0) {
    napi_throw_error(env, NULL, "uv_sem_init failed");
    return NULL;
  }

  int try1 = uv_sem_trywait(&sem);
  int try2 = uv_sem_trywait(&sem);
  int try_empty = uv_sem_trywait(&sem);
  uv_sem_post(&sem);
  int try_after_post = uv_sem_trywait(&sem);

  // Cross-thread: semaphore is at 0; uv_sem_wait blocks until the other
  // thread posts.
  pthread_t t;
  if (pthread_create(&t, NULL, sem_poster, &sem) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }
  uv_sem_wait(&sem);
  pthread_join(t, NULL);

  uv_sem_destroy(&sem);

  napi_value obj;
  napi_create_object(env, &obj);
  set_int32(env, obj, "try1", try1);
  set_int32(env, obj, "try2", try2);
  set_int32(env, obj, "tryEmpty", try_empty);
  set_int32(env, obj, "tryAfterPost", try_after_post);
  return obj;
}

// Test uv_rwlock_*
typedef struct {
  uv_rwlock_t lock;
  int tryrd_rc;
  int trywr_rc;
} rwlock_ctx_t;

static void *rwlock_try_worker(void *arg) {
  rwlock_ctx_t *ctx = arg;
  ctx->tryrd_rc = uv_rwlock_tryrdlock(&ctx->lock);
  if (ctx->tryrd_rc == 0)
    uv_rwlock_rdunlock(&ctx->lock);
  ctx->trywr_rc = uv_rwlock_trywrlock(&ctx->lock);
  if (ctx->trywr_rc == 0)
    uv_rwlock_wrunlock(&ctx->lock);
  return NULL;
}

static napi_value test_rwlock(napi_env env, napi_callback_info info) {
  rwlock_ctx_t ctx = {0};
  if (uv_rwlock_init(&ctx.lock) != 0) {
    napi_throw_error(env, NULL, "uv_rwlock_init failed");
    return NULL;
  }

  // Two concurrent readers are allowed.
  uv_rwlock_rdlock(&ctx.lock);
  int second_reader_rc = uv_rwlock_tryrdlock(&ctx.lock);
  if (second_reader_rc == 0)
    uv_rwlock_rdunlock(&ctx.lock);
  uv_rwlock_rdunlock(&ctx.lock);

  // While a writer holds the lock, try* from another thread fails with
  // UV_EBUSY.
  uv_rwlock_wrlock(&ctx.lock);
  pthread_t t;
  if (pthread_create(&t, NULL, rwlock_try_worker, &ctx) != 0) {
    napi_throw_error(env, NULL, "pthread_create failed");
    return NULL;
  }
  pthread_join(t, NULL);
  uv_rwlock_wrunlock(&ctx.lock);

  int wr_after_unlock_rc = uv_rwlock_trywrlock(&ctx.lock);
  if (wr_after_unlock_rc == 0)
    uv_rwlock_wrunlock(&ctx.lock);

  uv_rwlock_destroy(&ctx.lock);

  napi_value obj;
  napi_create_object(env, &obj);
  set_int32(env, obj, "secondReaderRc", second_reader_rc);
  set_int32(env, obj, "tryrdWhileWriterRc", ctx.tryrd_rc);
  set_int32(env, obj, "trywrWhileWriterRc", ctx.trywr_rc);
  set_int32(env, obj, "trywrAfterUnlockRc", wr_after_unlock_rc);
  return obj;
}

// Test uv_interface_addresses / uv_free_interface_addresses
static napi_value test_interface_addresses(napi_env env,
                                           napi_callback_info info) {
  uv_interface_address_t *addresses = NULL;
  int count = 0;
  int rc = uv_interface_addresses(&addresses, &count);

  napi_value obj;
  napi_create_object(env, &obj);
  set_int32(env, obj, "rc", rc);
  set_int32(env, obj, "count", count);

  napi_value arr;
  napi_create_array(env, &arr);
  if (rc == 0) {
    for (int i = 0; i < count; i++) {
      napi_value entry;
      napi_create_object(env, &entry);

      set_string(env, entry, "name", addresses[i].name);
      set_bool(env, entry, "isInternal", addresses[i].is_internal != 0);

      int family = addresses[i].address.address4.sin_family;
      set_string(env, entry, "family",
                 family == AF_INET    ? "ipv4"
                 : family == AF_INET6 ? "ipv6"
                                      : "other");

      char ip[64] = {0};
      int ip_rc = uv_ip_name((const struct sockaddr *)&addresses[i].address,
                             ip, sizeof(ip));
      set_int32(env, entry, "addressRc", ip_rc);
      set_string(env, entry, "address", ip);

      napi_set_element(env, arr, i, entry);
    }
    uv_free_interface_addresses(addresses, count);
  }
  napi_set_named_property(env, obj, "interfaces", arr);

  return obj;
}

napi_value Init(napi_env env, napi_value exports) {
  // Register all test functions
  napi_value fn;

  napi_create_function(env, NULL, 0, test_mutex_init_destroy, NULL, &fn);
  napi_set_named_property(env, exports, "testMutexInitDestroy", fn);

  napi_create_function(env, NULL, 0, test_mutex_recursive, NULL, &fn);
  napi_set_named_property(env, exports, "testMutexRecursive", fn);

  napi_create_function(env, NULL, 0, test_mutex_trylock, NULL, &fn);
  napi_set_named_property(env, exports, "testMutexTrylock", fn);

  napi_create_function(env, NULL, 0, test_process_ids, NULL, &fn);
  napi_set_named_property(env, exports, "testProcessIds", fn);

  napi_create_function(env, NULL, 0, test_uv_once, NULL, &fn);
  napi_set_named_property(env, exports, "testUvOnce", fn);

  napi_create_function(env, NULL, 0, test_hrtime, NULL, &fn);
  napi_set_named_property(env, exports, "testHrtime", fn);

  napi_create_function(env, NULL, 0, test_version, NULL, &fn);
  napi_set_named_property(env, exports, "testVersion", fn);

  napi_create_function(env, NULL, 0, test_cwd, NULL, &fn);
  napi_set_named_property(env, exports, "testCwd", fn);

  napi_create_function(env, NULL, 0, test_osfhandle, NULL, &fn);
  napi_set_named_property(env, exports, "testOsfhandle", fn);

  napi_create_function(env, NULL, 0, test_thread_self, NULL, &fn);
  napi_set_named_property(env, exports, "testThreadSelf", fn);

  napi_create_function(env, NULL, 0, test_ip4, NULL, &fn);
  napi_set_named_property(env, exports, "testIp4", fn);

  napi_create_function(env, NULL, 0, test_ip6, NULL, &fn);
  napi_set_named_property(env, exports, "testIp6", fn);

  napi_create_function(env, NULL, 0, test_inet, NULL, &fn);
  napi_set_named_property(env, exports, "testInet", fn);

  napi_create_function(env, NULL, 0, test_cond_signal, NULL, &fn);
  napi_set_named_property(env, exports, "testCondSignal", fn);

  napi_create_function(env, NULL, 0, test_cond_broadcast, NULL, &fn);
  napi_set_named_property(env, exports, "testCondBroadcast", fn);

  napi_create_function(env, NULL, 0, test_cond_timedwait, NULL, &fn);
  napi_set_named_property(env, exports, "testCondTimedwait", fn);

  napi_create_function(env, NULL, 0, test_sem, NULL, &fn);
  napi_set_named_property(env, exports, "testSem", fn);

  napi_create_function(env, NULL, 0, test_rwlock, NULL, &fn);
  napi_set_named_property(env, exports, "testRwlock", fn);

  napi_create_function(env, NULL, 0, test_interface_addresses, NULL, &fn);
  napi_set_named_property(env, exports, "testInterfaceAddresses", fn);

  // Expose the UV_* error codes so the JS side can assert exact return
  // values (they are -errno and differ between Linux and macOS).
  napi_value constants;
  napi_create_object(env, &constants);
  set_int32(env, constants, "UV_EINVAL", UV_EINVAL);
  set_int32(env, constants, "UV_ENOBUFS", UV_ENOBUFS);
  set_int32(env, constants, "UV_EAGAIN", UV_EAGAIN);
  set_int32(env, constants, "UV_EBUSY", UV_EBUSY);
  set_int32(env, constants, "UV_ETIMEDOUT", UV_ETIMEDOUT);
  set_int32(env, constants, "UV_EAFNOSUPPORT", UV_EAFNOSUPPORT);
  set_int32(env, constants, "UV_ENOSPC", UV_ENOSPC);
  napi_set_named_property(env, exports, "constants", constants);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
