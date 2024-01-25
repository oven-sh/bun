#define HAS_ARGUMENTS
#define USES_FLOAT 1
// This file is part of Bun!
// You can find the original source:
// https://github.com/oven-sh/bun/blob/main/src/bun.js/api/FFI.h
//
// clang-format off
// This file is only compatible with 64 bit CPUs
// It must be kept in sync with JSCJSValue.h
// https://github.com/oven-sh/WebKit/blob/main/Source/JavaScriptCore/runtime/JSCJSValue.h
#ifdef IS_CALLBACK
#define INJECT_BEFORE int c = 500; // This is a callback, so we need to inject code before the call
#endif
#define IS_BIG_ENDIAN 0
#define USE_JSVALUE64 1
#define USE_JSVALUE32_64 0

#define ZIG_REPR_TYPE int64_t


// /* 7.18.1.1  Exact-width integer types */
typedef unsigned char uint8_t;
typedef signed char int8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef unsigned long long size_t;
typedef long intptr_t;
typedef uint64_t uintptr_t;
typedef _Bool bool;

#define true 1
#define false 0


#ifdef INJECT_BEFORE
// #include <stdint.h>
#endif
// #include <tcclib.h>

// This value is 2^49, used to encode doubles such that the encoded value will
// begin with a 15-bit pattern within the range 0x0002..0xFFFC.
#define DoubleEncodeOffsetBit 49
#define DoubleEncodeOffset    (1ll << DoubleEncodeOffsetBit)
#define OtherTag              0x2
#define BoolTag               0x4
#define UndefinedTag          0x8
#define TagValueFalse            (OtherTag | BoolTag | false)
#define TagValueTrue             (OtherTag | BoolTag | true)
#define TagValueUndefined        (OtherTag | UndefinedTag)
#define TagValueNull             (OtherTag)
#define NotCellMask  NumberTag | OtherTag

#define MAX_INT32 2147483648
#define MAX_INT52 9007199254740991

// If all bits in the mask are set, this indicates an integer number,
// if any but not all are set this value is a double precision number.
#define NumberTag 0xfffe000000000000ll

typedef  void* JSCell;

typedef union EncodedJSValue {
  int64_t asInt64;

#if USE_JSVALUE64
  JSCell *ptr;
#endif

#if IS_BIG_ENDIAN
  struct {
    int32_t tag;
    int32_t payload;
  } asBits;
#else
  struct {
    int32_t payload;
    int32_t tag;
  } asBits;
#endif

  void* asPtr;
  double asDouble;

  ZIG_REPR_TYPE asZigRepr;
} EncodedJSValue;

EncodedJSValue ValueUndefined = { TagValueUndefined };
EncodedJSValue ValueTrue = { TagValueTrue };

typedef void* JSContext;

// Bun_FFI_PointerOffsetToArgumentsList is injected into the build 
// The value is generated in `make sizegen`
// The value is 6.
// On ARM64_32, the value is something else but it really doesn't matter for our case
// However, I don't want this to subtly break amidst future upgrades to JavaScriptCore
#define LOAD_ARGUMENTS_FROM_CALL_FRAME \
  int64_t *argsPtr = (int64_t*)((size_t*)callFrame + Bun_FFI_PointerOffsetToArgumentsList)


#ifdef IS_CALLBACK
void* callback_ctx;
ZIG_REPR_TYPE FFI_Callback_call(void* ctx, size_t argCount, ZIG_REPR_TYPE* args);
// We wrap 
static EncodedJSValue _FFI_Callback_call(void* ctx, size_t argCount, ZIG_REPR_TYPE* args)  __attribute__((__always_inline__));
static EncodedJSValue _FFI_Callback_call(void* ctx, size_t argCount, ZIG_REPR_TYPE* args) {
  EncodedJSValue return_value;
  return_value.asZigRepr = FFI_Callback_call(ctx, argCount, args);
  return return_value;
}
#endif

