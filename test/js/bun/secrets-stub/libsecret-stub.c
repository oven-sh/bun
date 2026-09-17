// A fake Secret Service stack for the Bun.secrets tests. SecretsLinux.cpp
// dlopens libglib-2.0.so.0, libgobject-2.0.so.0, libgio-2.0.so.0 and
// libsecret-1.so.0 by name, so one build of this file, copied under those four
// names into a directory on LD_LIBRARY_PATH, replaces the whole stack. No GLib
// needs to be installed. BUN_SECRETS_STUB_MODE selects what every call does:
//
//   hang    block until the GCancellable Bun passed is cancelled, then fail
//           (a keyring that never answers, with a libsecret that honors
//           cancellation)
//   never   block forever and ignore the GCancellable
//   return  lookup returns "stub-value"; store and clear succeed
//
// Every call logs one line to stderr so a test can wait for it.
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct _GError GError;
typedef struct _SecretSchema SecretSchema;
typedef int gboolean;
typedef char gchar;
typedef void* gpointer;
typedef unsigned int guint;

// ── GLib / GObject: only what SecretsLinux.cpp dlsyms ─────────────────────

void g_error_free(GError* error) { (void)error; }
void g_free(gpointer mem) { free(mem); }
gpointer g_hash_table_new(gpointer hash_func, gpointer key_equal_func)
{
    (void)hash_func;
    (void)key_equal_func;
    return NULL;
}
void g_hash_table_destroy(gpointer hash_table) { (void)hash_table; }
gpointer g_hash_table_lookup(gpointer hash_table, gpointer key)
{
    (void)hash_table;
    (void)key;
    return NULL;
}
void g_hash_table_insert(gpointer hash_table, gpointer key, gpointer value)
{
    (void)hash_table;
    (void)key;
    (void)value;
}
void g_list_free(gpointer list) { (void)list; }
void g_list_free_full(gpointer list, gpointer free_func)
{
    (void)list;
    (void)free_func;
}
guint g_str_hash(gpointer v) { return (guint)(size_t)v; }
gboolean g_str_equal(gpointer a, gpointer b) { return strcmp(a, b) == 0; }

// ── GIO: a GCancellable is one atomic flag ────────────────────────────────

typedef struct {
    atomic_int cancelled;
} Cancellable;

gpointer g_cancellable_new(void)
{
    return calloc(1, sizeof(Cancellable));
}
void g_cancellable_cancel(gpointer cancellable)
{
    if (cancellable) atomic_store(&((Cancellable*)cancellable)->cancelled, 1);
}
gboolean g_cancellable_is_cancelled(gpointer cancellable)
{
    return cancellable && atomic_load(&((Cancellable*)cancellable)->cancelled);
}
// Bun only ever unrefs the cancellables it created.
void g_object_unref(gpointer object) { free(object); }

// ── libsecret ─────────────────────────────────────────────────────────────

static const char* mode(void)
{
    const char* m = getenv("BUN_SECRETS_STUB_MODE");
    return m ? m : "never";
}

static void log_call(const char* name, gpointer cancellable)
{
    fprintf(stderr, "[stub] %s mode=%s cancellable=%s\n", name, mode(), cancellable ? "yes" : "no");
    fflush(stderr);
}

// Blocks per the mode. Only returns (after logging) once the call was cancelled.
static void block(gpointer cancellable)
{
    if (strcmp(mode(), "hang") != 0 || !cancellable) {
        for (;;) pause();
    }
    while (!g_cancellable_is_cancelled(cancellable)) {
        usleep(5 * 1000);
    }
    fprintf(stderr, "[stub] cancelled\n");
    fflush(stderr);
}

gchar* secret_password_lookup_sync(const SecretSchema* schema, gpointer cancellable, GError** error, ...)
{
    (void)schema;
    (void)error;
    log_call("lookup", cancellable);
    if (strcmp(mode(), "return") == 0) {
        return strdup("stub-value");
    }
    block(cancellable);
    return NULL;
}

gboolean secret_password_store_sync(const SecretSchema* schema, const gchar* collection, const gchar* label,
    const gchar* password, gpointer cancellable, GError** error, ...)
{
    (void)schema;
    (void)collection;
    (void)label;
    (void)password;
    (void)error;
    log_call("store", cancellable);
    if (strcmp(mode(), "return") == 0) {
        return 1;
    }
    block(cancellable);
    return 0;
}

gboolean secret_password_clear_sync(const SecretSchema* schema, gpointer cancellable, GError** error, ...)
{
    (void)schema;
    (void)error;
    log_call("clear", cancellable);
    if (strcmp(mode(), "return") == 0) {
        return 1;
    }
    block(cancellable);
    return 0;
}

void secret_password_free(gchar* password)
{
    free(password);
}
