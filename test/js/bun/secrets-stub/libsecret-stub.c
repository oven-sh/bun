// A fake libsecret-1.so.0 for the Bun.secrets timeout tests. Bun dlopens
// "libsecret-1.so.0", so a directory with this library on LD_LIBRARY_PATH
// replaces the real one. BUN_SECRETS_STUB_MODE selects what every call does:
//
//   hang    block until the GCancellable Bun passed is cancelled, then fail
//           with G_IO_ERROR_CANCELLED (a keyring that never answers, with a
//           libsecret that honors cancellation)
//   never   block forever and ignore the GCancellable
//   return  lookup returns "stub-value"; store and clear succeed
//
// Every call logs one line to stderr so a test can wait for it.
#include <dlfcn.h>
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

#define G_IO_ERROR_CANCELLED 19

static const char* mode(void)
{
    const char* m = getenv("BUN_SECRETS_STUB_MODE");
    return m ? m : "never";
}

static void log_call(const char* name, void* cancellable)
{
    fprintf(stderr, "[stub] %s mode=%s cancellable=%s\n", name, mode(), cancellable ? "yes" : "no");
    fflush(stderr);
}

// Blocks per the mode. Returns 1 when the call was cancelled (error set).
static int block(void* cancellable, GError** error)
{
    if (strcmp(mode(), "hang") != 0) {
        for (;;) pause();
    }

    void* gio = dlopen("libgio-2.0.so.0", RTLD_LAZY | RTLD_LOCAL);
    void* glib = dlopen("libglib-2.0.so.0", RTLD_LAZY | RTLD_LOCAL);
    gboolean (*is_cancelled)(void*) = gio ? (gboolean (*)(void*))dlsym(gio, "g_cancellable_is_cancelled") : NULL;
    guint (*io_error_quark)(void) = gio ? (guint (*)(void))dlsym(gio, "g_io_error_quark") : NULL;
    GError* (*error_new_literal)(guint, int, const char*) = glib ? (GError * (*)(guint, int, const char*)) dlsym(glib, "g_error_new_literal") : NULL;
    if (!cancellable || !is_cancelled || !io_error_quark || !error_new_literal) {
        for (;;) pause();
    }

    while (!is_cancelled(cancellable)) {
        usleep(5 * 1000);
    }
    fprintf(stderr, "[stub] cancelled\n");
    fflush(stderr);
    if (error) {
        *error = error_new_literal(io_error_quark(), G_IO_ERROR_CANCELLED, "Operation was cancelled");
    }
    return 1;
}

gchar* secret_password_lookup_sync(const SecretSchema* schema, void* cancellable, GError** error, ...)
{
    (void)schema;
    log_call("lookup", cancellable);
    if (strcmp(mode(), "return") == 0) {
        return strdup("stub-value");
    }
    block(cancellable, error);
    return NULL;
}

gboolean secret_password_store_sync(const SecretSchema* schema, const gchar* collection, const gchar* label,
    const gchar* password, void* cancellable, GError** error, ...)
{
    (void)schema;
    (void)collection;
    (void)label;
    (void)password;
    log_call("store", cancellable);
    if (strcmp(mode(), "return") == 0) {
        return 1;
    }
    block(cancellable, error);
    return 0;
}

gboolean secret_password_clear_sync(const SecretSchema* schema, void* cancellable, GError** error, ...)
{
    (void)schema;
    log_call("clear", cancellable);
    if (strcmp(mode(), "return") == 0) {
        return 1;
    }
    block(cancellable, error);
    return 0;
}

void secret_password_free(gchar* password)
{
    free(password);
}
