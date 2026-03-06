// Standalone reproduction of the SSLConfig intern/deref race.
// Mimics the exact pattern from GlobalRegistry:
//   - Shared map protected by mutex
//   - Refcount on entries (atomic)
//   - deref: fetchSub → if zero → lock mutex → remove → free
//   - intern: lock mutex → find → ref (NO check for zero) → unlock
//
// Build:  cc -fsanitize=address -pthread -O1 -o race_repro race_repro.c
// Run:    ./race_repro
//
// ASAN should report a heap-use-after-free.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include <pthread.h>
#include <unistd.h>

typedef struct {
    atomic_int refcount;
    char *data;  // simulates cert/key strings
} Config;

// Global registry (simplified: single slot instead of map)
static pthread_mutex_t registry_mutex = PTHREAD_MUTEX_INITIALIZER;
static Config *registry_entry = NULL;

static Config *config_create(void) {
    Config *c = malloc(sizeof(Config));
    atomic_store(&c->refcount, 1);
    c->data = strdup("certificate-data-placeholder");
    return c;
}

static void config_destroy(Config *c) {
    // Same as SSLConfig.destroy(): remove from registry, free strings, free struct
    pthread_mutex_lock(&registry_mutex);
    if (registry_entry == c) {
        registry_entry = NULL;
    }
    pthread_mutex_unlock(&registry_mutex);
    free(c->data);
    c->data = NULL;
    free(c);
}

static void config_deref(Config *c) {
    // Same as ThreadSafeRefCount.deref(): fetchSub, if old==1 → destroy
    int old = atomic_fetch_sub(&c->refcount, 1);
    if (old == 1) {
        config_destroy(c);
    }
}

static Config *config_intern(Config *new_config) {
    // Same as GlobalRegistry.intern(): lock, find, ref (BUG: no zero check), unlock
    pthread_mutex_lock(&registry_mutex);
    if (registry_entry != NULL) {
        Config *existing = registry_entry;
        // BUG: ref() without checking if refcount is 0
        // debugAssert(old > 0) is no-op in release builds
        int old = atomic_fetch_add(&existing->refcount, 1);
        (void)old;  // In release bun, debugAssert is no-op
        pthread_mutex_unlock(&registry_mutex);
        // Free the new config since we're returning existing
        free(new_config->data);
        free(new_config);
        return existing;
    }
    registry_entry = new_config;
    pthread_mutex_unlock(&registry_mutex);
    return new_config;
}

// Thread that repeatedly creates configs, interns them, then derefs
static void *worker(void *arg) {
    int id = *(int *)arg;
    for (int i = 0; i < 100000; i++) {
        Config *c = config_create();
        Config *interned = config_intern(c);
        // Simulate using the config (reads data — triggers ASAN if freed)
        if (interned->data != NULL) {
            volatile int len = (int)strlen(interned->data);
            (void)len;
        }
        config_deref(interned);
    }
    return NULL;
}

int main(void) {
    int nthreads = 4;
    pthread_t threads[4];
    int ids[4];

    for (int i = 0; i < nthreads; i++) {
        ids[i] = i;
        pthread_create(&threads[i], NULL, worker, &ids[i]);
    }
    for (int i = 0; i < nthreads; i++) {
        pthread_join(threads[i], NULL);
    }

    printf("Completed without ASAN detecting UAF (race didn't trigger this run)\n");
    return 0;
}
