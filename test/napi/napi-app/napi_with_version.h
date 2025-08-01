#pragma once
#define NAPI_EXPERIMENTAL
#include <napi.h>
#include <node.h>

// TODO(@190n): remove this when CI has Node 22.6
typedef struct napi_env__ *napi_env;
typedef napi_env node_api_basic_env;
