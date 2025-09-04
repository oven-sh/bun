// GENERATED CODE ... NO TOUCHY!!
#include <node_api.h>

#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <uv.h>

napi_value call_uv_func(napi_env env, napi_callback_info info) {
  napi_status status;

  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to parse arguments");
    return NULL;
  }

  if (argc < 1) {
    napi_throw_error(env, NULL, "Wrong number of arguments");
    return NULL;
  }

  napi_value arg = args[0];
  char buffer[256];
  size_t buffer_size = sizeof(buffer);
  size_t copied;

  status = napi_get_value_string_utf8(env, arg, buffer, buffer_size, &copied);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to get string value");
    return NULL;
  }

  buffer[copied] = '\0';
  printf("Got string: %s\n", buffer);

  if (strcmp(buffer, "uv_accept") == 0) {
    uv_stream_t *arg0 = {0};
    uv_stream_t *arg1 = {0};

    uv_accept(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_async_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_async_t *arg1 = {0};
    uv_async_cb arg2 = NULL;

    uv_async_init(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_async_send") == 0) {
    uv_async_t *arg0 = {0};

    uv_async_send(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_available_parallelism") == 0) {

    uv_available_parallelism();
    return NULL;
  }

  if (strcmp(buffer, "uv_backend_fd") == 0) {
    const uv_loop_t *arg0 = {0};

    uv_backend_fd(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_backend_timeout") == 0) {
    const uv_loop_t *arg0 = {0};

    uv_backend_timeout(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_barrier_destroy") == 0) {
    uv_barrier_t *arg0 = {0};

    uv_barrier_destroy(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_barrier_init") == 0) {
    uv_barrier_t *arg0 = {0};
    unsigned int arg1 = {0};

    uv_barrier_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_barrier_wait") == 0) {
    uv_barrier_t *arg0 = {0};

    uv_barrier_wait(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_buf_init") == 0) {
    char *arg0 = {0};
    unsigned int arg1 = {0};

    uv_buf_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_cancel") == 0) {
    uv_req_t *arg0 = {0};

    uv_cancel(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_chdir") == 0) {
    const char *arg0 = {0};

    uv_chdir(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_check_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_check_t *arg1 = {0};

    uv_check_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_check_start") == 0) {
    uv_check_t *arg0 = {0};
    uv_check_cb arg1 = NULL;

    uv_check_start(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_check_stop") == 0) {
    uv_check_t *arg0 = {0};

    uv_check_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_clock_gettime") == 0) {
    uv_clock_id arg0 = {0};
    uv_timespec64_t *arg1 = {0};

    uv_clock_gettime(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_close") == 0) {
    uv_handle_t *arg0 = {0};
    uv_close_cb arg1 = NULL;

    uv_close(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_cond_broadcast") == 0) {
    uv_cond_t *arg0 = {0};

    uv_cond_broadcast(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_cond_destroy") == 0) {
    uv_cond_t *arg0 = {0};

    uv_cond_destroy(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_cond_init") == 0) {
    uv_cond_t *arg0 = {0};

    uv_cond_init(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_cond_signal") == 0) {
    uv_cond_t *arg0 = {0};

    uv_cond_signal(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_cond_timedwait") == 0) {
    uv_cond_t *arg0 = {0};
    uv_mutex_t *arg1 = {0};
    uint64_t arg2 = {0};

    uv_cond_timedwait(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_cond_wait") == 0) {
    uv_cond_t *arg0 = {0};
    uv_mutex_t *arg1 = {0};

    uv_cond_wait(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_cpu_info") == 0) {
    uv_cpu_info_t **arg0 = NULL;
    int *arg1 = {0};

    uv_cpu_info(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_cpumask_size") == 0) {

    uv_cpumask_size();
    return NULL;
  }

  if (strcmp(buffer, "uv_cwd") == 0) {
    char *arg0 = {0};
    size_t *arg1 = {0};

    uv_cwd(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_default_loop") == 0) {

    uv_default_loop();
    return NULL;
  }

  if (strcmp(buffer, "uv_disable_stdio_inheritance") == 0) {

    uv_disable_stdio_inheritance();
    return NULL;
  }

  if (strcmp(buffer, "uv_dlclose") == 0) {
    uv_lib_t *arg0 = {0};

    uv_dlclose(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_dlerror") == 0) {
    const uv_lib_t *arg0 = {0};

    uv_dlerror(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_dlopen") == 0) {
    const char *arg0 = {0};
    uv_lib_t *arg1 = {0};

    uv_dlopen(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_dlsym") == 0) {
    uv_lib_t *arg0 = {0};
    const char *arg1 = {0};
    void **arg2 = NULL;

    uv_dlsym(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_err_name") == 0) {
    int arg0 = {0};

    uv_err_name(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_err_name_r") == 0) {
    int arg0 = {0};
    char *arg1 = {0};
    size_t arg2 = {0};

    uv_err_name_r(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_exepath") == 0) {
    char *arg0 = {0};
    size_t *arg1 = {0};

    uv_exepath(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_fileno") == 0) {
    const uv_handle_t *arg0 = {0};
    uv_os_fd_t *arg1 = {0};

    uv_fileno(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_free_cpu_info") == 0) {
    uv_cpu_info_t *arg0 = {0};
    int arg1 = {0};

    uv_free_cpu_info(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_free_interface_addresses") == 0) {
    uv_interface_address_t *arg0 = {0};
    int arg1 = {0};

    uv_free_interface_addresses(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_freeaddrinfo") == 0) {
    struct addrinfo *arg0 = {0};

    uv_freeaddrinfo(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_access") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    int arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_access(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_chmod") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    int arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_chmod(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_chown") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_uid_t arg3 = {0};
    uv_gid_t arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_chown(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_close") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_close(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_closedir") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_dir_t *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_closedir(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_copyfile") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    const char *arg3 = {0};
    int arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_copyfile(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_event_getpath") == 0) {
    uv_fs_event_t *arg0 = {0};
    char *arg1 = {0};
    size_t *arg2 = {0};

    uv_fs_event_getpath(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_event_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_event_t *arg1 = {0};

    uv_fs_event_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_event_start") == 0) {
    uv_fs_event_t *arg0 = {0};
    uv_fs_event_cb arg1 = NULL;
    const char *arg2 = {0};
    unsigned int arg3 = {0};

    uv_fs_event_start(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_event_stop") == 0) {
    uv_fs_event_t *arg0 = {0};

    uv_fs_event_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_fchmod") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    int arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_fchmod(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_fchown") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    uv_uid_t arg3 = {0};
    uv_gid_t arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_fchown(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_fdatasync") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_fdatasync(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_fstat") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_fstat(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_fsync") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_fsync(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_ftruncate") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    int64_t arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_ftruncate(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_futime") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    double arg3 = {0};
    double arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_futime(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_get_path") == 0) {
    const uv_fs_t *arg0 = {0};

    uv_fs_get_path(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_get_ptr") == 0) {
    const uv_fs_t *arg0 = {0};

    uv_fs_get_ptr(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_get_result") == 0) {
    const uv_fs_t *arg0 = {0};

    uv_fs_get_result(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_get_statbuf") == 0) {
    uv_fs_t *arg0 = {0};

    uv_fs_get_statbuf(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_get_system_error") == 0) {
    const uv_fs_t *arg0 = {0};

    uv_fs_get_system_error(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_get_type") == 0) {
    const uv_fs_t *arg0 = {0};

    uv_fs_get_type(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_lchown") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_uid_t arg3 = {0};
    uv_gid_t arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_lchown(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_link") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    const char *arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_link(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_lstat") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_lstat(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_lutime") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    double arg3 = {0};
    double arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_lutime(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_mkdir") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    int arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_mkdir(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_mkdtemp") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_mkdtemp(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_mkstemp") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_mkstemp(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_open") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    int arg3 = {0};
    int arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_open(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_opendir") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_opendir(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_poll_getpath") == 0) {
    uv_fs_poll_t *arg0 = {0};
    char *arg1 = {0};
    size_t *arg2 = {0};

    uv_fs_poll_getpath(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_poll_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_poll_t *arg1 = {0};

    uv_fs_poll_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_poll_start") == 0) {
    uv_fs_poll_t *arg0 = {0};
    uv_fs_poll_cb arg1 = NULL;
    const char *arg2 = {0};
    unsigned int arg3 = {0};

    uv_fs_poll_start(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_poll_stop") == 0) {
    uv_fs_poll_t *arg0 = {0};

    uv_fs_poll_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_read") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    const uv_buf_t *arg3 = {0};
    unsigned int arg4 = {0};
    int64_t arg5 = {0};
    uv_fs_cb arg6 = NULL;

    uv_fs_read(arg0, arg1, arg2, arg3, arg4, arg5, arg6);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_readdir") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_dir_t *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_readdir(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_readlink") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_readlink(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_realpath") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_realpath(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_rename") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    const char *arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_rename(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_req_cleanup") == 0) {
    uv_fs_t *arg0 = {0};

    uv_fs_req_cleanup(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_rmdir") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_rmdir(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_scandir") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    int arg3 = {0};
    uv_fs_cb arg4 = NULL;

    uv_fs_scandir(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_scandir_next") == 0) {
    uv_fs_t *arg0 = {0};
    uv_dirent_t *arg1 = {0};

    uv_fs_scandir_next(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_sendfile") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    uv_file arg3 = {0};
    int64_t arg4 = {0};
    size_t arg5 = {0};
    uv_fs_cb arg6 = NULL;

    uv_fs_sendfile(arg0, arg1, arg2, arg3, arg4, arg5, arg6);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_stat") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_stat(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_statfs") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_statfs(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_symlink") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    const char *arg3 = {0};
    int arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_symlink(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_unlink") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    uv_fs_cb arg3 = NULL;

    uv_fs_unlink(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_utime") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    const char *arg2 = {0};
    double arg3 = {0};
    double arg4 = {0};
    uv_fs_cb arg5 = NULL;

    uv_fs_utime(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_fs_write") == 0) {
    uv_loop_t *arg0 = {0};
    uv_fs_t *arg1 = {0};
    uv_file arg2 = {0};
    const uv_buf_t *arg3 = {0};
    unsigned int arg4 = {0};
    int64_t arg5 = {0};
    uv_fs_cb arg6 = NULL;

    uv_fs_write(arg0, arg1, arg2, arg3, arg4, arg5, arg6);
    return NULL;
  }

  if (strcmp(buffer, "uv_get_available_memory") == 0) {

    uv_get_available_memory();
    return NULL;
  }

  if (strcmp(buffer, "uv_get_constrained_memory") == 0) {

    uv_get_constrained_memory();
    return NULL;
  }

  if (strcmp(buffer, "uv_get_free_memory") == 0) {

    uv_get_free_memory();
    return NULL;
  }

  if (strcmp(buffer, "uv_get_osfhandle") == 0) {
    int arg0 = {0};

    uv_get_osfhandle(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_get_process_title") == 0) {
    char *arg0 = {0};
    size_t arg1 = {0};

    uv_get_process_title(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_get_total_memory") == 0) {

    uv_get_total_memory();
    return NULL;
  }

  if (strcmp(buffer, "uv_getaddrinfo") == 0) {
    uv_loop_t *arg0 = {0};
    uv_getaddrinfo_t *arg1 = {0};
    uv_getaddrinfo_cb arg2 = NULL;
    const char *arg3 = {0};
    const char *arg4 = {0};
    const struct addrinfo *arg5 = {0};

    uv_getaddrinfo(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_getnameinfo") == 0) {
    uv_loop_t *arg0 = {0};
    uv_getnameinfo_t *arg1 = {0};
    uv_getnameinfo_cb arg2 = NULL;
    const struct sockaddr *arg3 = {0};
    int arg4 = {0};

    uv_getnameinfo(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_getrusage") == 0) {
    uv_rusage_t *arg0 = {0};

    uv_getrusage(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_gettimeofday") == 0) {
    uv_timeval64_t *arg0 = {0};

    uv_gettimeofday(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_guess_handle") == 0) {
    uv_file arg0 = {0};

    uv_guess_handle(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_handle_get_data") == 0) {
    const uv_handle_t *arg0 = {0};

    uv_handle_get_data(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_handle_get_loop") == 0) {
    const uv_handle_t *arg0 = {0};

    uv_handle_get_loop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_handle_get_type") == 0) {
    const uv_handle_t *arg0 = {0};

    uv_handle_get_type(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_handle_set_data") == 0) {
    uv_handle_t *arg0 = {0};
    void *arg1 = {0};

    uv_handle_set_data(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_handle_size") == 0) {
    uv_handle_type arg0 = {0};

    uv_handle_size(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_handle_type_name") == 0) {
    uv_handle_type arg0 = {0};

    uv_handle_type_name(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_has_ref") == 0) {
    const uv_handle_t *arg0 = {0};

    uv_has_ref(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_idle_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_idle_t *arg1 = {0};

    uv_idle_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_idle_start") == 0) {
    uv_idle_t *arg0 = {0};
    uv_idle_cb arg1 = NULL;

    uv_idle_start(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_idle_stop") == 0) {
    uv_idle_t *arg0 = {0};

    uv_idle_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_if_indextoiid") == 0) {
    unsigned int arg0 = {0};
    char *arg1 = {0};
    size_t *arg2 = {0};

    uv_if_indextoiid(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_if_indextoname") == 0) {
    unsigned int arg0 = {0};
    char *arg1 = {0};
    size_t *arg2 = {0};

    uv_if_indextoname(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_inet_ntop") == 0) {
    int arg0 = {0};
    const void *arg1 = {0};
    char *arg2 = {0};
    size_t arg3 = {0};

    uv_inet_ntop(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_inet_pton") == 0) {
    int arg0 = {0};
    const char *arg1 = {0};
    void *arg2 = {0};

    uv_inet_pton(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_interface_addresses") == 0) {
    uv_interface_address_t **arg0 = NULL;
    int *arg1 = {0};

    uv_interface_addresses(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_ip4_addr") == 0) {
    const char *arg0 = {0};
    int arg1 = {0};
    struct sockaddr_in *arg2 = {0};

    uv_ip4_addr(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_ip4_name") == 0) {
    const struct sockaddr_in *arg0 = {0};
    char *arg1 = {0};
    size_t arg2 = {0};

    uv_ip4_name(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_ip6_addr") == 0) {
    const char *arg0 = {0};
    int arg1 = {0};
    struct sockaddr_in6 *arg2 = {0};

    uv_ip6_addr(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_ip6_name") == 0) {
    const struct sockaddr_in6 *arg0 = {0};
    char *arg1 = {0};
    size_t arg2 = {0};

    uv_ip6_name(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_ip_name") == 0) {
    const struct sockaddr *arg0 = {0};
    char *arg1 = {0};
    size_t arg2 = {0};

    uv_ip_name(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_is_active") == 0) {
    const uv_handle_t *arg0 = {0};

    uv_is_active(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_is_closing") == 0) {
    const uv_handle_t *arg0 = {0};

    uv_is_closing(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_is_readable") == 0) {
    const uv_stream_t *arg0 = {0};

    uv_is_readable(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_is_writable") == 0) {
    const uv_stream_t *arg0 = {0};

    uv_is_writable(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_key_create") == 0) {
    uv_key_t *arg0 = {0};

    uv_key_create(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_key_delete") == 0) {
    uv_key_t *arg0 = {0};

    uv_key_delete(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_key_get") == 0) {
    uv_key_t *arg0 = {0};

    uv_key_get(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_key_set") == 0) {
    uv_key_t *arg0 = {0};
    void *arg1 = {0};

    uv_key_set(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_kill") == 0) {
    int arg0 = {0};
    int arg1 = {0};

    uv_kill(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_library_shutdown") == 0) {

    uv_library_shutdown();
    return NULL;
  }

  if (strcmp(buffer, "uv_listen") == 0) {
    uv_stream_t *arg0 = {0};
    int arg1 = {0};
    uv_connection_cb arg2 = NULL;

    uv_listen(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_loadavg") == 0) {
    double *arg0 = {0};

    uv_loadavg(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_alive") == 0) {
    const uv_loop_t *arg0 = {0};

    uv_loop_alive(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_close") == 0) {
    uv_loop_t *arg0 = {0};

    uv_loop_close(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_configure") == 0) {
    uv_loop_t *arg0 = {0};
    uv_loop_option arg1 = {0};

    uv_loop_configure(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_delete") == 0) {
    uv_loop_t *arg0 = {0};

    uv_loop_delete(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_fork") == 0) {
    uv_loop_t *arg0 = {0};

    uv_loop_fork(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_get_data") == 0) {
    const uv_loop_t *arg0 = {0};

    uv_loop_get_data(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_init") == 0) {
    uv_loop_t *arg0 = {0};

    uv_loop_init(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_new") == 0) {

    uv_loop_new();
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_set_data") == 0) {
    uv_loop_t *arg0 = {0};
    void *arg1 = {0};

    uv_loop_set_data(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_loop_size") == 0) {

    uv_loop_size();
    return NULL;
  }

  if (strcmp(buffer, "uv_metrics_idle_time") == 0) {
    uv_loop_t *arg0 = {0};

    uv_metrics_idle_time(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_metrics_info") == 0) {
    uv_loop_t *arg0 = {0};
    uv_metrics_t *arg1 = {0};

    uv_metrics_info(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_now") == 0) {
    const uv_loop_t *arg0 = {0};

    uv_now(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_open_osfhandle") == 0) {
    uv_os_fd_t arg0 = {0};

    uv_open_osfhandle(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_environ") == 0) {
    uv_env_item_t **arg0 = NULL;
    int *arg1 = {0};

    uv_os_environ(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_free_environ") == 0) {
    uv_env_item_t *arg0 = {0};
    int arg1 = {0};

    uv_os_free_environ(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_free_group") == 0) {
    uv_group_t *arg0 = {0};

    uv_os_free_group(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_free_passwd") == 0) {
    uv_passwd_t *arg0 = {0};

    uv_os_free_passwd(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_get_group") == 0) {
    uv_group_t *arg0 = {0};
    uv_uid_t arg1 = {0};

    uv_os_get_group(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_get_passwd") == 0) {
    uv_passwd_t *arg0 = {0};

    uv_os_get_passwd(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_get_passwd2") == 0) {
    uv_passwd_t *arg0 = {0};
    uv_uid_t arg1 = {0};

    uv_os_get_passwd2(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_getenv") == 0) {
    const char *arg0 = {0};
    char *arg1 = {0};
    size_t *arg2 = {0};

    uv_os_getenv(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_gethostname") == 0) {
    char *arg0 = {0};
    size_t *arg1 = {0};

    uv_os_gethostname(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_getpriority") == 0) {
    uv_pid_t arg0 = {0};
    int *arg1 = {0};

    uv_os_getpriority(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_homedir") == 0) {
    char *arg0 = {0};
    size_t *arg1 = {0};

    uv_os_homedir(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_setenv") == 0) {
    const char *arg0 = {0};
    const char *arg1 = {0};

    uv_os_setenv(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_setpriority") == 0) {
    uv_pid_t arg0 = {0};
    int arg1 = {0};

    uv_os_setpriority(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_tmpdir") == 0) {
    char *arg0 = {0};
    size_t *arg1 = {0};

    uv_os_tmpdir(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_uname") == 0) {
    uv_utsname_t *arg0 = {0};

    uv_os_uname(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_os_unsetenv") == 0) {
    const char *arg0 = {0};

    uv_os_unsetenv(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe") == 0) {
    uv_file *arg0 = {0};
    int arg1 = {0};
    int arg2 = {0};

    uv_pipe(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_bind") == 0) {
    uv_pipe_t *arg0 = {0};
    const char *arg1 = {0};

    uv_pipe_bind(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_bind2") == 0) {
    uv_pipe_t *arg0 = {0};
    const char *arg1 = {0};
    size_t arg2 = {0};
    unsigned int arg3 = {0};

    uv_pipe_bind2(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_chmod") == 0) {
    uv_pipe_t *arg0 = {0};
    int arg1 = {0};

    uv_pipe_chmod(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_connect") == 0) {
    uv_connect_t *arg0 = {0};
    uv_pipe_t *arg1 = {0};
    const char *arg2 = {0};
    uv_connect_cb arg3 = NULL;

    uv_pipe_connect(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_connect2") == 0) {
    uv_connect_t *arg0 = {0};
    uv_pipe_t *arg1 = {0};
    const char *arg2 = {0};
    size_t arg3 = {0};
    unsigned int arg4 = {0};
    uv_connect_cb arg5 = NULL;

    uv_pipe_connect2(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_getpeername") == 0) {
    const uv_pipe_t *arg0 = {0};
    char *arg1 = {0};
    size_t *arg2 = {0};

    uv_pipe_getpeername(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_getsockname") == 0) {
    const uv_pipe_t *arg0 = {0};
    char *arg1 = {0};
    size_t *arg2 = {0};

    uv_pipe_getsockname(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_pipe_t *arg1 = {0};
    int arg2 = {0};

    uv_pipe_init(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_open") == 0) {
    uv_pipe_t *arg0 = {0};
    uv_file arg1 = {0};

    uv_pipe_open(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_pending_count") == 0) {
    uv_pipe_t *arg0 = {0};

    uv_pipe_pending_count(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_pending_instances") == 0) {
    uv_pipe_t *arg0 = {0};
    int arg1 = {0};

    uv_pipe_pending_instances(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_pipe_pending_type") == 0) {
    uv_pipe_t *arg0 = {0};

    uv_pipe_pending_type(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_poll_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_poll_t *arg1 = {0};
    int arg2 = {0};

    uv_poll_init(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_poll_init_socket") == 0) {
    uv_loop_t *arg0 = {0};
    uv_poll_t *arg1 = {0};
    uv_os_sock_t arg2 = {0};

    uv_poll_init_socket(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_poll_start") == 0) {
    uv_poll_t *arg0 = {0};
    int arg1 = {0};
    uv_poll_cb arg2 = NULL;

    uv_poll_start(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_poll_stop") == 0) {
    uv_poll_t *arg0 = {0};

    uv_poll_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_prepare_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_prepare_t *arg1 = {0};

    uv_prepare_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_prepare_start") == 0) {
    uv_prepare_t *arg0 = {0};
    uv_prepare_cb arg1 = NULL;

    uv_prepare_start(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_prepare_stop") == 0) {
    uv_prepare_t *arg0 = {0};

    uv_prepare_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_print_active_handles") == 0) {
    uv_loop_t *arg0 = {0};
    FILE *arg1 = {0};

    uv_print_active_handles(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_print_all_handles") == 0) {
    uv_loop_t *arg0 = {0};
    FILE *arg1 = {0};

    uv_print_all_handles(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_process_get_pid") == 0) {
    const uv_process_t *arg0 = {0};

    uv_process_get_pid(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_process_kill") == 0) {
    uv_process_t *arg0 = {0};
    int arg1 = {0};

    uv_process_kill(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_queue_work") == 0) {
    uv_loop_t *arg0 = {0};
    uv_work_t *arg1 = {0};
    uv_work_cb arg2 = NULL;
    uv_after_work_cb arg3 = NULL;

    uv_queue_work(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_random") == 0) {
    uv_loop_t *arg0 = {0};
    uv_random_t *arg1 = {0};
    void *arg2 = {0};
    size_t arg3 = {0};
    unsigned arg4 = {0};
    uv_random_cb arg5 = NULL;

    uv_random(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_read_start") == 0) {
    uv_stream_t *arg0 = {0};
    uv_alloc_cb arg1 = NULL;
    uv_read_cb arg2 = NULL;

    uv_read_start(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_read_stop") == 0) {
    uv_stream_t *arg0 = {0};

    uv_read_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_recv_buffer_size") == 0) {
    uv_handle_t *arg0 = {0};
    int *arg1 = {0};

    uv_recv_buffer_size(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_ref") == 0) {
    uv_handle_t *arg0 = {0};

    uv_ref(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_replace_allocator") == 0) {
    uv_malloc_func arg0 = {0};
    uv_realloc_func arg1 = {0};
    uv_calloc_func arg2 = {0};
    uv_free_func arg3 = {0};

    uv_replace_allocator(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_req_get_data") == 0) {
    const uv_req_t *arg0 = {0};

    uv_req_get_data(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_req_get_type") == 0) {
    const uv_req_t *arg0 = {0};

    uv_req_get_type(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_req_set_data") == 0) {
    uv_req_t *arg0 = {0};
    void *arg1 = {0};

    uv_req_set_data(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_req_size") == 0) {
    uv_req_type arg0 = {0};

    uv_req_size(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_req_type_name") == 0) {
    uv_req_type arg0 = {0};

    uv_req_type_name(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_resident_set_memory") == 0) {
    size_t *arg0 = {0};

    uv_resident_set_memory(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_run") == 0) {
    uv_loop_t *arg0 = {0};
    uv_run_mode arg1 = {0};

    uv_run(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_destroy") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_destroy(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_init") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_init(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_rdlock") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_rdlock(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_rdunlock") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_rdunlock(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_tryrdlock") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_tryrdlock(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_trywrlock") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_trywrlock(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_wrlock") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_wrlock(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_rwlock_wrunlock") == 0) {
    uv_rwlock_t *arg0 = {0};

    uv_rwlock_wrunlock(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_sem_destroy") == 0) {
    uv_sem_t *arg0 = {0};

    uv_sem_destroy(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_sem_init") == 0) {
    uv_sem_t *arg0 = {0};
    unsigned int arg1 = {0};

    uv_sem_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_sem_post") == 0) {
    uv_sem_t *arg0 = {0};

    uv_sem_post(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_sem_trywait") == 0) {
    uv_sem_t *arg0 = {0};

    uv_sem_trywait(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_sem_wait") == 0) {
    uv_sem_t *arg0 = {0};

    uv_sem_wait(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_send_buffer_size") == 0) {
    uv_handle_t *arg0 = {0};
    int *arg1 = {0};

    uv_send_buffer_size(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_set_process_title") == 0) {
    const char *arg0 = {0};

    uv_set_process_title(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_setup_args") == 0) {
    int argc;
    ;
    char **argv;
    ;

    uv_setup_args(argc, argv);
    return NULL;
  }

  if (strcmp(buffer, "uv_shutdown") == 0) {
    uv_shutdown_t *arg0 = {0};
    uv_stream_t *arg1 = {0};
    uv_shutdown_cb arg2 = NULL;

    uv_shutdown(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_signal_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_signal_t *arg1 = {0};

    uv_signal_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_signal_start") == 0) {
    uv_signal_t *arg0 = {0};
    uv_signal_cb arg1 = NULL;
    int arg2 = {0};

    uv_signal_start(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_signal_start_oneshot") == 0) {
    uv_signal_t *arg0 = {0};
    uv_signal_cb arg1 = NULL;
    int arg2 = {0};

    uv_signal_start_oneshot(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_signal_stop") == 0) {
    uv_signal_t *arg0 = {0};

    uv_signal_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_sleep") == 0) {
    unsigned int arg0 = {0};

    uv_sleep(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_socketpair") == 0) {
    int arg0 = {0};
    int arg1 = {0};
    uv_os_sock_t *arg2 = {0};
    int arg3 = {0};
    int arg4 = {0};

    uv_socketpair(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_spawn") == 0) {
    uv_loop_t *arg0 = {0};
    uv_process_t *arg1 = {0};
    const uv_process_options_t *arg2 = {0};

    uv_spawn(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_stop") == 0) {
    uv_loop_t *arg0 = {0};

    uv_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_stream_get_write_queue_size") == 0) {
    const uv_stream_t *arg0 = {0};

    uv_stream_get_write_queue_size(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_stream_set_blocking") == 0) {
    uv_stream_t *arg0 = {0};
    int arg1 = {0};

    uv_stream_set_blocking(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_strerror") == 0) {
    int arg0 = {0};

    uv_strerror(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_strerror_r") == 0) {
    int arg0 = {0};
    char *arg1 = {0};
    size_t arg2 = {0};

    uv_strerror_r(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_bind") == 0) {
    uv_tcp_t *arg0 = {0};
    const struct sockaddr *arg1 = {0};
    unsigned int arg2 = {0};

    uv_tcp_bind(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_close_reset") == 0) {
    uv_tcp_t *arg0 = {0};
    uv_close_cb arg1 = NULL;

    uv_tcp_close_reset(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_connect") == 0) {
    uv_connect_t *arg0 = {0};
    uv_tcp_t *arg1 = {0};
    const struct sockaddr *arg2 = {0};
    uv_connect_cb arg3 = NULL;

    uv_tcp_connect(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_getpeername") == 0) {
    const uv_tcp_t *arg0 = {0};
    struct sockaddr *arg1 = {0};
    int *arg2 = {0};

    uv_tcp_getpeername(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_getsockname") == 0) {
    const uv_tcp_t *arg0 = {0};
    struct sockaddr *arg1 = {0};
    int *arg2 = {0};

    uv_tcp_getsockname(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_tcp_t *arg1 = {0};

    uv_tcp_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_init_ex") == 0) {
    uv_loop_t *arg0 = {0};
    uv_tcp_t *arg1 = {0};
    unsigned int arg2 = {0};

    uv_tcp_init_ex(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_keepalive") == 0) {
    uv_tcp_t *arg0 = {0};
    int arg1 = {0};
    unsigned int arg2 = {0};

    uv_tcp_keepalive(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_nodelay") == 0) {
    uv_tcp_t *arg0 = {0};
    int arg1 = {0};

    uv_tcp_nodelay(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_open") == 0) {
    uv_tcp_t *arg0 = {0};
    uv_os_sock_t arg1 = {0};

    uv_tcp_open(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_tcp_simultaneous_accepts") == 0) {
    uv_tcp_t *arg0 = {0};
    int arg1 = {0};

    uv_tcp_simultaneous_accepts(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_create") == 0) {
    uv_thread_t *arg0 = {0};
    uv_thread_cb arg1 = NULL;
    void *arg2 = {0};

    uv_thread_create(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_create_ex") == 0) {
    uv_thread_t *arg0 = {0};
    const uv_thread_options_t *arg1 = {0};
    uv_thread_cb arg2 = NULL;
    void *arg3 = {0};

    uv_thread_create_ex(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_equal") == 0) {
    const uv_thread_t *arg0 = {0};
    const uv_thread_t *arg1 = {0};

    uv_thread_equal(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_getaffinity") == 0) {
    uv_thread_t *arg0 = {0};
    char *arg1 = {0};
    size_t arg2 = {0};

    uv_thread_getaffinity(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_getcpu") == 0) {

    uv_thread_getcpu();
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_join") == 0) {
    uv_thread_t *arg0 = {0};

    uv_thread_join(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_self") == 0) {

    uv_thread_self();
    return NULL;
  }

  if (strcmp(buffer, "uv_thread_setaffinity") == 0) {
    uv_thread_t *arg0 = {0};
    char *arg1 = {0};
    char *arg2 = {0};
    size_t arg3 = {0};

    uv_thread_setaffinity(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_timer_again") == 0) {
    uv_timer_t *arg0 = {0};

    uv_timer_again(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_timer_get_due_in") == 0) {
    const uv_timer_t *arg0 = {0};

    uv_timer_get_due_in(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_timer_get_repeat") == 0) {
    const uv_timer_t *arg0 = {0};

    uv_timer_get_repeat(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_timer_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_timer_t *arg1 = {0};

    uv_timer_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_timer_set_repeat") == 0) {
    uv_timer_t *arg0 = {0};
    uint64_t arg1 = {0};

    uv_timer_set_repeat(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_timer_start") == 0) {
    uv_timer_t *arg0 = {0};
    uv_timer_cb arg1 = NULL;
    uint64_t arg2 = {0};
    uint64_t arg3 = {0};

    uv_timer_start(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_timer_stop") == 0) {
    uv_timer_t *arg0 = {0};

    uv_timer_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_translate_sys_error") == 0) {
    int arg0 = {0};

    uv_translate_sys_error(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_try_write") == 0) {
    uv_stream_t *arg0 = {0};
    const uv_buf_t *arg1 = {0};
    unsigned int arg2 = {0};

    uv_try_write(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_try_write2") == 0) {
    uv_stream_t *arg0 = {0};
    const uv_buf_t *arg1 = {0};
    unsigned int arg2 = {0};
    uv_stream_t *arg3 = {0};

    uv_try_write2(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_tty_get_vterm_state") == 0) {
    uv_tty_vtermstate_t *arg0 = {0};

    uv_tty_get_vterm_state(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_tty_get_winsize") == 0) {
    uv_tty_t *arg0 = {0};
    int *arg1 = {0};
    int *arg2 = {0};

    uv_tty_get_winsize(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_tty_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_tty_t *arg1 = {0};
    uv_file arg2 = {0};
    int arg3 = {0};

    uv_tty_init(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_tty_set_mode") == 0) {
    uv_tty_t *arg0 = {0};
    uv_tty_mode_t arg1 = {0};

    uv_tty_set_mode(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_tty_set_vterm_state") == 0) {
    uv_tty_vtermstate_t arg0 = {0};

    uv_tty_set_vterm_state(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_bind") == 0) {
    uv_udp_t *arg0 = {0};
    const struct sockaddr *arg1 = {0};
    unsigned int arg2 = {0};

    uv_udp_bind(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_connect") == 0) {
    uv_udp_t *arg0 = {0};
    const struct sockaddr *arg1 = {0};

    uv_udp_connect(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_get_send_queue_count") == 0) {
    const uv_udp_t *arg0 = {0};

    uv_udp_get_send_queue_count(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_get_send_queue_size") == 0) {
    const uv_udp_t *arg0 = {0};

    uv_udp_get_send_queue_size(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_getpeername") == 0) {
    const uv_udp_t *arg0 = {0};
    struct sockaddr *arg1 = {0};
    int *arg2 = {0};

    uv_udp_getpeername(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_getsockname") == 0) {
    const uv_udp_t *arg0 = {0};
    struct sockaddr *arg1 = {0};
    int *arg2 = {0};

    uv_udp_getsockname(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_init") == 0) {
    uv_loop_t *arg0 = {0};
    uv_udp_t *arg1 = {0};

    uv_udp_init(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_init_ex") == 0) {
    uv_loop_t *arg0 = {0};
    uv_udp_t *arg1 = {0};
    unsigned int arg2 = {0};

    uv_udp_init_ex(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_open") == 0) {
    uv_udp_t *arg0 = {0};
    uv_os_sock_t arg1 = {0};

    uv_udp_open(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_recv_start") == 0) {
    uv_udp_t *arg0 = {0};
    uv_alloc_cb arg1 = NULL;
    uv_udp_recv_cb arg2 = NULL;

    uv_udp_recv_start(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_recv_stop") == 0) {
    uv_udp_t *arg0 = {0};

    uv_udp_recv_stop(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_send") == 0) {
    uv_udp_send_t *arg0 = {0};
    uv_udp_t *arg1 = {0};
    const uv_buf_t *arg2 = {0};
    unsigned int arg3 = {0};
    const struct sockaddr *arg4 = {0};
    uv_udp_send_cb arg5 = NULL;

    uv_udp_send(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_set_broadcast") == 0) {
    uv_udp_t *arg0 = {0};
    int arg1 = {0};

    uv_udp_set_broadcast(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_set_membership") == 0) {
    uv_udp_t *arg0 = {0};
    const char *arg1 = {0};
    const char *arg2 = {0};
    uv_membership arg3 = {0};

    uv_udp_set_membership(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_set_multicast_interface") == 0) {
    uv_udp_t *arg0 = {0};
    const char *arg1 = {0};

    uv_udp_set_multicast_interface(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_set_multicast_loop") == 0) {
    uv_udp_t *arg0 = {0};
    int arg1 = {0};

    uv_udp_set_multicast_loop(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_set_multicast_ttl") == 0) {
    uv_udp_t *arg0 = {0};
    int arg1 = {0};

    uv_udp_set_multicast_ttl(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_set_source_membership") == 0) {
    uv_udp_t *arg0 = {0};
    const char *arg1 = {0};
    const char *arg2 = {0};
    const char *arg3 = {0};
    uv_membership arg4 = {0};

    uv_udp_set_source_membership(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_set_ttl") == 0) {
    uv_udp_t *arg0 = {0};
    int arg1 = {0};

    uv_udp_set_ttl(arg0, arg1);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_try_send") == 0) {
    uv_udp_t *arg0 = {0};
    const uv_buf_t *arg1 = {0};
    unsigned int arg2 = {0};
    const struct sockaddr *arg3 = {0};

    uv_udp_try_send(arg0, arg1, arg2, arg3);
    return NULL;
  }

  if (strcmp(buffer, "uv_udp_using_recvmmsg") == 0) {
    const uv_udp_t *arg0 = {0};

    uv_udp_using_recvmmsg(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_unref") == 0) {
    uv_handle_t *arg0 = {0};

    uv_unref(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_update_time") == 0) {
    uv_loop_t *arg0 = {0};

    uv_update_time(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_uptime") == 0) {
    double *arg0 = {0};

    uv_uptime(arg0);
    return NULL;
  }

  if (strcmp(buffer, "uv_version") == 0) {

    uv_version();
    return NULL;
  }

  if (strcmp(buffer, "uv_version_string") == 0) {

    uv_version_string();
    return NULL;
  }

  if (strcmp(buffer, "uv_walk") == 0) {
    uv_loop_t *arg0 = {0};
    uv_walk_cb arg1 = NULL;
    void *arg2 = {0};

    uv_walk(arg0, arg1, arg2);
    return NULL;
  }

  if (strcmp(buffer, "uv_write") == 0) {
    uv_write_t *arg0 = {0};
    uv_stream_t *arg1 = {0};
    const uv_buf_t *arg2 = {0};
    unsigned int arg3 = {0};
    uv_write_cb arg4 = NULL;

    uv_write(arg0, arg1, arg2, arg3, arg4);
    return NULL;
  }

  if (strcmp(buffer, "uv_write2") == 0) {
    uv_write_t *arg0 = {0};
    uv_stream_t *arg1 = {0};
    const uv_buf_t *arg2 = {0};
    unsigned int arg3 = {0};
    uv_stream_t *arg4 = {0};
    uv_write_cb arg5 = NULL;

    uv_write2(arg0, arg1, arg2, arg3, arg4, arg5);
    return NULL;
  }

  napi_throw_error(env, NULL, "Function not found");

  return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_status status;
  napi_value fn_call_uv_func;

  // Register call_uv_func function
  status =
      napi_create_function(env, NULL, 0, call_uv_func, NULL, &fn_call_uv_func);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to create call_uv_func function");
    return NULL;
  }

  status = napi_set_named_property(env, exports, "callUVFunc", fn_call_uv_func);
  if (status != napi_ok) {
    napi_throw_error(env, NULL,
                     "Failed to add call_uv_func function to exports");
    return NULL;
  }

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