static bool JSVALUE_IS_CELL(EncodedJSValue val) __attribute__((__always_inline__));
static bool JSVALUE_IS_INT32(EncodedJSValue val) __attribute__((__always_inline__)); 
static bool JSVALUE_IS_NUMBER(EncodedJSValue val) __attribute__((__always_inline__));

static uint64_t JSVALUE_TO_UINT64(EncodedJSValue value) __attribute__((__always_inline__));
static int64_t  JSVALUE_TO_INT64(EncodedJSValue value) __attribute__((__always_inline__));
uint64_t JSVALUE_TO_UINT64_SLOW(EncodedJSValue value);
int64_t  JSVALUE_TO_INT64_SLOW(EncodedJSValue value);

EncodedJSValue UINT64_TO_JSVALUE_SLOW(void* jsGlobalObject, uint64_t val);
EncodedJSValue INT64_TO_JSVALUE_SLOW(void* jsGlobalObject, int64_t val);
static EncodedJSValue UINT64_TO_JSVALUE(void* jsGlobalObject, uint64_t val) __attribute__((__always_inline__));
static EncodedJSValue INT64_TO_JSVALUE(void* jsGlobalObject, int64_t val) __attribute__((__always_inline__));


static EncodedJSValue INT32_TO_JSVALUE(int32_t val) __attribute__((__always_inline__));
static EncodedJSValue DOUBLE_TO_JSVALUE(double val) __attribute__((__always_inline__));
static EncodedJSValue FLOAT_TO_JSVALUE(float val) __attribute__((__always_inline__));
static EncodedJSValue BOOLEAN_TO_JSVALUE(bool val) __attribute__((__always_inline__));
static EncodedJSValue PTR_TO_JSVALUE(void* ptr) __attribute__((__always_inline__));

static void* JSVALUE_TO_PTR(EncodedJSValue val) __attribute__((__always_inline__));
static int32_t JSVALUE_TO_INT32(EncodedJSValue val) __attribute__((__always_inline__));
static float JSVALUE_TO_FLOAT(EncodedJSValue val) __attribute__((__always_inline__));
static double JSVALUE_TO_DOUBLE(EncodedJSValue val) __attribute__((__always_inline__));
static bool JSVALUE_TO_BOOL(EncodedJSValue val) __attribute__((__always_inline__));

static bool JSVALUE_IS_CELL(EncodedJSValue val) {
  return !(val.asInt64 & NotCellMask);
}

static bool JSVALUE_IS_INT32(EncodedJSValue val) {
  return (val.asInt64 & NumberTag) == NumberTag;
}

static bool JSVALUE_IS_NUMBER(EncodedJSValue val) {
  return val.asInt64 & NumberTag;
}


// JSValue numbers-as-pointers are represented as a 52-bit integer
// Previously, the pointer was stored at the end of the 64-bit value
// Now, they're stored at the beginning of the 64-bit value
// This behavior change enables the JIT to handle it better
// It also is better readability when console.log(myPtr)
static void* JSVALUE_TO_PTR(EncodedJSValue val) {
  if (val.asInt64 == TagValueNull)
    return 0;
  val.asInt64 -= DoubleEncodeOffset;
  size_t ptr = (size_t)val.asDouble;
  return (void*)ptr;
}

static EncodedJSValue PTR_TO_JSVALUE(void* ptr) {
  EncodedJSValue val;
  if (ptr == 0)
  {
      val.asInt64 = TagValueNull;
      return val;
  }

  val.asDouble = (double)(size_t)ptr;
  val.asInt64 += DoubleEncodeOffset;
  return val;
}

static EncodedJSValue DOUBLE_TO_JSVALUE(double val) {
   EncodedJSValue res;
   res.asDouble = val;
   res.asInt64 += DoubleEncodeOffset;
   return res;
}

