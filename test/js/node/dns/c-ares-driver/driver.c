/* Runs c-ares 1.34.9, set up the way Bun set it up, in the world of src/dns_resolver/simulation.rs: reads a script from the
 * file named or from stdin and prints the log. regenerate.ts builds it.
 *
 * c-ares is compiled as it is, without util/ares_rand.c, and every call it makes of libc that touches the world is renamed
 * with `objcopy --redefine-syms` (renamed-symbols.txt) to one of the sim_* functions below.
 *  - The random numbers are the simulator's. Those of the skip list are a stream of their own (ares_rand_bytes is renamed in
 *    dsa/ares_slist.o alone), so that its coin flips use up none of them.
 *  - getservbyport_r() is written after glibc 2.39's.
 *  - /etc/netsvc.conf and /etc/svc.conf are not there for c-ares, whatever the script says.
 *
 * What the Linux build of c-ares cannot be asked is answered with `! unsupported`:
 *   settings windows|mac|mac-fails|android, windows-*, mac-resolver, android-property, loopback, `etc -`,
 *   a scope other than 0 in `servers`. Whatever follows `shutdown` is answered with `! after the end`.
 * c-ares holds back what it says about sockets until the outermost call returns, so `watch` and `close` lines come after the
 * `open` and `send` lines of the same command. Whoever compares has to allow for that.
 * With 65,536 queries in flight c-ares looks for a free id forever.
 */
#include "ares_private.h"
#include <arpa/inet.h>
#include <errno.h>
#include <netdb.h>
#include <net/if.h>
#include <netinet/tcp.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

/* ---------- growable buffers ---------- */
typedef struct {
  char  *p;
  size_t len, cap;
} Str;

