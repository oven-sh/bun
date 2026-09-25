#include "node_api.h"

struct ValidationException {
  int value;
};

static volatile int validation_seed = 41;

static int throw_and_catch() {
  try {
    throw ValidationException{validation_seed};
  } catch (const ValidationException &exception) {
    return exception.value + 1;
  }
}

NAPI_MODULE_INIT() {
  napi_value caught;
  if (napi_create_int32(env, throw_and_catch(), &caught) != napi_ok)
    return nullptr;
  if (napi_set_named_property(env, exports, "caught", caught) != napi_ok)
    return nullptr;
  return exports;
}
