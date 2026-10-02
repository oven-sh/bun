// GENERATED CODE - DO NOT MODIFY BY HAND
#include <node_api.h>

#include <stdio.h>
#include <string.h>

#define UV_FUNCTIONS(X)                                                        \
  X(uv_accept)                                                                 \
  X(uv_async_init)                                                             \
  X(uv_async_send)                                                             \
  X(uv_available_parallelism)                                                  \
  X(uv_backend_fd)                                                             \
  X(uv_backend_timeout)                                                        \
  X(uv_barrier_destroy)                                                        \
  X(uv_barrier_init)                                                           \
  X(uv_barrier_wait)                                                           \
  X(uv_buf_init)                                                               \
  X(uv_cancel)                                                                 \
  X(uv_chdir)                                                                  \
  X(uv_check_init)                                                             \
  X(uv_check_start)                                                            \
  X(uv_check_stop)                                                             \
  X(uv_clock_gettime)                                                          \
  X(uv_close)                                                                  \
  X(uv_cond_broadcast)                                                         \
  X(uv_cond_destroy)                                                           \
  X(uv_cond_init)                                                              \
  X(uv_cond_signal)                                                            \
  X(uv_cond_timedwait)                                                         \
  X(uv_cond_wait)                                                              \
  X(uv_cpu_info)                                                               \
  X(uv_cpumask_size)                                                           \
  X(uv_cwd)                                                                    \
  X(uv_default_loop)                                                           \
  X(uv_disable_stdio_inheritance)                                              \
  X(uv_dlclose)                                                                \
  X(uv_dlerror)                                                                \
  X(uv_dlopen)                                                                 \
  X(uv_dlsym)                                                                  \
  X(uv_err_name)                                                               \
  X(uv_err_name_r)                                                             \
  X(uv_exepath)                                                                \
  X(uv_fileno)                                                                 \
  X(uv_free_cpu_info)                                                          \
  X(uv_free_interface_addresses)                                               \
  X(uv_freeaddrinfo)                                                           \
  X(uv_fs_access)                                                              \
  X(uv_fs_chmod)                                                               \
  X(uv_fs_chown)                                                               \
  X(uv_fs_close)                                                               \
  X(uv_fs_closedir)                                                            \
  X(uv_fs_copyfile)                                                            \
  X(uv_fs_event_getpath)                                                       \
  X(uv_fs_event_init)                                                          \
  X(uv_fs_event_start)                                                         \
  X(uv_fs_event_stop)                                                          \
  X(uv_fs_fchmod)                                                              \
  X(uv_fs_fchown)                                                              \
  X(uv_fs_fdatasync)                                                           \
  X(uv_fs_fstat)                                                               \
  X(uv_fs_fsync)                                                               \
  X(uv_fs_ftruncate)                                                           \
  X(uv_fs_futime)                                                              \
  X(uv_fs_get_path)                                                            \
  X(uv_fs_get_ptr)                                                             \
  X(uv_fs_get_result)                                                          \
  X(uv_fs_get_statbuf)                                                         \
  X(uv_fs_get_system_error)                                                    \
  X(uv_fs_get_type)                                                            \
  X(uv_fs_lchown)                                                              \
  X(uv_fs_link)                                                                \
  X(uv_fs_lstat)                                                               \
  X(uv_fs_lutime)                                                              \
  X(uv_fs_mkdir)                                                               \
  X(uv_fs_mkdtemp)                                                             \
  X(uv_fs_mkstemp)                                                             \
  X(uv_fs_open)                                                                \
  X(uv_fs_opendir)                                                             \
  X(uv_fs_poll_getpath)                                                        \
  X(uv_fs_poll_init)                                                           \
  X(uv_fs_poll_start)                                                          \
  X(uv_fs_poll_stop)                                                           \
  X(uv_fs_read)                                                                \
  X(uv_fs_readdir)                                                             \
  X(uv_fs_readlink)                                                            \
  X(uv_fs_realpath)                                                            \
  X(uv_fs_rename)                                                              \
  X(uv_fs_req_cleanup)                                                         \
  X(uv_fs_rmdir)                                                               \
  X(uv_fs_scandir)                                                             \
  X(uv_fs_scandir_next)                                                        \
  X(uv_fs_sendfile)                                                            \
  X(uv_fs_stat)                                                                \
  X(uv_fs_statfs)                                                              \
  X(uv_fs_symlink)                                                             \
  X(uv_fs_unlink)                                                              \
  X(uv_fs_utime)                                                               \
  X(uv_fs_write)                                                               \
  X(uv_get_available_memory)                                                   \
  X(uv_get_constrained_memory)                                                 \
  X(uv_get_free_memory)                                                        \
  X(uv_get_osfhandle)                                                          \
  X(uv_get_process_title)                                                      \
  X(uv_get_total_memory)                                                       \
  X(uv_getaddrinfo)                                                            \
  X(uv_getnameinfo)                                                            \
  X(uv_getrusage)                                                              \
  X(uv_getrusage_thread)                                                       \
  X(uv_gettimeofday)                                                           \
  X(uv_guess_handle)                                                           \
  X(uv_handle_get_data)                                                        \
  X(uv_handle_get_loop)                                                        \
  X(uv_handle_get_type)                                                        \
  X(uv_handle_set_data)                                                        \
  X(uv_handle_size)                                                            \
  X(uv_handle_type_name)                                                       \
  X(uv_has_ref)                                                                \
  X(uv_idle_init)                                                              \
  X(uv_idle_start)                                                             \
  X(uv_idle_stop)                                                              \
  X(uv_if_indextoiid)                                                          \
  X(uv_if_indextoname)                                                         \
  X(uv_inet_ntop)                                                              \
  X(uv_inet_pton)                                                              \
  X(uv_interface_addresses)                                                    \
  X(uv_ip4_addr)                                                               \
  X(uv_ip4_name)                                                               \
  X(uv_ip6_addr)                                                               \
  X(uv_ip6_name)                                                               \
  X(uv_ip_name)                                                                \
  X(uv_is_active)                                                              \
  X(uv_is_closing)                                                             \
  X(uv_is_readable)                                                            \
  X(uv_is_writable)                                                            \
  X(uv_key_create)                                                             \
  X(uv_key_delete)                                                             \
  X(uv_key_get)                                                                \
  X(uv_key_set)                                                                \
  X(uv_kill)                                                                   \
  X(uv_library_shutdown)                                                       \
  X(uv_listen)                                                                 \
  X(uv_loadavg)                                                                \
  X(uv_loop_alive)                                                             \
  X(uv_loop_close)                                                             \
  X(uv_loop_configure)                                                         \
  X(uv_loop_delete)                                                            \
  X(uv_loop_fork)                                                              \
  X(uv_loop_get_data)                                                          \
  X(uv_loop_init)                                                              \
  X(uv_loop_new)                                                               \
  X(uv_loop_set_data)                                                          \
  X(uv_loop_size)                                                              \
  X(uv_metrics_idle_time)                                                      \
  X(uv_metrics_info)                                                           \
  X(uv_now)                                                                    \
  X(uv_open_osfhandle)                                                         \
  X(uv_os_environ)                                                             \
  X(uv_os_free_environ)                                                        \
  X(uv_os_free_group)                                                          \
  X(uv_os_free_passwd)                                                         \
  X(uv_os_get_group)                                                           \
  X(uv_os_get_passwd)                                                          \
  X(uv_os_get_passwd2)                                                         \
  X(uv_os_getenv)                                                              \
  X(uv_os_gethostname)                                                         \
  X(uv_os_getpriority)                                                         \
  X(uv_os_homedir)                                                             \
  X(uv_os_setenv)                                                              \
  X(uv_os_setpriority)                                                         \
  X(uv_os_tmpdir)                                                              \
  X(uv_os_uname)                                                               \
  X(uv_os_unsetenv)                                                            \
  X(uv_pipe)                                                                   \
  X(uv_pipe_bind)                                                              \
  X(uv_pipe_bind2)                                                             \
  X(uv_pipe_chmod)                                                             \
  X(uv_pipe_connect)                                                           \
  X(uv_pipe_connect2)                                                          \
  X(uv_pipe_getpeername)                                                       \
  X(uv_pipe_getsockname)                                                       \
  X(uv_pipe_init)                                                              \
  X(uv_pipe_open)                                                              \
  X(uv_pipe_pending_count)                                                     \
  X(uv_pipe_pending_instances)                                                 \
  X(uv_pipe_pending_type)                                                      \
  X(uv_poll_init)                                                              \
  X(uv_poll_init_socket)                                                       \
  X(uv_poll_start)                                                             \
  X(uv_poll_stop)                                                              \
  X(uv_prepare_init)                                                           \
  X(uv_prepare_start)                                                          \
  X(uv_prepare_stop)                                                           \
  X(uv_print_active_handles)                                                   \
  X(uv_print_all_handles)                                                      \
  X(uv_process_get_pid)                                                        \
  X(uv_process_kill)                                                           \
  X(uv_queue_work)                                                             \
  X(uv_random)                                                                 \
  X(uv_read_start)                                                             \
  X(uv_read_stop)                                                              \
  X(uv_recv_buffer_size)                                                       \
  X(uv_ref)                                                                    \
  X(uv_replace_allocator)                                                      \
  X(uv_req_get_data)                                                           \
  X(uv_req_get_type)                                                           \
  X(uv_req_set_data)                                                           \
  X(uv_req_size)                                                               \
  X(uv_req_type_name)                                                          \
  X(uv_resident_set_memory)                                                    \
  X(uv_run)                                                                    \
  X(uv_rwlock_destroy)                                                         \
  X(uv_rwlock_init)                                                            \
  X(uv_rwlock_rdlock)                                                          \
  X(uv_rwlock_rdunlock)                                                        \
  X(uv_rwlock_tryrdlock)                                                       \
  X(uv_rwlock_trywrlock)                                                       \
  X(uv_rwlock_wrlock)                                                          \
  X(uv_rwlock_wrunlock)                                                        \
  X(uv_sem_destroy)                                                            \
  X(uv_sem_init)                                                               \
  X(uv_sem_post)                                                               \
  X(uv_sem_trywait)                                                            \
  X(uv_sem_wait)                                                               \
  X(uv_send_buffer_size)                                                       \
  X(uv_set_process_title)                                                      \
  X(uv_setup_args)                                                             \
  X(uv_shutdown)                                                               \
  X(uv_signal_init)                                                            \
  X(uv_signal_start)                                                           \
  X(uv_signal_start_oneshot)                                                   \
  X(uv_signal_stop)                                                            \
  X(uv_sleep)                                                                  \
  X(uv_socketpair)                                                             \
  X(uv_spawn)                                                                  \
  X(uv_stop)                                                                   \
  X(uv_stream_get_write_queue_size)                                            \
  X(uv_stream_set_blocking)                                                    \
  X(uv_strerror)                                                               \
  X(uv_strerror_r)                                                             \
  X(uv_tcp_bind)                                                               \
  X(uv_tcp_close_reset)                                                        \
  X(uv_tcp_connect)                                                            \
  X(uv_tcp_getpeername)                                                        \
  X(uv_tcp_getsockname)                                                        \
  X(uv_tcp_init)                                                               \
  X(uv_tcp_init_ex)                                                            \
  X(uv_tcp_keepalive)                                                          \
  X(uv_tcp_nodelay)                                                            \
  X(uv_tcp_open)                                                               \
  X(uv_tcp_simultaneous_accepts)                                               \
  X(uv_thread_create)                                                          \
  X(uv_thread_create_ex)                                                       \
  X(uv_thread_detach)                                                          \
  X(uv_thread_equal)                                                           \
  X(uv_thread_getaffinity)                                                     \
  X(uv_thread_getcpu)                                                          \
  X(uv_thread_getname)                                                         \
  X(uv_thread_getpriority)                                                     \
  X(uv_thread_join)                                                            \
  X(uv_thread_self)                                                            \
  X(uv_thread_setaffinity)                                                     \
  X(uv_thread_setname)                                                         \
  X(uv_thread_setpriority)                                                     \
  X(uv_timer_again)                                                            \
  X(uv_timer_get_due_in)                                                       \
  X(uv_timer_get_repeat)                                                       \
  X(uv_timer_init)                                                             \
  X(uv_timer_set_repeat)                                                       \
  X(uv_timer_start)                                                            \
  X(uv_timer_stop)                                                             \
  X(uv_translate_sys_error)                                                    \
  X(uv_try_write)                                                              \
  X(uv_try_write2)                                                             \
  X(uv_tty_get_vterm_state)                                                    \
  X(uv_tty_get_winsize)                                                        \
  X(uv_tty_init)                                                               \
  X(uv_tty_set_mode)                                                           \
  X(uv_tty_set_vterm_state)                                                    \
  X(uv_udp_bind)                                                               \
  X(uv_udp_connect)                                                            \
  X(uv_udp_get_send_queue_count)                                               \
  X(uv_udp_get_send_queue_size)                                                \
  X(uv_udp_getpeername)                                                        \
  X(uv_udp_getsockname)                                                        \
  X(uv_udp_init)                                                               \
  X(uv_udp_init_ex)                                                            \
  X(uv_udp_open)                                                               \
  X(uv_udp_recv_start)                                                         \
  X(uv_udp_recv_stop)                                                          \
  X(uv_udp_send)                                                               \
  X(uv_udp_set_broadcast)                                                      \
  X(uv_udp_set_membership)                                                     \
  X(uv_udp_set_multicast_interface)                                            \
  X(uv_udp_set_multicast_loop)                                                 \
  X(uv_udp_set_multicast_ttl)                                                  \
  X(uv_udp_set_source_membership)                                              \
  X(uv_udp_set_ttl)                                                            \
  X(uv_udp_try_send)                                                           \
  X(uv_udp_try_send2)                                                          \
  X(uv_udp_using_recvmmsg)                                                     \
  X(uv_unref)                                                                  \
  X(uv_update_time)                                                            \
  X(uv_uptime)                                                                 \
  X(uv_utf16_length_as_wtf8)                                                   \
  X(uv_utf16_to_wtf8)                                                          \
  X(uv_version)                                                                \
  X(uv_version_string)                                                         \
  X(uv_walk)                                                                   \
  X(uv_write)                                                                  \
  X(uv_write2)                                                                 \
  X(uv_wtf8_length_as_utf16)                                                   \
  X(uv_wtf8_to_utf16)