static void str_reserve(Str *s, size_t extra)
{
  if (s->len + extra + 1 > s->cap) {
    s->cap = (s->len + extra + 1) * 2;
    s->p   = realloc(s->p, s->cap);
  }
}
static void str_add(Str *s, const void *d, size_t n)
{
  str_reserve(s, n);
  if (n) memcpy(s->p + s->len, d, n);
  s->len += n;
  s->p[s->len] = 0;
}
static void str_printf(Str *s, const char *fmt, ...)
{
  char    tmp[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  if (n >= (int)sizeof tmp) n = sizeof tmp - 1;
  str_add(s, tmp, (size_t)n);
}
static void str_text(Str *s, const unsigned char *d, size_t n)
{
  if (n == 0) {
    str_add(s, "%", 1);
    return;
  }
  for (size_t i = 0; i < n; i++) {
    unsigned char b = d[i];
    if (b == '%' || b <= ' ' || b >= 0x7f) str_printf(s, "%%%02X", b);
    else str_add(s, &b, 1);
  }
}
static void str_ctext(Str *s, const char *c) { str_text(s, (const unsigned char *)c, strlen(c)); }
static void str_hex(Str *s, const unsigned char *d, size_t n)
{
  static const char H[] = "0123456789abcdef";
  if (n == 0) {
    str_add(s, "-", 1);
    return;
  }
  str_reserve(s, n * 2);
  for (size_t i = 0; i < n; i++) {
    s->p[s->len++] = H[d[i] >> 4];
    s->p[s->len++] = H[d[i] & 15];
  }
  s->p[s->len] = 0;
}

/* Rust's Display for IpAddr */
static void str_ip(Str *s, int family, const void *addr)
{
  const unsigned char *a = addr;
  if (family == AF_INET) {
    str_printf(s, "%u.%u.%u.%u", a[0], a[1], a[2], a[3]);
    return;
  }
  unsigned seg[8];
  for (int i = 0; i < 8; i++) seg[i] = (unsigned)a[2 * i] << 8 | a[2 * i + 1];
  if (!seg[0] && !seg[1] && !seg[2] && !seg[3] && !seg[4] && seg[5] == 0xffff) {
    str_printf(s, "::ffff:%u.%u.%u.%u", a[12], a[13], a[14], a[15]);
    return;
  }
  int ls = 0, ll = 0, cs = 0, cl = 0;
  for (int i = 0; i < 8; i++) {
    if (seg[i] == 0) {
      if (cl == 0) cs = i;
      cl++;
      if (cl > ll) { ll = cl; ls = cs; }
    } else cl = 0;
  }
  if (ll > 1) {
    for (int i = 0; i < ls; i++) str_printf(s, i ? ":%x" : "%x", seg[i]);
    str_add(s, "::", 2);
    for (int i = ls + ll; i < 8; i++) str_printf(s, i > ls + ll ? ":%x" : "%x", seg[i]);
  } else {
    for (int i = 0; i < 8; i++) str_printf(s, i ? ":%x" : "%x", seg[i]);
  }
}

/* ---------- the world ---------- */
typedef struct {
  int           family; /* AF_INET / AF_INET6 */
  unsigned char b[16];
} Ip;

typedef struct {
  Ip       ip;
  unsigned port;
} IpPort;

typedef struct Arrival {
  struct Arrival *next;
  int             failure;
  unsigned char  *data;
  size_t          len;
  IpPort          from;
} Arrival;

enum { SEND_ATMOST, SEND_BLOCK, SEND_FAIL };
typedef struct SendAct {
  struct SendAct *next;
  int             kind;
  size_t          count;
} SendAct;

typedef struct {
  int      used, number, is_tcp, is_sort, domain;
  int      has_local;
  Ip       local;
  IpPort   server;
  Arrival *arr_head, *arr_tail;
  SendAct *snd_head, *snd_tail;
} Sock;

typedef struct {
  char          *path;
  unsigned char *data;
  size_t         len;
  int            readable, has_mtime;
  int64_t        mtime;
} File;

enum { ROUTE_FROM, ROUTE_NONE, ROUTE_FAILS };
typedef struct {
  Ip  dest, src;
  int kind;
} Route;

typedef struct {
  unsigned index;
  char    *name;
} Iface;

#define FAKE_BASE 100000
#define MAX_SOCKS 4096
#define START_SEC 1000
#define START_UNIX 1700000000LL

static struct {
  Str      log, done;
  File    *files;
  size_t   nfiles;
  char    *etc;
  char    *env_localdomain, *env_resoptions, *env_hostaliases, *hostname;
  Iface   *ifaces;
  size_t   nifaces;
  Route   *routes;
  size_t   nroutes;
  uint64_t random, slist_random;
  int      fast_open;
  uint64_t elapsed_ms;
  Sock     socks[MAX_SOCKS];
  int      last_socket;
  int     *opens;
  size_t   nopens, opens_pos;
  int      quiet;
  /* simulation */
  ares_channel_t *channel;
  int             made, dead;
  unsigned        requests;
  int             has_timer;
  uint64_t        timer;
  int             opt_timeout_set, opt_tries_set;
  uint32_t        opt_timeout, opt_tries;
} W;

static void wlog(const char *fmt, ...)
{
  char    tmp[512];
  va_list ap;
  if (W.quiet) return;
  va_start(ap, fmt);
  int n = vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  if (n >= (int)sizeof tmp) n = sizeof tmp - 1;
  str_add(&W.log, tmp, (size_t)n);
}

static File *find_file(const char *path)
{
  for (size_t i = 0; i < W.nfiles; i++)
    if (strcmp(W.files[i].path, path) == 0) return &W.files[i];
  return NULL;
}

/* "/etc/x" as c-ares spells it -> where the script put it */
static char *map_path(const char *path)
{
  if (strncmp(path, "/etc/", 5) == 0) {
    char *out = malloc(strlen(W.etc) + strlen(path));
    strcpy(out, W.etc);
    strcat(out, path + 5);
    return out;
  }
  return strdup(path);
}

static Sock *sock_of_fd(int fd)
{
  if (fd < FAKE_BASE || fd >= FAKE_BASE + MAX_SOCKS) return NULL;
  Sock *s = &W.socks[fd - FAKE_BASE];
  return s->used ? s : NULL;
}
static Sock *sock_of_number(uint32_t n)
{
  if (n == 0) return NULL;
  for (int i = 0; i < MAX_SOCKS; i++)
    if (W.socks[i].used && (uint32_t)W.socks[i].number == n) return &W.socks[i];
  return NULL;
}
static int fd_of_sock(Sock *s) { return FAKE_BASE + (int)(s - W.socks); }

static void sock_free(Sock *s)
{
  while (s->arr_head) {
    Arrival *a  = s->arr_head;
    s->arr_head = a->next;
    free(a->data);
    free(a);
  }
  while (s->snd_head) {
    SendAct *a  = s->snd_head;
    s->snd_head = a->next;
    free(a);
  }
  memset(s, 0, sizeof *s);
}

static int sa_to_ipport(const struct sockaddr *sa, IpPort *out, unsigned *scope)
{
  memset(out, 0, sizeof *out);
  if (scope) *scope = 0;
  if (sa->sa_family == AF_INET) {
    const struct sockaddr_in *in = (const void *)sa;
    out->ip.family               = AF_INET;
    memcpy(out->ip.b, &in->sin_addr, 4);
    out->port = ntohs(in->sin_port);
    return 1;
  }
  if (sa->sa_family == AF_INET6) {
    const struct sockaddr_in6 *in = (const void *)sa;
    out->ip.family                = AF_INET6;
    memcpy(out->ip.b, &in->sin6_addr, 16);
    out->port = ntohs(in->sin6_port);
    if (scope) *scope = in->sin6_scope_id;
    return 1;
  }
  return 0;
}
static socklen_t ipport_to_sa(const IpPort *ip, struct sockaddr_storage *ss)
{
  memset(ss, 0, sizeof *ss);
  if (ip->ip.family == AF_INET) {
    struct sockaddr_in *in = (void *)ss;
    in->sin_family         = AF_INET;
    memcpy(&in->sin_addr, ip->ip.b, 4);
    in->sin_port = htons((uint16_t)ip->port);
    return sizeof *in;
  }
  struct sockaddr_in6 *in = (void *)ss;
  in->sin6_family         = AF_INET6;
  memcpy(&in->sin6_addr, ip->ip.b, 16);
  in->sin6_port = htons((uint16_t)ip->port);
  return sizeof *in;
}
static int ip_eq(const Ip *a, const Ip *b)
{
  return a->family == b->family && memcmp(a->b, b->b, a->family == AF_INET ? 4 : 16) == 0;
}

/* ---------- libc as c-ares sees it ---------- */
int sim_socket(int domain, int type, int protocol)
{
  for (int i = 0; i < MAX_SOCKS; i++) {
    if (!W.socks[i].used) {
      Sock *s    = &W.socks[i];
      s->used    = 1;
      s->domain  = domain;
      s->is_tcp  = (type == SOCK_STREAM);
      s->is_sort = (protocol == IPPROTO_UDP); /* only ares_sortaddrinfo.c names the protocol */
      return FAKE_BASE + i;
    }
  }
  errno = EMFILE;
  return -1;
}

int sim_close(int fd)
{
  Sock *s = sock_of_fd(fd);
  if (!s) return fd >= FAKE_BASE ? (errno = EBADF, -1) : close(fd);
  if (s->number) wlog("close %d\n", s->number);
  sock_free(s);
  return 0;
}

int sim_fcntl(int fd, int cmd, ...)
{
  (void)fd;
  (void)cmd;
  return 0;
}

int sim_setsockopt(int fd, int level, int name, const void *val, socklen_t len)
{
  (void)fd;
  (void)val;
  (void)len;
  if (level == IPPROTO_TCP && name == TCP_FASTOPEN_CONNECT && !W.fast_open) {
    errno = ENOPROTOOPT;
    return -1;
  }
  return 0;
}

int sim_bind(int fd, const struct sockaddr *sa, socklen_t len)
{
  Sock  *s = sock_of_fd(fd);
  IpPort ip;
  (void)len;
  if (!s || !sa_to_ipport(sa, &ip, NULL)) {
    errno = EBADF;
    return -1;
  }
  s->has_local = 1;
  s->local     = ip.ip;
  return 0;
}

static Route *find_route(const Ip *dest)
{
  Route *found = NULL; /* a later `route` line for the same destination replaces the earlier */
  for (size_t i = 0; i < W.nroutes; i++)
    if (ip_eq(&W.routes[i].dest, dest)) found = &W.routes[i];
  return found;
}

/* The socket gets its number here, and `opens fail` fails here: the simulator's open() is socket+bind+connect in one. */
int sim_connect(int fd, const struct sockaddr *sa, socklen_t len)
{
  Sock    *s = sock_of_fd(fd);
  unsigned scope;
  (void)len;
  if (!s || !sa_to_ipport(sa, &s->server, &scope)) {
    errno = EBADF;
    return -1;
  }
  if (s->is_sort) {
    Route *r = find_route(&s->server.ip);
    if (!r || r->kind == ROUTE_NONE) {
      errno = ENETUNREACH;
      return -1;
    }
    return 0;
  }
  int         ok   = W.opens_pos < W.nopens ? W.opens[W.opens_pos++] : 1;
  const char *kind = s->is_tcp ? "tcp" : "udp";
  if (!W.quiet) {
    if (!ok) str_printf(&W.log, "open fails %s ", kind);
    else {
      s->number = ++W.last_socket;
      str_printf(&W.log, "open %d %s ", s->number, kind);
    }
    str_ip(&W.log, s->server.ip.family, s->server.ip.b);
    str_printf(&W.log, "#%u#%u", s->server.port, scope);
    if (ok && s->has_local) {
      str_add(&W.log, " from ", 6);
      str_ip(&W.log, s->local.family, s->local.b);
    }
    str_add(&W.log, "\n", 1);
  }
  if (!ok) {
    errno = ECONNREFUSED;
    return -1;
  }
  if (s->is_tcp && !W.fast_open) {
    errno = EINPROGRESS;
    return -1;
  }
  return 0;
}

int sim_getsockname(int fd, struct sockaddr *sa, socklen_t *len)
{
  Sock                   *s = sock_of_fd(fd);
  struct sockaddr_storage ss;
  socklen_t               n;
  IpPort                  ip;
  if (!s) {
    errno = EBADF;
    return -1;
  }
  memset(&ip, 0, sizeof ip);
  if (s->is_sort) {
    Route *r = find_route(&s->server.ip);
    if (!r || r->kind != ROUTE_FROM) {
      errno = ENOBUFS;
      return -1;
    }
    ip.ip = r->src;
  } else {
    ip.ip.family = s->domain;
  }
  n = ipport_to_sa(&ip, &ss);
  memcpy(sa, &ss, n < *len ? n : *len);
  *len = n;
  return 0;
}

ssize_t sim_sendto(int fd, const void *buf, size_t len, int flags, const struct sockaddr *to, socklen_t tolen)
{
  Sock *s = sock_of_fd(fd);
  (void)flags;
  (void)to;
  (void)tolen;
  if (!s) {
    errno = EBADF;
    return -1;
  }
  size_t   n = len;
  SendAct *a = s->snd_head;
  if (a) {
    int    kind  = a->kind;
    size_t count = a->count;
    s->snd_head  = a->next;
    if (!s->snd_head) s->snd_tail = NULL;
    free(a);
    if (kind == SEND_BLOCK) {
      wlog("send %d blocks\n", s->number);
      errno = EAGAIN;
      return -1;
    }
    if (kind == SEND_FAIL) {
      wlog("send %d fails\n", s->number);
      errno = ECONNRESET;
      return -1;
    }
    if (s->is_tcp) {
      if (count < 1) count = 1;
      if (count < n) n = count;
    }
  }
  if (!W.quiet) {
    str_printf(&W.log, "send %d ", s->number);
    str_hex(&W.log, buf, n);
    str_add(&W.log, "\n", 1);
  }
  return (ssize_t)n;
}
ssize_t sim_send(int fd, const void *buf, size_t len, int flags) { return sim_sendto(fd, buf, len, flags, NULL, 0); }

ssize_t sim_recvfrom(int fd, void *buf, size_t len, int flags, struct sockaddr *from, socklen_t *fromlen)
{
  Sock *s = sock_of_fd(fd);
  (void)flags;
  if (!s) {
    errno = EBADF;
    return -1;
  }
  Arrival *a = s->arr_head;
  if (!a) {
    errno = EAGAIN;
    return -1;
  }
  if (a->failure) {
    s->arr_head = a->next;
    if (!s->arr_head) s->arr_tail = NULL;
    free(a);
    errno = ECONNRESET;
    return -1;
  }
  size_t n = a->len < len ? a->len : len;
  if (n) memcpy(buf, a->data, n);
  if (from && fromlen) {
    struct sockaddr_storage ss;
    socklen_t               sl = ipport_to_sa(&a->from, &ss);
    memcpy(from, &ss, sl < *fromlen ? sl : *fromlen);
    *fromlen = sl;
  }
  if (s->is_tcp && n < a->len) {
    memmove(a->data, a->data + n, a->len - n);
    a->len -= n;
  } else {
    s->arr_head = a->next;
    if (!s->arr_head) s->arr_tail = NULL;
    free(a->data);
    free(a);
  }
  return (ssize_t)n;
}

FILE *sim_fopen(const char *path, const char *mode)
{
  (void)mode;
  /* Bun's resolver does not read these two. */
  if (strcmp(path, "/etc/netsvc.conf") == 0 || strcmp(path, "/etc/svc.conf") == 0) {
    errno = ENOENT;
    return NULL;
  }
  char *mapped = map_path(path);
  if (!W.quiet) {
    str_add(&W.log, "read ", 5);
    str_ctext(&W.log, mapped);
    str_add(&W.log, "\n", 1);
  }
  File *f = find_file(mapped);
  free(mapped);
  if (!f) {
    errno = ENOENT;
    return NULL;
  }
  if (!f->readable) {
    errno = EACCES;
    return NULL;
  }
  if (f->len == 0) return fopen("/dev/null", "rb");
  return fmemopen(f->data, f->len, "rb");
}

int sim_stat(const char *path, struct stat *st)
{
  char *mapped = map_path(path);
  File *f      = find_file(mapped);
  free(mapped);
  if (!f || !f->has_mtime) {
    errno = ENOENT;
    return -1;
  }
  memset(st, 0, sizeof *st);
  st->st_mtime = (time_t)f->mtime;
  return 0;
}

time_t sim_time(time_t *out)
{
  time_t t = (time_t)(START_UNIX + (int64_t)(W.elapsed_ms / 1000));
  if (out) *out = t;
  return t;
}

int sim_clock_gettime(clockid_t id, struct timespec *ts)
{
  (void)id;
  ts->tv_sec  = START_SEC + (time_t)(W.elapsed_ms / 1000);
  ts->tv_nsec = (long)(W.elapsed_ms % 1000) * 1000000L;
  return 0;
}

char *sim_getenv(const char *name)
{
  if (strcmp(name, "LOCALDOMAIN") == 0) return W.env_localdomain;
  if (strcmp(name, "RES_OPTIONS") == 0) return W.env_resoptions;
  if (strcmp(name, "HOSTALIASES") == 0) return W.env_hostaliases;
  return NULL;
}

int sim_gethostname(char *buf, size_t len)
{
  if (!W.hostname) {
    errno = EFAULT;
    return -1;
  }
  size_t n = strlen(W.hostname) + 1;
  if (n > len) { /* glibc */
    memcpy(buf, W.hostname, len);
    errno = ENAMETOOLONG;
    return -1;
  }
  memcpy(buf, W.hostname, n);
  return 0;
}

unsigned sim_if_nametoindex(const char *name)
{
  for (size_t i = 0; i < W.nifaces; i++)
    if (strcmp(W.ifaces[i].name, name) == 0) return W.ifaces[i].index;
  return 0;
}
char *sim_if_indextoname(unsigned index, char *buf)
{
  for (size_t i = 0; i < W.nifaces; i++)
    if (W.ifaces[i].index == index) {
      snprintf(buf, IF_NAMESIZE, "%s", W.ifaces[i].name);
      return buf;
    }
  errno = ENXIO;
  return NULL;
}

int sim_getservbyname_r(const char *name, const char *proto, struct servent *se, char *buf, size_t buflen,
                        struct servent **result)
{
  (void)name;
  (void)proto;
  (void)se;
  (void)buf;
  (void)buflen;
  *result = NULL;
  return 0;
}

/* glibc's nss_files: nss/nss_files/files-service.c with files-parse.c's LINE_PARSER("#", STRING_FIELD(s_name, isspace, 1);
 * INT_FIELD(s_port, ISSLASH, 10, 0, htons); STRING_FIELD(s_proto, isspace, 1)). A line that does not fit `buflen` is ERANGE. */
static int c_isspace(int c) { return c == ' ' || (c >= '\t' && c <= '\r'); }
int sim_getservbyport_r(int port, const char *proto, struct servent *se, char *buf, size_t buflen, struct servent **result)
{
  *result      = NULL;
  char *mapped = map_path("/etc/services");
  if (!W.quiet) {
    str_add(&W.log, "read ", 5);
    str_ctext(&W.log, mapped);
    str_add(&W.log, "\n", 1);
  }
  File *f = find_file(mapped);
  free(mapped);
  if (!f || !f->readable) return 0;
  size_t pos = 0;
  while (pos < f->len) {
    const unsigned char *nl  = memchr(f->data + pos, '\n', f->len - pos);
    size_t               end = nl ? (size_t)(nl - f->data) : f->len;
    size_t               n   = end - pos;
    size_t               read_len = n + (nl ? 1 : 0);
    if (read_len + 1 >= buflen) return ERANGE;
    memcpy(buf, f->data + pos, read_len);
    buf[read_len]    = 0;
    size_t as_string = strlen(buf);
    pos              = end + 1;
    char *p          = buf;
    while (c_isspace((unsigned char)*p)) p++;
    if (*p == 0 || *p == '#') continue;
    if (p != buf) memmove(buf, p, strlen(p)); /* as __nss_readline: without the NUL */
    p         = buf;
    char *cut = strpbrk(p, "#\n");
    if (cut) *cut = 0;
    char *name = p;
    while (*p && !c_isspace((unsigned char)*p)) p++;
    if (*p) {
      *p = 0;
      do p++; while (c_isspace((unsigned char)*p));
    }
    char         *endp;
    unsigned long v = strtoul(p, &endp, 0);
    if (v > 0xffffffffUL) v = 0xffffffffUL;
    if (endp == p) continue;
    if (*endp == '/') { do endp++; while (*endp == '/'); }
    else if (*endp != 0) continue;
    p             = endp;
    char *s_proto = p;
    while (*p && !c_isspace((unsigned char)*p)) p++;
    if (*p) *p++ = 0;
    size_t aliases = 0;
    for (;;) {
      while (c_isspace((unsigned char)*p)) p++;
      if (!*p) break;
      aliases++;
      while (*p && !c_isspace((unsigned char)*p)) p++;
    }
    /* The pointers to the aliases go behind the line in the caller's buffer. */
    if (((as_string + 1 + 7) & ~(size_t)7) + 8 * (aliases + 2) > buflen) return ERANGE;
    if (htons((uint16_t)v) == (uint16_t)port && strcmp(s_proto, proto) == 0) {
      se->s_name    = name;
      se->s_port    = port;
      se->s_proto   = s_proto;
      se->s_aliases = NULL;
      *result       = se;
      return 0;
    }
  }
  return 0;
}

/* ---------- util/ares_rand.c, replaced: the simulator's xorshift64*, a byte a step ---------- */
struct ares_rand_state {
  int unused;
};
ares_rand_state *ares_init_rand_state(void) { return calloc(1, sizeof(struct ares_rand_state)); }
void             ares_destroy_rand_state(ares_rand_state *s) { free(s); }
void             ares_rand_bytes(ares_rand_state *s, unsigned char *buf, size_t len)
{
  (void)s;
  for (size_t i = 0; i < len; i++) {
    W.random ^= W.random << 13;
    W.random ^= W.random >> 7;
    W.random ^= W.random << 17;
    buf[i] = (unsigned char)((W.random * 0x2545f4914f6cdd1dULL) >> 56);
  }
}
unsigned short ares_generate_new_id(ares_rand_state *state)
{
  unsigned short r = 0;
  ares_rand_bytes(state, (unsigned char *)&r, sizeof(r));
  return r;
}
/* The skip lists flip coins of their own, which must not disturb the stream above. */
void sim_slist_rand_bytes(ares_rand_state *s, unsigned char *buf, size_t len)
{
  (void)s;
  for (size_t i = 0; i < len; i++) {
    W.slist_random = W.slist_random * 6364136223846793005ULL + 1442695040888963407ULL;
    buf[i]         = (unsigned char)(W.slist_random >> 56);
  }
}

/* ---------- script words ---------- */
typedef struct {
  const unsigned char *p;
  size_t               n;
} Word;

static int weq(Word w, const char *s) { return w.n == strlen(s) && memcmp(w.p, s, w.n) == 0; }
static int hexdigit(int c)
{
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
/* malloc'd, NUL-terminated besides. NULL: cannot be read */
static unsigned char *w_text(Word w, size_t *len)
{
  unsigned char *out = malloc(w.n + 1);
  size_t         o   = 0;
  if (!(w.n == 1 && w.p[0] == '%')) {
    for (size_t i = 0; i < w.n;) {
      if (w.p[i] == '%') {
        if (i + 2 >= w.n) { free(out); return NULL; }
        int h = hexdigit(w.p[i + 1]), l = hexdigit(w.p[i + 2]);
        if (h < 0 || l < 0) { free(out); return NULL; }
        out[o++] = (unsigned char)(h << 4 | l);
        i += 3;
      } else out[o++] = w.p[i++];
    }
  }
  out[o] = 0;
  *len   = o;
  return out;
}
static unsigned char *w_hex(Word w, size_t *len)
{
  if (weq(w, "-")) {
    *len = 0;
    return calloc(1, 1);
  }
  if (w.n % 2) return NULL;
  unsigned char *out = malloc(w.n / 2 + 1);
  for (size_t i = 0; i < w.n; i += 2) {
    int h = hexdigit(w.p[i]), l = hexdigit(w.p[i + 1]);
    if (h < 0 || l < 0) { free(out); return NULL; }
    out[i / 2] = (unsigned char)(h << 4 | l);
  }
  *len = w.n / 2;
  return out;
}
static int w_u64(Word w, uint64_t max, uint64_t *out)
{
  size_t   i = 0;
  uint64_t v = 0;
  if (w.n && w.p[0] == '+') i = 1;
  if (i == w.n) return 0;
  for (; i < w.n; i++) {
    if (w.p[i] < '0' || w.p[i] > '9') return 0;
    unsigned d = w.p[i] - '0';
    if (v > (UINT64_MAX - d) / 10) return 0;
    v = v * 10 + d;
  }
  if (v > max) return 0;
  *out = v;
  return 1;
}
static int w_i64(Word w, int64_t *out)
{
  uint64_t v;
  if (w.n && w.p[0] == '-') {
    Word r = { w.p + 1, w.n - 1 };
    if (r.n && r.p[0] == '+') return 0;
    if (!w_u64(r, (uint64_t)INT64_MAX + 1, &v)) return 0;
    *out = (int64_t)(0 - v);
    return 1;
  }
  if (!w_u64(w, INT64_MAX, &v)) return 0;
  *out = (int64_t)v;
  return 1;
}
static int w_ip(Word w, Ip *ip)
{
  char tmp[64];
  if (w.n == 0 || w.n >= sizeof tmp || memchr(w.p, 0, w.n)) return 0;
  memcpy(tmp, w.p, w.n);
  tmp[w.n] = 0;
  memset(ip, 0, sizeof *ip);
  if (inet_pton(AF_INET, tmp, ip->b) == 1) {
    ip->family = AF_INET;
    return 1;
  }
  if (inet_pton(AF_INET6, tmp, ip->b) == 1) {
    ip->family = AF_INET6;
    return 1;
  }
  return 0;
}
static size_t w_parts(Word w, Word *out, size_t max)
{
  size_t n = 0, start = 0;
  for (size_t i = 0; i <= w.n; i++) {
    if (i == w.n || w.p[i] == '#') {
      if (n < max) out[n] = (Word){ w.p + start, i - start };
      n++;
      start = i + 1;
    }
  }
  return n;
}
static int w_ipport(Word w, IpPort *out)
{
  Word     parts[3];
  uint64_t port;
  if (w_parts(w, parts, 3) != 2 || !w_ip(parts[0], &out->ip) || !w_u64(parts[1], 65535, &port)) return 0;
  out->port = (unsigned)port;
  return 1;
}

enum { READ_FAIL = 0, READ_OK = 1, UNSUPPORTED = 2 };

static void set_str(char **slot, unsigned char *v)
{
  free(*slot);
  *slot = (char *)v;
}

static File *file_slot(unsigned char *path) /* takes `path` */
{
  File *f = find_file((char *)path);
  if (!f) {
    W.files = realloc(W.files, (W.nfiles + 1) * sizeof(File));
    f       = &W.files[W.nfiles++];
    memset(f, 0, sizeof *f);
    f->path = (char *)path;
  } else {
    free(path);
    free(f->data);
  }
  return f;
}

static void push_arrival(Sock *s, Arrival *a)
{
  if (s->arr_tail) s->arr_tail->next = a; else s->arr_head = a;
  s->arr_tail = a;
}

static int configure(Word cmd, Word *w, size_t n)
{
  size_t   len;
  uint64_t u;
  if (weq(cmd, "file") && n >= 2) {
    int64_t mtime = START_UNIX - 1000;
    if (n > 3 || (n == 3 && !w_i64(w[2], &mtime))) return READ_FAIL;
    size_t         dlen, plen;
    unsigned char *data = w_text(w[1], &dlen);
    if (!data) return READ_FAIL;
    unsigned char *path = w_text(w[0], &plen);
    if (!path) { free(data); return READ_FAIL; }
    File *f = file_slot(path);
    f->data = data; f->len = dlen; f->readable = 1; f->has_mtime = 1; f->mtime = mtime;
    return READ_OK;
  }
  if (weq(cmd, "unreadable") && n == 1) {
    unsigned char *path = w_text(w[0], &len);
    if (!path) return READ_FAIL;
    File *f = file_slot(path);
    f->data = NULL; f->len = 0; f->readable = 0; f->has_mtime = 0;
    return READ_OK;
  }
  if (weq(cmd, "touch") && n == 2) {
    unsigned char *path = w_text(w[0], &len);
    if (!path) return READ_FAIL;
    File *f = find_file((char *)path);
    free(path);
    int64_t mtime;
    if (!f || !w_i64(w[1], &mtime)) return READ_FAIL;
    f->has_mtime = 1; f->mtime = mtime;
    return READ_OK;
  }
  if (weq(cmd, "etc") && n == 1) {
    if (weq(w[0], "-")) return UNSUPPORTED;
    unsigned char *v = w_text(w[0], &len);
    if (!v) return READ_FAIL;
    set_str(&W.etc, v);
    return READ_OK;
  }
  if (weq(cmd, "env") && n == 2) {
    char **slot = weq(w[0], "LOCALDOMAIN") ? &W.env_localdomain : weq(w[0], "RES_OPTIONS") ? &W.env_resoptions
                : weq(w[0], "HOSTALIASES") ? &W.env_hostaliases : NULL;
    if (!slot) return READ_FAIL;
    unsigned char *v = w_text(w[1], &len);
    if (!v) return READ_FAIL;
    set_str(slot, v);
    return READ_OK;
  }
  if (weq(cmd, "hostname") && n == 1) {
    unsigned char *v = w_text(w[0], &len);
    if (!v) return READ_FAIL;
    set_str(&W.hostname, v);
    return READ_OK;
  }
  if (weq(cmd, "settings") && n == 1) return weq(w[0], "files") ? READ_OK : UNSUPPORTED;
  if (weq(cmd, "windows-server") || weq(cmd, "windows-suffix") || weq(cmd, "mac-resolver") ||
      weq(cmd, "android-property") || weq(cmd, "loopback"))
    return UNSUPPORTED;
  if (weq(cmd, "interface") && n == 2) {
    if (!w_u64(w[0], UINT32_MAX, &u)) return READ_FAIL;
    unsigned char *v = w_text(w[1], &len);
    if (!v) return READ_FAIL;
    W.ifaces = realloc(W.ifaces, (W.nifaces + 1) * sizeof(Iface));
    W.ifaces[W.nifaces++] = (Iface){ (unsigned)u, (char *)v };
    return READ_OK;
  }
  if (weq(cmd, "route") && n == 2) {
    Route r;
    memset(&r, 0, sizeof r);
    if (weq(w[1], "none")) r.kind = ROUTE_NONE;
    else if (weq(w[1], "fails")) r.kind = ROUTE_FAILS;
    else if (w_ip(w[1], &r.src)) r.kind = ROUTE_FROM;
    else return READ_FAIL;
    if (!w_ip(w[0], &r.dest)) return READ_FAIL;
    W.routes = realloc(W.routes, (W.nroutes + 1) * sizeof(Route));
    W.routes[W.nroutes++] = r;
    return READ_OK;
  }
  if (weq(cmd, "seed") && n == 1) {
    if (!w_u64(w[0], UINT64_MAX, &u)) return READ_FAIL;
    W.random = u ? u : 1;
    return READ_OK;
  }
  if (weq(cmd, "fast-open") && n == 0) {
    W.fast_open = 1;
    return READ_OK;
  }
  if (weq(cmd, "opens")) {
    /* The simulator keeps what it read before a word it cannot read. */
    for (size_t i = 0; i < n; i++) {
      int ok;
      if (weq(w[i], "ok")) ok = 1;
      else if (weq(w[i], "fail")) ok = 0;
      else return READ_FAIL;
      W.opens = realloc(W.opens, (W.nopens + 1) * sizeof(int));
      W.opens[W.nopens++] = ok;
    }
    return READ_OK;
  }
  if (weq(cmd, "sends") && n >= 1) {
    if (!w_u64(w[0], UINT32_MAX, &u)) return READ_FAIL;
    Sock *s = sock_of_number((uint32_t)u);
    if (!s) return READ_FAIL;
    for (size_t i = 1; i < n; i++) {
      SendAct a = { NULL, SEND_ATMOST, 0 };
      if (weq(w[i], "block")) a.kind = SEND_BLOCK;
      else if (weq(w[i], "fail")) a.kind = SEND_FAIL;
      else if (w_u64(w[i], UINT64_MAX, &u)) a.count = (size_t)u;
      else return READ_FAIL;
      SendAct *h = malloc(sizeof a);
      *h         = a;
      if (s->snd_tail) s->snd_tail->next = h; else s->snd_head = h;
      s->snd_tail = h;
    }
    return READ_OK;
  }
  if ((weq(cmd, "queue") || weq(cmd, "deliver")) && n >= 2) {
    if (!w_u64(w[0], UINT32_MAX, &u)) return READ_FAIL;
    Sock *s = sock_of_number((uint32_t)u);
    if (!s) return READ_FAIL;
    IpPort from = s->server;
    if (n > 3 || (n == 3 && !w_ipport(w[2], &from))) return READ_FAIL;
    unsigned char *data = w_hex(w[1], &len);
    if (!data) return READ_FAIL;
    Arrival *a = calloc(1, sizeof *a);
    a->data = data; a->len = len; a->from = from;
    push_arrival(s, a);
    return READ_OK;
  }
  if (weq(cmd, "break") && n == 1) {
    if (!w_u64(w[0], UINT32_MAX, &u)) return READ_FAIL;
    Sock *s = sock_of_number((uint32_t)u);
    if (!s) return READ_FAIL;
    Arrival *a = calloc(1, sizeof *a);
    a->failure = 1;
    push_arrival(s, a);
    return READ_OK;
  }
  return READ_FAIL;
}

/* ---------- what Bun's binding made of a callback ---------- */
static const char *error_name(int status)
{
  static const char *names[] = { "SUCCESS", "ENODATA", "EFORMERR", "ESERVFAIL", "ENOTFOUND", "ENOTIMP", "EREFUSED", "EBADQUERY",
    "EBADNAME", "EBADFAMILY", "EBADRESP", "ECONNREFUSED", "ETIMEOUT", "EOF", "EFILE", "ENOMEM", "EDESTRUCTION", "EBADSTR",
    "EBADFLAGS", "ENONAME", "EBADHINTS", "ENOTINITIALIZED", "ELOADIPHLPAPI", "EADDRGETNETWORKPARAMS", "ECANCELLED",
    "ESERVICE", "ENOSERVER" };
  if (status < 0 || status > 26) return "UNKNOWN";
  return names[status];
}

enum Kind { K_A, K_AAAA, K_ANY, K_CAA, K_CNAME, K_MX, K_NAPTR, K_NS, K_PTR, K_SOA, K_SRV, K_TXT };
typedef struct {
  unsigned  token;
  enum Kind kind;
} Req;

static void out_name(Str *o, const char *name)
{
  if (name) {
    str_add(o, " name=", 6);
    str_ctext(o, name);
  } else str_add(o, " name=-", 7);
}

static int out_addresses(Str *o, const unsigned char *abuf, int alen, int family)
{
  struct hostent *host = NULL;
  int             n    = 256, rc;
  static struct ares_addrttl  t4[256];
  static struct ares_addr6ttl t6[256];
  rc = family == AF_INET ? ares_parse_a_reply(abuf, alen, &host, t4, &n) : ares_parse_aaaa_reply(abuf, alen, &host, t6, &n);
  if (rc != ARES_SUCCESS) return rc;
  out_name(o, host->h_name);
  for (int i = 0; host->h_addr_list && host->h_addr_list[i]; i++) {
    str_add(o, " ", 1);
    str_ip(o, host->h_addrtype, host->h_addr_list[i]);
    if (i < n) str_printf(o, "/%d", family == AF_INET ? t4[i].ttl : t6[i].ttl);
  }
  ares_free_hostent(host);
  return ARES_SUCCESS;
}
static void out_aliases(Str *o, struct hostent *host)
{
  for (int i = 0; host->h_aliases && host->h_aliases[i]; i++) {
    str_add(o, " ", 1);
    str_ctext(o, host->h_aliases[i]);
  }
}
static int out_ns(Str *o, const unsigned char *abuf, int alen)
{
  struct hostent *host = NULL;
  int             rc   = ares_parse_ns_reply(abuf, alen, &host);
  if (rc != ARES_SUCCESS) return rc;
  out_aliases(o, host);
  ares_free_hostent(host);
  return rc;
}
static int out_ptr(Str *o, const unsigned char *abuf, int alen)
{
  struct hostent *host = NULL;
  int             rc   = ares_parse_ptr_reply(abuf, alen, NULL, 0, AF_INET, &host);
  if (rc != ARES_SUCCESS) return rc;
  out_aliases(o, host);
  ares_free_hostent(host);
  return rc;
}
static int out_caa(Str *o, const unsigned char *abuf, int alen)
{
  struct ares_caa_reply *r = NULL;
  int                    rc = ares_parse_caa_reply(abuf, alen, &r);
  if (rc != ARES_SUCCESS) return rc;
  for (struct ares_caa_reply *i = r; i; i = i->next) {
    str_printf(o, " %d,", i->critical);
    str_text(o, i->property, i->plength);
    str_add(o, ",", 1);
    str_text(o, i->value, i->length);
  }
  if (r) ares_free_data(r);
  return rc;
}
static int out_mx(Str *o, const unsigned char *abuf, int alen)
{
  struct ares_mx_reply *r = NULL;
  int                   rc = ares_parse_mx_reply(abuf, alen, &r);
  if (rc != ARES_SUCCESS) return rc;
  for (struct ares_mx_reply *i = r; i; i = i->next) {
    str_printf(o, " %u,", i->priority);
    str_ctext(o, i->host);
  }
  if (r) ares_free_data(r);
  return rc;
}
static int out_naptr(Str *o, const unsigned char *abuf, int alen)
{
  struct ares_naptr_reply *r = NULL;
  int                      rc = ares_parse_naptr_reply(abuf, alen, &r);
  if (rc != ARES_SUCCESS) return rc;
  for (struct ares_naptr_reply *i = r; i; i = i->next) {
    str_printf(o, " %u,%u,", i->order, i->preference);
    str_ctext(o, (char *)i->flags);
    str_add(o, ",", 1);
    str_ctext(o, (char *)i->service);
    str_add(o, ",", 1);
    str_ctext(o, (char *)i->regexp);
    str_add(o, ",", 1);
    str_ctext(o, i->replacement);
  }
  if (r) ares_free_data(r);
  return rc;
}
static int out_soa(Str *o, const unsigned char *abuf, int alen)
{
  struct ares_soa_reply *r = NULL;
  int                    rc = ares_parse_soa_reply(abuf, alen, &r);
  if (rc != ARES_SUCCESS) return rc;
  str_add(o, " ", 1);
  str_ctext(o, r->nsname);
  str_add(o, ",", 1);
  str_ctext(o, r->hostmaster);
  str_printf(o, ",%u,%u,%u,%u,%u", r->serial, r->refresh, r->retry, r->expire, r->minttl);
  ares_free_data(r);
  return rc;
}
static int out_srv(Str *o, const unsigned char *abuf, int alen)
{
  struct ares_srv_reply *r = NULL;
  int                    rc = ares_parse_srv_reply(abuf, alen, &r);
  if (rc != ARES_SUCCESS) return rc;
  for (struct ares_srv_reply *i = r; i; i = i->next) {
    str_printf(o, " %u,%u,%u,", i->priority, i->weight, i->port);
    str_ctext(o, i->host);
  }
  if (r) ares_free_data(r);
  return rc;
}
static int out_txt(Str *o, const unsigned char *abuf, int alen)
{
  struct ares_txt_reply *r = NULL;
  int                    rc = ares_parse_txt_reply(abuf, alen, &r);
  if (rc != ARES_SUCCESS) return rc;
  for (struct ares_txt_reply *i = r; i; i = i->next) {
    str_add(o, " ", 1);
    str_text(o, i->txt, i->length);
  }
  if (r) ares_free_data(r);
  return rc;
}
static int out_a(Str *o, const unsigned char *b, int n) { return out_addresses(o, b, n, AF_INET); }
static int out_aaaa(Str *o, const unsigned char *b, int n) { return out_addresses(o, b, n, AF_INET6); }

typedef int (*OutFn)(Str *, const unsigned char *, int);

/* `kind`'s reading of a message, as ` ...` or ` error E...`. */
static void c_reply(Str *o, enum Kind kind, const unsigned char *abuf, int alen)
{
  static const OutFn fns[] = { out_a, out_aaaa, NULL, out_caa, out_a, out_mx, out_naptr, out_ns, out_ptr, out_soa, out_srv, out_txt };
  size_t             mark  = o->len;
  int                rc;
  if (kind == K_ANY) {
    static const struct { const char *label; OutFn fn; } parts[] = { { "A", out_a }, { "AAAA", out_aaaa }, { "MX", out_mx },
      { "NS", out_ns }, { "TXT", out_txt }, { "SRV", out_srv }, { "PTR", out_ptr }, { "NAPTR", out_naptr }, { "SOA", out_soa },
      { "CAA", out_caa } };
    int any = 0, last = ARES_SUCCESS;
    for (size_t i = 0; i < 10; i++) {
      size_t m = o->len;
      str_printf(o, " %s[", parts[i].label);
      rc = parts[i].fn(o, abuf, alen);
      if (rc == ARES_SUCCESS) {
        any = 1;
        str_add(o, " ]", 2);
      } else {
        last   = rc;
        o->len = m;
        o->p[m] = 0;
      }
    }
    if (any) return;
    rc = last;
  } else {
    rc = fns[kind](o, abuf, alen);
    if (rc == ARES_SUCCESS) return;
  }
  o->len = mark;
  if (o->p) o->p[mark] = 0;
  str_printf(o, " error %s", error_name(rc));
}

static int done_head(Req *r, int status) /* 1: go on with the answer */
{
  str_printf(&W.done, "done %u", r->token);
  if (status != ARES_SUCCESS) str_printf(&W.done, " error %s", error_name(status));
  return status == ARES_SUCCESS;
}

static void query_cb(void *arg, int status, int timeouts, unsigned char *abuf, int alen)
{
  Req *r = arg;
  (void)timeouts;
  if (!W.quiet) {
    if (done_head(r, status)) c_reply(&W.done, r->kind, abuf, alen);
    str_add(&W.done, "\n", 1);
  }
  free(r);
}

static void addrinfo_cb(void *arg, int status, int timeouts, struct ares_addrinfo *ai)
{
  Req *r = arg;
  (void)timeouts;
  if (!W.quiet) {
    if (done_head(r, status)) {
      out_name(&W.done, ai->name);
      for (struct ares_addrinfo_cname *c = ai->cnames; c; c = c->next) {
        str_add(&W.done, " ", 1);
        str_ctext(&W.done, c->alias ? c->alias : "");
        str_add(&W.done, ">", 1);
        str_ctext(&W.done, c->name ? c->name : "");
        str_printf(&W.done, "/%d", c->ttl);
      }
      for (struct ares_addrinfo_node *n = ai->nodes; n; n = n->ai_next) {
        IpPort ip;
        sa_to_ipport(n->ai_addr, &ip, NULL);
        str_add(&W.done, " ", 1);
        str_ip(&W.done, ip.ip.family, ip.ip.b);
        str_printf(&W.done, "#%u/%d", ip.port, n->ai_ttl);
      }
    }
    str_add(&W.done, "\n", 1);
  }
  if (ai) ares_freeaddrinfo(ai);
  free(r);
}

static void host_cb(void *arg, int status, int timeouts, struct hostent *host)
{
  Req *r = arg;
  (void)timeouts;
  if (!W.quiet) {
    if (done_head(r, status)) {
      str_add(&W.done, " name=", 6);
      str_ctext(&W.done, host->h_name ? host->h_name : "");
      out_aliases(&W.done, host);
    }
    str_add(&W.done, "\n", 1);
  }
  free(r);
}

static void nameinfo_cb(void *arg, int status, int timeouts, char *node, char *service)
{
  Req *r = arg;
  (void)timeouts;
  if (!W.quiet) {
    if (done_head(r, status)) {
      str_add(&W.done, " name=", 6);
      str_ctext(&W.done, node ? node : "");
      if (service) {
        str_add(&W.done, " service=", 9);
        str_ctext(&W.done, service);
      }
    }
    str_add(&W.done, "\n", 1);
  }
  free(r);
}

static void sock_state_cb(void *data, ares_socket_t fd, int readable, int writable)
{
  Sock *s = sock_of_fd(fd);
  (void)data;
  if (!s || (!readable && !writable)) return; /* the close that follows says it */
  wlog("watch %d %c%c\n", s->number, readable ? 'r' : '-', writable ? 'w' : '-');
}

/* ---------- the simulation ---------- */
static void log_servers(void)
{
  str_add(&W.log, "servers", 7);
  for (ares_slist_node_t *n = ares_slist_node_first(W.channel->servers); n; n = ares_slist_node_next(n)) {
    const ares_server_t *s = ares_slist_node_val(n);
    str_add(&W.log, " ", 1);
    str_ip(&W.log, s->addr.family, &s->addr.addr);
    str_printf(&W.log, "#%u#%u#%u", s->udp_port, s->tcp_port, s->ll_scope);
  }
  str_add(&W.log, "\n", 1);
}

static void make_channel(void)
{
  struct ares_options o;
  int                 mask = ARES_OPT_FLAGS | ARES_OPT_SOCK_STATE_CB;
  memset(&o, 0, sizeof o);
  o.flags         = ARES_FLAG_NOCHECKRESP;
  o.sock_state_cb = sock_state_cb;
  if (W.opt_timeout_set) {
    mask |= ARES_OPT_TIMEOUTMS;
    o.timeout = (int)W.opt_timeout;
  }
  if (W.opt_tries_set) {
    mask |= ARES_OPT_TRIES;
    o.tries = (int)W.opt_tries;
  }
  str_add(&W.log, "start\n", 6);
  int rc = ares_init_options(&W.channel, &o, mask);
  W.made = 1;
  if (rc != ARES_SUCCESS) {
    str_printf(&W.log, "! ares_init_options %s\n", error_name(rc));
    W.channel = NULL;
    W.dead    = 1;
    return;
  }
  log_servers();
}

static Req *new_req(enum Kind kind)
{
  Req *r   = malloc(sizeof *r);
  r->token = W.requests++;
  r->kind  = kind;
  return r;
}

static int next_timeout(uint64_t *abs_ms)
{
  const ares_query_t *q = ares_slist_first_val(W.channel->queries_by_timeout);
  if (!q) return 0;
  __int128 us = ((__int128)q->timeout.sec - START_SEC) * 1000000;
  if (us > INT64_MAX) us = INT64_MAX;
  if (us < INT64_MIN) us = INT64_MIN;
  us += (int64_t)q->timeout.usec;
  if (us > INT64_MAX) us = INT64_MAX;
  *abs_ms = us < 0 ? 0 : (uint64_t)(us / 1000);
  return 1;
}

static void advance(uint64_t ms)
{
  uint64_t e = W.elapsed_ms + ms;
  if (e < W.elapsed_ms || e > UINT32_MAX) e = UINT32_MAX;
  W.elapsed_ms = e;
  ares_process_fd(W.channel, ARES_SOCKET_BAD, ARES_SOCKET_BAD);
}

static int kind_of(Word w, enum Kind *k, int *type)
{
  static const struct { const char *n; enum Kind k; int t; } T[] = { { "A", K_A, 1 }, { "AAAA", K_AAAA, 28 }, { "ANY", K_ANY, 255 },
    { "CAA", K_CAA, 257 }, { "CNAME", K_CNAME, 5 }, { "MX", K_MX, 15 }, { "NAPTR", K_NAPTR, 35 }, { "NS", K_NS, 2 },
    { "PTR", K_PTR, 12 }, { "SOA", K_SOA, 6 }, { "SRV", K_SRV, 33 }, { "TXT", K_TXT, 16 } };
  for (size_t i = 0; i < 12; i++)
    if (weq(w, T[i].n)) {
      *k    = T[i].k;
      *type = T[i].t;
      return 1;
    }
  return 0;
}

static int fd_of_number_word(Word w, int *fd)
{
  uint64_t u;
  if (!w_u64(w, UINT32_MAX, &u)) return 0;
  Sock *s = sock_of_number((uint32_t)u);
  *fd     = s ? fd_of_sock(s) : ARES_SOCKET_BAD;
  return 1;
}

static int act(Word cmd, Word *w, size_t n)
{
  size_t   len;
  uint64_t u;
  Ip       ip;
  int      fd;
  if (weq(cmd, "query") && n == 2) {
    enum Kind k;
    int       type;
    if (!kind_of(w[0], &k, &type)) return READ_FAIL;
    unsigned char *name = w_text(w[1], &len);
    if (!name) return READ_FAIL;
    ares_query(W.channel, (char *)name, 1, type, query_cb, new_req(k));
    free(name);
    return READ_OK;
  }
  if (weq(cmd, "lookup") && n == 3) {
    struct ares_addrinfo_hints hints;
    char                       port[16];
    memset(&hints, 0, sizeof hints);
    if (weq(w[2], "0")) hints.ai_family = AF_UNSPEC;
    else if (weq(w[2], "4")) hints.ai_family = AF_INET;
    else if (weq(w[2], "6")) hints.ai_family = AF_INET6;
    else return READ_FAIL;
    hints.ai_socktype   = SOCK_STREAM;
    unsigned char *name = w_text(w[0], &len);
    if (!name) return READ_FAIL;
    if (!w_u64(w[1], 65535, &u)) { free(name); return READ_FAIL; }
    snprintf(port, sizeof port, "%u", (unsigned)u);
    ares_getaddrinfo(W.channel, (char *)name, u ? port : NULL, &hints, addrinfo_cb, new_req(K_A));
    free(name);
    return READ_OK;
  }
  if (weq(cmd, "reverse") && n == 1) {
    if (!w_ip(w[0], &ip)) return READ_FAIL;
    ares_gethostbyaddr(W.channel, ip.b, ip.family == AF_INET ? 4 : 16, ip.family, host_cb, new_req(K_PTR));
    return READ_OK;
  }
  if (weq(cmd, "nameinfo") && n == 2) {
    IpPort                  ipp;
    struct sockaddr_storage ss;
    if (!w_ip(w[0], &ipp.ip) || !w_u64(w[1], 65535, &u)) return READ_FAIL;
    ipp.port     = (unsigned)u;
    socklen_t sl = ipport_to_sa(&ipp, &ss);
    ares_getnameinfo(W.channel, (struct sockaddr *)&ss, sl, ARES_NI_NAMEREQD | ARES_NI_LOOKUPHOST | ARES_NI_LOOKUPSERVICE,
                     nameinfo_cb, new_req(K_PTR));
    return READ_OK;
  }
  if (weq(cmd, "servers")) {
    struct ares_addr_port_node *nodes = calloc(n + 1, sizeof *nodes);
    int                         rc    = READ_OK;
    for (size_t i = 0; i < n && rc == READ_OK; i++) {
      Word     p[5];
      uint64_t udp, tcp, scope;
      if (w_parts(w[i], p, 5) != 4 || !w_ip(p[0], &ip) || !w_u64(p[1], 65535, &udp) || !w_u64(p[2], 65535, &tcp) ||
          !w_u64(p[3], UINT32_MAX, &scope)) {
        rc = READ_FAIL;
        break;
      }
      if (scope) rc = UNSUPPORTED;
      nodes[i].family   = ip.family;
      nodes[i].udp_port = (int)udp;
      nodes[i].tcp_port = (int)tcp;
      memcpy(&nodes[i].addr, ip.b, 16);
      nodes[i].next = i + 1 < n ? &nodes[i + 1] : NULL;
    }
    if (rc == READ_OK) {
      int status = ares_set_servers_ports(W.channel, n ? nodes : NULL);
      if (status != ARES_SUCCESS) str_printf(&W.log, "! ares_set_servers_ports %s\n", error_name(status));
      log_servers();
    }
    free(nodes);
    return rc;
  }
  if (weq(cmd, "local") && n == 1) {
    if (!w_ip(w[0], &ip)) return READ_FAIL;
    if (ip.family == AF_INET) ares_set_local_ip4(W.channel, (unsigned)ip.b[0] << 24 | ip.b[1] << 16 | ip.b[2] << 8 | ip.b[3]);
    else ares_set_local_ip6(W.channel, ip.b);
    return READ_OK;
  }
  if (weq(cmd, "cancel") && n == 0) {
    ares_cancel(W.channel);
    return READ_OK;
  }
  if (weq(cmd, "shutdown") && n == 0) {
    ares_destroy(W.channel);
    W.channel = NULL;
    W.dead    = 1;
    return READ_OK;
  }
  if (weq(cmd, "advance") && n == 1) {
    if (!w_u64(w[0], UINT64_MAX, &u)) return READ_FAIL;
    advance(u);
    return READ_OK;
  }
  if (weq(cmd, "expire") && n == 0) {
    if (!next_timeout(&u)) return READ_FAIL;
    advance(u > W.elapsed_ms ? u - W.elapsed_ms : 0);
    return READ_OK;
  }
  if ((weq(cmd, "readable") || weq(cmd, "deliver") || weq(cmd, "break")) && n >= 1) {
    if (!weq(cmd, "readable")) {
      int rc = configure(cmd, w, n);
      if (rc != READ_OK) return rc;
    }
    if (!fd_of_number_word(w[0], &fd)) return READ_FAIL;
    ares_process_fd(W.channel, fd, ARES_SOCKET_BAD);
    return READ_OK;
  }
  if (weq(cmd, "writable") && n == 1) {
    if (!fd_of_number_word(w[0], &fd)) return READ_FAIL;
    ares_process_fd(W.channel, ARES_SOCKET_BAD, fd);
    return READ_OK;
  }
  if (weq(cmd, "both") && n == 1) {
    if (!fd_of_number_word(w[0], &fd)) return READ_FAIL;
    ares_process_fd(W.channel, fd, fd);
    return READ_OK;
  }
  return configure(cmd, w, n);
}

static void log_what_changed(void)
{
  uint64_t t   = 0;
  int      has = 0;
  str_add(&W.log, W.done.p ? W.done.p : "", W.done.len);
  W.done.len = 0;
  if (W.channel) has = next_timeout(&t);
  if (has != W.has_timer || (has && t != W.timer)) {
    W.has_timer = has;
    W.timer     = t;
    if (has) str_printf(&W.log, "timer %llu\n", (unsigned long long)t);
    else str_add(&W.log, "timer none\n", 11);
  }
}

static void world_start(void)
{
  W.etc          = strdup("/etc/");
  W.random       = 0x9e3779b97f4a7c15ULL;
  W.slist_random = 1;
}

/* Returns a malloc'd log. */
static char *c_sim_run(const unsigned char *script, size_t script_len, size_t *out_len)
{
  static const char *MAKES[] = { "query", "lookup", "reverse", "nameinfo", "servers", "local", "cancel", "shutdown" };
  world_start();
  size_t pos = 0;
  int    more = 1;
  Word  *words = NULL;
  size_t wcap = 0;
  while (more) {
    const unsigned char *nl  = pos < script_len ? memchr(script + pos, '\n', script_len - pos) : NULL;
    size_t               end = nl ? (size_t)(nl - script) : script_len;
    Word                 line = { script + pos, end - pos };
    more = nl != NULL;
    pos  = end + 1;
    if (line.n && line.p[line.n - 1] == '\r') line.n--;
    size_t nw = 0, start = 0;
    for (size_t i = 0; i <= line.n; i++) {
      if (i == line.n || line.p[i] == ' ') {
        if (nw == wcap) {
          wcap  = wcap ? wcap * 2 : 16;
          words = realloc(words, wcap * sizeof(Word));
        }
        words[nw++] = (Word){ line.p + start, i - start };
        start       = i + 1;
      }
    }
    Word cmd = words[0];
    if (cmd.n == 0 || cmd.p[0] == '#') continue;
    if (W.dead) {
      str_add(&W.log, "! after the end\n", 16);
      break;
    }
    int      rc;
    uint64_t u;
    int      makes = 0;
    for (size_t i = 0; i < 8; i++) makes |= weq(cmd, MAKES[i]);
    if (!W.made && weq(cmd, "timeout") && nw == 2) {
      rc = w_u64(words[1], UINT32_MAX, &u);
      if (rc) { W.opt_timeout_set = 1; W.opt_timeout = (uint32_t)u; }
    } else if (!W.made && weq(cmd, "tries") && nw == 2) {
      rc = w_u64(words[1], UINT32_MAX, &u);
      if (rc) { W.opt_tries_set = 1; W.opt_tries = (uint32_t)u; }
    } else if (!W.made && !makes) {
      rc = configure(cmd, words + 1, nw - 1);
    } else {
      if (!W.made) make_channel();
      if (W.dead) break;
      rc = act(cmd, words + 1, nw - 1);
      log_what_changed();
    }
    if (rc == READ_FAIL) {
      str_add(&W.log, "? ", 2);
      str_text(&W.log, line.p, line.n);
      str_add(&W.log, "\n", 1);
    } else if (rc == UNSUPPORTED) {
      str_add(&W.log, "! unsupported\n", 14);
      break;
    }
  }
  free(words);
  W.quiet = 1;
  if (W.channel) ares_destroy(W.channel);
  W.channel = NULL;
  str_add(&W.log, "", 0);
  *out_len    = W.log.len;
  char *result = W.log.p;
  W.log.p = NULL; W.log.len = W.log.cap = 0;
  return result;
}

int main(int argc, char **argv)
{
  FILE  *f = argc > 1 ? fopen(argv[1], "rb") : stdin;
  Str    in = { 0 };
  char   tmp[65536];
  size_t n;
  if (!f) { perror("open"); return 2; }
  while ((n = fread(tmp, 1, sizeof tmp, f)) > 0) str_add(&in, tmp, n);
  size_t len;
  char  *log = c_sim_run((unsigned char *)(in.p ? in.p : ""), in.len, &len);
  fwrite(log, 1, len, stdout);
  free(log);
  free(in.p);
  return 0;
}
