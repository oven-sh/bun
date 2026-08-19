// Exercises the addon's own unwind tables. On Windows both SEH dispatch and
// longjmp (which MSVC implements with RtlUnwindEx) need the OS to find unwind
// info for every addon frame they cross and to reach the __except/__finally
// handlers it names, which is what `bun build --compile` has to preserve when
// it statically merges this .node file into the exe (see
// test/napi/napi-app/unwind-fixture.js). Plain C so that every handler in this
// addon is __C_specific_handler; C++ exceptions are cxx_eh_addon.cpp's job.

#include <node_api.h>
#include <setjmp.h>
#include <stddef.h>
#include <stdio.h>

#ifdef _MSC_VER
#include <windows.h>
#define NOINLINE __declspec(noinline)
#else
#define NOINLINE __attribute__((noinline))
#endif

#define NODE_API_CALL(env, call)                                               \
  do {                                                                         \
    napi_status status = (call);                                               \
    if (status != napi_ok) {                                                   \
      const napi_extended_error_info *error_info = NULL;                       \
      napi_get_last_error_info((env), &error_info);                            \
      const char *err_message = error_info->error_message;                     \
      bool is_pending;                                                         \
      napi_is_exception_pending((env), &is_pending);                           \
      /* If an exception is already pending, don't rethrow it */               \
      if (!is_pending) {                                                       \
        const char *message =                                                  \
            (err_message == NULL) ? "empty error message" : err_message;       \
        napi_throw_error((env), NULL, message);                                \
      }                                                                        \
      return NULL;                                                             \
    }                                                                          \
  } while (0)

static napi_value make_string(napi_env env, const char *str) {
  napi_value result;
  NODE_API_CALL(env,
                napi_create_string_utf8(env, str, NAPI_AUTO_LENGTH, &result));
  return result;
}

#ifdef _MSC_VER

// Hidden behind a call so the compiler cannot see that the store goes through
// NULL.
static NOINLINE volatile int *null_int_pointer(void) { return NULL; }

// The access violation happens in this non-leaf frame, which the dispatcher
// has to unwind through. It is a callee of the __try block rather than a store
// written inline there because clang-cl's scope tables only cover call sites
// (MSVC covers the whole block), so this shape catches under both compilers.
static NOINLINE void store_through_null(void) { *null_int_pointer() = 1; }

// Catching requires the dispatcher to find this frame's unwind info as well,
// since that is what points at the __except scope table.
static NOINLINE int catch_access_violation(void) {
  int caught = 0;
  __try {
    store_through_null();
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    caught = 1;
  }
  return caught;
}

#endif

static napi_value seh_catch(napi_env env, napi_callback_info info) {
  (void)info;
#ifdef _MSC_VER
  return make_string(env, catch_access_violation() ? "seh: caught"
                                                   : "seh: not caught");
#else
  return make_string(env, "seh: unsupported");
#endif
}

// The jump targets live in the calling frame rather than in statics: the
// Worker fixture calls these functions from several threads at once.

// Each level writes a volatile local array and uses its callee's return value,
// so all three are genuine non-leaf frames with stack space of their own that
// longjmp has to unwind through (no tail calls, nothing folded away).
static NOINLINE int level3(jmp_buf *target) {
  volatile int locals[4];
  locals[0] = 3;
  longjmp(*target, locals[0]);
}

static NOINLINE int level2(jmp_buf *target) {
  volatile int locals[4];
  locals[0] = 2;
  locals[1] = level3(target);
  return locals[0] + locals[1];
}

static NOINLINE int level1(jmp_buf *target) {
  volatile int locals[4];
  locals[0] = 1;
  locals[1] = level2(target);
  return locals[0] + locals[1];
}

static napi_value longjmp_depth(napi_env env, napi_callback_info info) {
  (void)info;
  char message[64];
  jmp_buf target;
  int value = setjmp(target);
  if (value == 0) {
    level1(&target);
    return make_string(env, "longjmp: fell through");
  }
  snprintf(message, sizeof message, "longjmp: %d", value);
  return make_string(env, message);
}

#ifdef _MSC_VER

struct collision {
  jmp_buf first_target;
  jmp_buf second_target;
  volatile int finally_order;
};

// The first longjmp unwinds through both __finally blocks. The inner one
// starts a second unwind while the first is still running this frame's
// handler (a "collided unwind"), which Windows completes by invoking the
// handler again, resuming after the inner block. The outer block therefore
// only runs if that second invocation reaches the addon's handler too.
static NOINLINE void nested_finally(struct collision *c) {
  __try {
    __try {
      longjmp(c->first_target, 1);
    } __finally {
      c->finally_order = c->finally_order * 10 + 1;
      longjmp(c->second_target, 1);
    }
  } __finally {
    c->finally_order = c->finally_order * 10 + 2;
  }
}

#endif

static napi_value collided_unwind(napi_env env, napi_callback_info info) {
  (void)info;
#ifdef _MSC_VER
  char message[64];
  struct collision c;
  c.finally_order = 0;
  if (setjmp(c.first_target) != 0) {
    return make_string(env, "finally: first longjmp completed");
  }
  if (setjmp(c.second_target) == 0) {
    nested_finally(&c);
    return make_string(env, "finally: fell through");
  }
  snprintf(message, sizeof message, "finally: %d", c.finally_order);
  return make_string(env, message);
#else
  return make_string(env, "finally: unsupported");
#endif
}

/* napi_value */ NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_value seh_catch_function;
  NODE_API_CALL(env,
                napi_create_function(env, "seh_catch", NAPI_AUTO_LENGTH,
                                     seh_catch, NULL, &seh_catch_function));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "seh_catch",
                                             seh_catch_function));

  napi_value longjmp_depth_function;
  NODE_API_CALL(env, napi_create_function(env, "longjmp_depth",
                                          NAPI_AUTO_LENGTH, longjmp_depth, NULL,
                                          &longjmp_depth_function));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "longjmp_depth",
                                             longjmp_depth_function));

  napi_value collided_unwind_function;
  NODE_API_CALL(env, napi_create_function(env, "collided_unwind",
                                          NAPI_AUTO_LENGTH, collided_unwind,
                                          NULL, &collided_unwind_function));
  NODE_API_CALL(env, napi_set_named_property(env, exports, "collided_unwind",
                                             collided_unwind_function));
  return exports;
}