// Declared and called without arguments: a stub reads none.
#define DECLARE(name) extern void name(void);
UV_FUNCTIONS(DECLARE)

#define ENTRY(name) {#name, name},
static const struct {
  const char *name;
  void (*function)(void);
} uv_functions[] = {UV_FUNCTIONS(ENTRY)};

napi_value call_uv_func(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg;
  if (napi_get_cb_info(env, info, &argc, &arg, NULL, NULL) != napi_ok ||
      argc < 1) {
    napi_throw_error(env, NULL, "Wrong number of arguments");
    return NULL;
  }

  char name[256];
  if (napi_get_value_string_utf8(env, arg, name, sizeof(name), NULL) !=
      napi_ok) {
    napi_throw_error(env, NULL, "Failed to get string value");
    return NULL;
  }
  printf("Got string: %s\n", name);

  for (size_t i = 0; i < sizeof(uv_functions) / sizeof(uv_functions[0]); i++) {
    if (strcmp(name, uv_functions[i].name) == 0) {
      uv_functions[i].function();
      return NULL;
    }
  }

  napi_throw_error(env, NULL, "Function not found");
  return NULL;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, NULL, 0, call_uv_func, NULL, &function) !=
          napi_ok ||
      napi_set_named_property(env, exports, "callUVFunc", function) !=
          napi_ok) {
    napi_throw_error(env, NULL, "Failed to export callUVFunc");
    return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
