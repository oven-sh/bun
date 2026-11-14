// Stands in for libvulkan.so.1. It counts what the driver is asked for, and makes it fail.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

enum { SUCCESS = 0, NOT_READY = 1, DEVICE_LOST = -4 };
typedef uint64_t Handle;
typedef const void *In;

#define COUNT(name)                                                                                \
  static atomic_int name##Count;                                                                   \
  int name(void) { return name##Count; }
#define WRAP(Result, name, ...)                                                                    \
  static Result (*real_##name)(__VA_ARGS__);                                                       \
  static Result wrap_##name(__VA_ARGS__)
#define CREATE(name, live)                                                                         \
  WRAP(int, name, void *owner, In info, In allocator, Handle *handle) {                            \
    int result = real_##name(owner, info, allocator, handle);                                      \
    live##Count += result == SUCCESS;                                                              \
    return result;                                                                                 \
  }
#define CREATE_PIPELINES(name)                                                                     \
  WRAP(int, name, void *device, Handle cache, uint32_t count, In info, In allocator, Handle *out) { \
    int result = real_##name(device, cache, count, info, allocator, out);                          \
    pipelinesCount += result == SUCCESS ? count : 0;                                               \
    return result;                                                                                 \
  }
#define DESTROY(name, live)                                                                        \
  WRAP(void, name, void *device, Handle handle, In allocator) {                                    \
    real_##name(device, handle, allocator);                                                        \
    live##Count -= handle != 0;                                                                    \
  }

// How many there are.
COUNT(descriptorPools) CREATE(vkCreateDescriptorPool, descriptorPools) DESTROY(vkDestroyDescriptorPool, descriptorPools)
COUNT(images) CREATE(vkCreateImage, images) DESTROY(vkDestroyImage, images)
COUNT(memoryBlocks) CREATE(vkAllocateMemory, memoryBlocks)
COUNT(queryPools) CREATE(vkCreateQueryPool, queryPools) DESTROY(vkDestroyQueryPool, queryPools)
COUNT(samplers) CREATE(vkCreateSampler, samplers) DESTROY(vkDestroySampler, samplers)
COUNT(pipelines) CREATE_PIPELINES(vkCreateComputePipelines) CREATE_PIPELINES(vkCreateGraphicsPipelines) DESTROY(vkDestroyPipeline, pipelines)
COUNT(devices) CREATE(vkCreateDevice, devices)

WRAP(void, vkDestroyDevice, void *device, In allocator) {
  real_vkDestroyDevice(device, allocator);
  devicesCount -= device != NULL;
}

// How many there have been.
COUNT(frees) COUNT(looks) COUNT(submits) COUNT(waits)

WRAP(void, vkFreeMemory, void *device, Handle memory, In allocator) {
  real_vkFreeMemory(device, memory, allocator);
  memoryBlocksCount -= memory != 0;
  freesCount += memory != 0;
}

WRAP(int, vkQueueSubmit, void *queue, uint32_t count, In submits, Handle fence) {
  submitsCount++;
  return real_vkQueueSubmit(queue, count, submits, fence);
}

static atomic_int resultOfWaits, firstHeldWait, looksUntilLost, looksUntilFinished;

void failWaits(int result) { resultOfWaits = result; }

// Counted from 1. 0 lets them go.
void holdWaitsFrom(int wait) { firstHeldWait = wait; }

// Waits know at once. A look at a fence finds it not ready for a while.
void loseDevice(int looks) {
  looksUntilLost = looks;
  resultOfWaits = DEVICE_LOST;
}

// The look after those finds it ready.
void findNotReady(int looks) { looksUntilFinished = looks + 1; }

WRAP(int, vkWaitForFences, void *device, uint32_t count, const Handle *fences, uint32_t all, uint64_t timeout) {
  for (int wait = ++waitsCount; firstHeldWait && wait >= firstHeldWait;)
    usleep(1000);
  return resultOfWaits ? resultOfWaits : real_vkWaitForFences(device, count, fences, all, timeout);
}

WRAP(int, vkGetFenceStatus, void *device, Handle fence) {
  looksCount++;
  if (resultOfWaits == DEVICE_LOST)
    return looksUntilLost-- > 0 ? NOT_READY : DEVICE_LOST;
  if (looksUntilFinished == 0)
    return real_vkGetFenceStatus(device, fence);
  return --looksUntilFinished ? NOT_READY : real_vkWaitForFences(device, 1, &fence, 1, UINT64_MAX);
}

// Those that do not ask for a size of stack get one that does not fit.
void failThreads(int fail) {
  pthread_attr_t attributes;
  pthread_attr_init(&attributes);
  pthread_attr_setstacksize(&attributes, (size_t)1 << (fail ? 60 : 23));
  pthread_setattr_default_np(&attributes);
}

static void *intercept(const char *name, void *real);

WRAP(void *, vkGetDeviceProcAddr, void *device, const char *name) {
  return intercept(name, real_vkGetDeviceProcAddr(device, name));
}

static void *intercept(const char *name, void *real) {
#define X(function)                                                                                \
  if (real && !strcmp(name, #function)) {                                                          \
    real_##function = real;                                                                        \
    return wrap_##function;                                                                        \
  }
  X(vkAllocateMemory) X(vkFreeMemory)
  X(vkCreateComputePipelines) X(vkCreateGraphicsPipelines) X(vkDestroyPipeline)
  X(vkCreateDescriptorPool) X(vkDestroyDescriptorPool)
  X(vkCreateDevice) X(vkDestroyDevice)
  X(vkCreateImage) X(vkDestroyImage)
  X(vkCreateQueryPool) X(vkDestroyQueryPool)
  X(vkCreateSampler) X(vkDestroySampler)
  X(vkGetDeviceProcAddr) X(vkGetFenceStatus) X(vkQueueSubmit) X(vkWaitForFences)
  return real;
}

void *vkGetInstanceProcAddr(void *instance, const char *name) {
  static void *(*real)(void *, const char *);
  if (!real)
    real = dlsym(dlopen(getenv("VULKAN_LOADER"), RTLD_NOW), "vkGetInstanceProcAddr");
  return intercept(name, real(instance, name));
}