static int32_t JSVALUE_TO_INT32(EncodedJSValue val) {
  return val.asInt64;
}

static EncodedJSValue INT32_TO_JSVALUE(int32_t val) {
   EncodedJSValue res;
   res.asInt64 = NumberTag | (uint32_t)val;
   return res;
}

static EncodedJSValue UINT32_TO_JSVALUE(uint32_t val) {
  EncodedJSValue res;
  if(val <= MAX_INT32) {
    res.asInt64 = NumberTag | val;
    return res;
  } else {
    EncodedJSValue res;
    res.asDouble = val;
    res.asInt64 += DoubleEncodeOffset;
    return res;
  }
}

static EncodedJSValue FLOAT_TO_JSVALUE(float val) {
  return DOUBLE_TO_JSVALUE((double)val);
}

static EncodedJSValue BOOLEAN_TO_JSVALUE(bool val) {
  EncodedJSValue res;
  res.asInt64 = val ? TagValueTrue : TagValueFalse;
  return res;
}


static double JSVALUE_TO_DOUBLE(EncodedJSValue val) {
  val.asInt64 -= DoubleEncodeOffset;
  return val.asDouble;
}

static float JSVALUE_TO_FLOAT(EncodedJSValue val) {
  return (float)JSVALUE_TO_DOUBLE(val);
}

static bool JSVALUE_TO_BOOL(EncodedJSValue val) {
  return val.asInt64 == TagValueTrue;
}


static uint64_t JSVALUE_TO_UINT64(EncodedJSValue value) {
  if (JSVALUE_IS_INT32(value)) {
    return (uint64_t)JSVALUE_TO_INT32(value);
  }

  if (JSVALUE_IS_NUMBER(value)) {
    return (uint64_t)JSVALUE_TO_DOUBLE(value);
  }

  return JSVALUE_TO_UINT64_SLOW(value);
}
static int64_t JSVALUE_TO_INT64(EncodedJSValue value) {
  if (JSVALUE_IS_INT32(value)) {
    return (int64_t)JSVALUE_TO_INT32(value);
  }

  if (JSVALUE_IS_NUMBER(value)) {
    return (int64_t)JSVALUE_TO_DOUBLE(value);
  }

  return JSVALUE_TO_INT64_SLOW(value);
}

static EncodedJSValue UINT64_TO_JSVALUE(void* jsGlobalObject, uint64_t val) {
  if (val < MAX_INT32) {
    return INT32_TO_JSVALUE((int32_t)val);
  }

  if (val < MAX_INT52) {
    return DOUBLE_TO_JSVALUE((double)val);
  }

  return UINT64_TO_JSVALUE_SLOW(jsGlobalObject, val);
}

static EncodedJSValue INT64_TO_JSVALUE(void* jsGlobalObject, int64_t val) {
  if (val >= -MAX_INT32 && val <= MAX_INT32) {
    return INT32_TO_JSVALUE((int32_t)val);
  }

  if (val >= -MAX_INT52 && val <= MAX_INT52) {
    return DOUBLE_TO_JSVALUE((double)val);
  }

  return INT64_TO_JSVALUE_SLOW(jsGlobalObject, val);
}

#ifndef IS_CALLBACK
ZIG_REPR_TYPE JSFunctionCall(void* jsGlobalObject, void* callFrame);

#endif


// --- Generated Code ---
/* --- The Function To Call */
float not_a_callback(float arg0);

/* ---- Your Wrapper Function ---- */
ZIG_REPR_TYPE JSFunctionCall(void* JS_GLOBAL_OBJECT, void* callFrame) {
  LOAD_ARGUMENTS_FROM_CALL_FRAME;
  EncodedJSValue arg0;
  arg0.asInt64 = *argsPtr;
    float return_value = not_a_callback(    JSVALUE_TO_FLOAT(arg0));

    return FLOAT_TO_JSVALUE(return_value).asZigRepr;
}

