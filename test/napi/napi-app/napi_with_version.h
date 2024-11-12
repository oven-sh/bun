#pragma once
#define NAPI_EXPERIMENTAL
#include <napi.h>
#include <node.h>

// TODO(@190n): remove this when CI has Node 22.6
typedef node_api_nogc_env node_api_basic_env;
