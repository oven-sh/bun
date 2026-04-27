// Minimal WebTransport-over-HTTP/3 client for Bun.serve tests.
//
// Links against Bun's already-built lsquic/BoringSSL objects (same trick as
// packages/h3blast). Single connection, single CONNECT stream; speaks a tiny
// line protocol on stdio so the JS test can drive it deterministically:
//
//   stdout (one event per line, payload base64url so newlines/NULs survive):
//     open                      — 2xx received on the CONNECT stream
//     dgram <b64>               — incoming HTTP datagram for our session
//     close <code> <b64>        — WT_CLOSE_SESSION capsule received
//     error <text>              — anything fatal
//   stdin commands:
//     dgram <b64>               — queue one QUIC DATAGRAM (QSID-prefixed)
//     stream <b64>              — open a bidi WT stream (0x41 + sid), write, FIN
//     close <code> <b64>        — send WT_CLOSE_SESSION + FIN, then quit
//
// Only what the tests need: no uni streams, no flow-control capsules, no
// reconnection. Runs the lsquic event loop on a 1 ms timer plus poll on the
// UDP fd and stdin.

#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define LSQUIC_WEBTRANSPORT_SERVER_SUPPORT 1
#include "lsquic.h"
#include "lsxpack_header.h"
#include <openssl/ssl.h>

static int g_fd = -1;
static struct sockaddr_in g_local, g_peer;
static lsquic_engine_t *g_engine;
static lsquic_conn_t *g_conn;
static lsquic_stream_t *g_connect; /* the CONNECT/session stream */
static lsquic_stream_id_t g_session_id;
static int g_open, g_done;
static const char *g_path = "/";

/* Outgoing queues: datagrams (QSID-prefixed payloads) and pending bidi
 * streams (0x41 + sid prefixed payloads). */
struct buf { struct buf *next; size_t len; unsigned char data[]; };
static struct buf *g_dg_head, *g_dg_tail;
static struct buf *g_stream_pending; /* one at a time is enough for tests */

/* Capsule reassembly on the CONNECT stream. */
static unsigned char g_cap[2048];
static size_t g_caplen;

/* Outgoing close capsule, written once the CONNECT stream becomes writable. */
static unsigned char g_close[1100];
static size_t g_closelen;

/* ───── helpers ───── */

static void die(const char *msg) {
    printf("error %s\n", msg);
    fflush(stdout);
    exit(1);
}

static const char B64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

static void b64enc(const unsigned char *in, size_t n, char *out) {
    size_t i = 0, o = 0;
    while (i + 3 <= n) {
        unsigned v = (in[i] << 16) | (in[i+1] << 8) | in[i+2];
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
        out[o++] = B64[(v >> 6) & 63];  out[o++] = B64[v & 63];
        i += 3;
    }
    if (i + 1 == n) {
        unsigned v = in[i] << 16;
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
    } else if (i + 2 == n) {
        unsigned v = (in[i] << 16) | (in[i+1] << 8);
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
        out[o++] = B64[(v >> 6) & 63];
    }
    out[o] = 0;
}

static int b64idx(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '-' || c == '+') return 62;
    if (c == '_' || c == '/') return 63;
    return -1;
}

static size_t b64dec(const char *in, unsigned char *out) {
    size_t o = 0;
    int q[4], n = 0;
    for (; *in; in++) {
        int v = b64idx(*in);
        if (v < 0) continue;
        q[n++] = v;
        if (n == 4) {
            out[o++] = (q[0] << 2) | (q[1] >> 4);
            out[o++] = (q[1] << 4) | (q[2] >> 2);
            out[o++] = (q[2] << 6) | q[3];
            n = 0;
        }
    }
    if (n >= 2) out[o++] = (q[0] << 2) | (q[1] >> 4);
    if (n >= 3) out[o++] = (q[1] << 4) | (q[2] >> 2);
    return o;
}

static unsigned vint_read(const unsigned char *p, const unsigned char *end, uint64_t *out) {
    if (p >= end) return 0;
    unsigned len = 1u << (*p >> 6);
    if ((unsigned)(end - p) < len) return 0;
    uint64_t v = *p & 0x3f;
    for (unsigned i = 1; i < len; i++) v = (v << 8) | p[i];
    *out = v;
    return len;
}

static unsigned vint_write(unsigned char *p, uint64_t v) {
    if (v < 64) { p[0] = (unsigned char) v; return 1; }
    if (v < 16384) { p[0] = 0x40 | (v >> 8); p[1] = (unsigned char) v; return 2; }
    if (v < 1073741824) {
        p[0] = 0x80 | (v >> 24); p[1] = v >> 16; p[2] = v >> 8; p[3] = (unsigned char) v;
        return 4;
    }
    p[0] = (unsigned char)(0xc0 | (v >> 56));
    for (int i = 1; i < 8; i++) p[i] = (unsigned char)(v >> (8 * (7 - i)));
    return 8;
}

static struct buf *buf_new(const unsigned char *prefix, size_t plen,
                           const unsigned char *data, size_t dlen) {
    struct buf *b = malloc(sizeof(*b) + plen + dlen);
    if (!b) die("oom");
    b->next = NULL;
    b->len = plen + dlen;
    memcpy(b->data, prefix, plen);
    memcpy(b->data + plen, data, dlen);
    return b;
}

/* ───── lsquic plumbing ───── */

static int packets_out(void *ctx, const struct lsquic_out_spec *specs, unsigned n) {
    unsigned sent = 0;
    for (; sent < n; sent++) {
        struct msghdr m = {0};
        m.msg_name = (void *) specs[sent].dest_sa;
        m.msg_namelen = sizeof(struct sockaddr_in);
        m.msg_iov = specs[sent].iov;
        m.msg_iovlen = specs[sent].iovlen;
        if (sendmsg(g_fd, &m, 0) < 0) break;
    }
    return (int) sent;
}

static SSL_CTX *g_ssl;
static SSL_CTX *get_ssl_ctx(void *p, const struct sockaddr *l) { return g_ssl; }

static lsquic_conn_ctx_t *on_new_conn(void *c, lsquic_conn_t *conn) {
    g_conn = conn;
    return (lsquic_conn_ctx_t *)(uintptr_t) 1;
}
static void on_conn_closed(lsquic_conn_t *c) {
    if (!g_done) printf("close 1006 \n");
    g_done = 1;
    lsquic_conn_set_ctx(c, NULL);
}
static void on_hsk_done(lsquic_conn_t *c, enum lsquic_hsk_status s) {
    if (s != LSQ_HSK_OK && s != LSQ_HSK_RESUMED_OK) die("handshake-failed");
    lsquic_conn_make_stream(c);
}

/* hset interface — lsquic decodes QPACK before on_read; we only care about
 * :status. */
struct hset { int status; struct lsxpack_header xh; char buf[512]; };
static void *hsi_create(void *c, lsquic_stream_t *s, int p) { return calloc(1, sizeof(struct hset)); }
static struct lsxpack_header *hsi_prepare(void *h, struct lsxpack_header *xh, size_t space) {
    struct hset *hs = h;
    if (space > sizeof(hs->buf)) return NULL;
    lsxpack_header_prepare_decode(&hs->xh, hs->buf, 0, space);
    return &hs->xh;
}
static int hsi_process(void *h, struct lsxpack_header *xh) {
    if (!xh) return 0;
    struct hset *hs = h;
    if (xh->name_len == 7 && memcmp(xh->buf + xh->name_offset, ":status", 7) == 0) {
        hs->status = 0;
        for (unsigned i = 0; i < xh->val_len; i++) {
            unsigned char c = (unsigned char) xh->buf[xh->val_offset + i];
            if (c < '0' || c > '9') break;
            hs->status = hs->status * 10 + (c - '0');
        }
    }
    return 0;
}
static void hsi_discard(void *h) { free(h); }

static lsquic_stream_ctx_t *on_new_stream(void *c, lsquic_stream_t *s) {
    if (!s) return NULL;
    /* lsquic also fires this for crypto streams (~0ULL ids) and the H3
     * control / QPACK uni streams (id % 4 != 0). Only client-initiated bidi
     * streams (id ≡ 0 mod 4) carry our CONNECT and WT data. */
    lsquic_stream_id_t id = lsquic_stream_id(s);
    if ((id & 3) != 0 || id > (1ull << 60)) return NULL;
    if (!g_connect) {
        g_connect = s;
        g_session_id = id;
        lsquic_stream_wantwrite(s, 1);
        return (lsquic_stream_ctx_t *)(uintptr_t) 1; /* tag: CONNECT */
    }
    /* WT bidi data stream we asked for. */
    lsquic_stream_wantwrite(s, 1);
    return (lsquic_stream_ctx_t *)(uintptr_t) 2;
}

static void send_connect_headers(lsquic_stream_t *s) {
    char hostbuf[32];
    snprintf(hostbuf, sizeof(hostbuf), "localhost:%d", ntohs(g_peer.sin_port));
    struct { const char *n, *v; } H[] = {
        {":method", "CONNECT"}, {":scheme", "https"}, {":authority", hostbuf},
        {":path", g_path}, {":protocol", "webtransport"},
        {"sec-webtransport-http3-draft", "draft02"}, {"origin", "https://localhost"},
    };
    char flat[512]; size_t off = 0;
    struct lsxpack_header xh[7];
    for (unsigned i = 0; i < 7; i++) {
        size_t nl = strlen(H[i].n), vl = strlen(H[i].v);
        if (off + nl + vl > sizeof(flat)) die("headers-too-large");
        memcpy(flat + off, H[i].n, nl);
        memcpy(flat + off + nl, H[i].v, vl);
        lsxpack_header_set_offset2(&xh[i], flat, off, nl, off + nl, vl);
        off += nl + vl;
    }
    lsquic_http_headers_t lh = { .count = 7, .headers = xh };
    if (lsquic_stream_send_headers(s, &lh, 0) != 0) die("send-headers");
    lsquic_stream_flush(s);
    lsquic_stream_wantread(s, 1);
}

static void on_write(lsquic_stream_t *s, lsquic_stream_ctx_t *h) {
    if (h == NULL) { lsquic_stream_wantwrite(s, 0); return; }
    if ((uintptr_t) h == 1) {
        if (!g_open) {
            send_connect_headers(s);
            lsquic_stream_wantwrite(s, 0);
        } else if (g_closelen) {
            lsquic_stream_write(s, (char *) g_close, g_closelen);
            lsquic_stream_shutdown(s, 1);
            g_closelen = 0;
            lsquic_stream_wantwrite(s, 0);
        }
    } else if ((uintptr_t) h == 2 && g_stream_pending) {
        struct buf *b = g_stream_pending; g_stream_pending = NULL;
        lsquic_stream_write(s, (char *) b->data, b->len);
        lsquic_stream_shutdown(s, 1);
        lsquic_stream_wantwrite(s, 0);
        free(b);
    }
}

static void parse_capsules(void) {
    const unsigned char *p = g_cap, *end = g_cap + g_caplen;
    while (p < end) {
        const unsigned char *start = p;
        uint64_t type, clen;
        unsigned n = vint_read(p, end, &type); if (!n) break; p += n;
        n = vint_read(p, end, &clen); if (!n) { p = start; break; }
        p += n;
        if ((uint64_t)(end - p) < clen) { p = start; break; }
        if (type == 0x2843) {
            int code = 0; char b64[2048] = "";
            if (clen >= 4) {
                code = (p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3];
                b64enc(p + 4, clen - 4, b64);
            }
            printf("close %d %s\n", code, b64);
            g_done = 1;
        }
        p += clen;
    }
    size_t left = end - p;
    memmove(g_cap, p, left);
    g_caplen = left;
}

static void on_read(lsquic_stream_t *s, lsquic_stream_ctx_t *h) {
    if ((uintptr_t) h != 1) {
        char tmp[256]; ssize_t r;
        while ((r = lsquic_stream_read(s, tmp, sizeof(tmp))) > 0);
        if (r == 0) lsquic_stream_shutdown(s, 0);
        return;
    }
    if (!g_open) {
        struct hset *hs = lsquic_stream_get_hset(s);
        if (hs) {
            int status = hs->status ? hs->status : 200;
            free(hs);
            if (status / 100 != 2) {
                printf("error status-%d\n", status);
                g_done = 1; return;
            }
            g_open = 1;
            printf("open\n");
        } else if (getenv("WTCLIENT_DEBUG")) {
            fprintf(stderr, "[wtclient] on_read stream 0, no hset yet\n");
        }
    }
    ssize_t r;
    while ((r = lsquic_stream_read(s, (char *)(g_cap + g_caplen), sizeof(g_cap) - g_caplen)) > 0) {
        g_caplen += (size_t) r;
        parse_capsules();
    }
    if (r == 0) {
        if (!g_done) printf("close 0 \n");
        g_done = 1;
    }
}

static void on_close(lsquic_stream_t *s, lsquic_stream_ctx_t *h) {}

static ssize_t on_dg_write(lsquic_conn_t *c, void *buf, size_t sz) {
    for (;;) {
        struct buf *b = g_dg_head;
        if (!b) { g_dg_tail = NULL; lsquic_conn_want_datagram_write(c, 0); return -1; }
        g_dg_head = b->next;
        if (b->len <= sz) {
            memcpy(buf, b->data, b->len);
            ssize_t r = (ssize_t) b->len;
            if (!g_dg_head) g_dg_tail = NULL;
            free(b);
            return r;
        }
        free(b);
    }
}

static void on_datagram(lsquic_conn_t *c, const void *buf, size_t sz) {
    uint64_t qsid;
    unsigned n = vint_read(buf, (const unsigned char *) buf + sz, &qsid);
    if (!n || qsid * 4 != g_session_id) return;
    /* The server queues its 200 HEADERS and the open()-handler datagrams in
     * the same process_conns tick, so the DATAGRAM frame can land in an
     * earlier QUIC packet than the STREAM frame carrying :status. Tests want
     * a deterministic "open" first; treat the first matching datagram as
     * implicit confirmation if the headers haven't arrived yet. */
    if (!g_open) { g_open = 1; printf("open\n"); }
    char b64[2048];
    b64enc((const unsigned char *) buf + n, sz - n, b64);
    printf("dgram %s\n", b64);
}

/* ───── stdin command processing ───── */

static void handle_cmd(char *line) {
    char *sp = strchr(line, ' ');
    if (sp) *sp++ = 0;
    if (strcmp(line, "dgram") == 0 && sp && g_open) {
        unsigned char payload[1400], prefix[8];
        size_t dlen = b64dec(sp, payload);
        unsigned plen = vint_write(prefix, g_session_id / 4);
        struct buf *b = buf_new(prefix, plen, payload, dlen);
        if (g_dg_tail) g_dg_tail->next = b; else g_dg_head = b;
        g_dg_tail = b;
        lsquic_conn_want_datagram_write(g_conn, 1);
    } else if (strcmp(line, "stream") == 0 && sp && g_open) {
        unsigned char payload[8192], prefix[16];
        size_t dlen = b64dec(sp, payload);
        prefix[0] = 0x40; prefix[1] = 0x41; /* 2-byte varint for the type */
        unsigned slen = vint_write(prefix + 2, g_session_id);
        g_stream_pending = buf_new(prefix, 2 + slen, payload, dlen);
        lsquic_conn_make_stream(g_conn);
    } else if (strcmp(line, "capsule") == 0 && sp && g_open) {
        /* Raw bytes on the CONNECT stream (no FIN). lsquic wraps them in a
         * DATA frame; the server's capsule parser sees them as body. */
        unsigned char payload[16384];
        size_t dlen = b64dec(sp, payload);
        lsquic_stream_write(g_connect, (char *) payload, dlen);
        lsquic_stream_flush(g_connect);
    } else if (strcmp(line, "close") == 0) {
        int code = 0; const char *b64 = "";
        if (sp) { code = atoi(sp); char *sp2 = strchr(sp, ' '); if (sp2) b64 = sp2 + 1; }
        unsigned char msg[1024]; size_t mlen = b64dec(b64, msg);
        unsigned char *p = g_close;
        *p++ = 0x80; *p++ = 0x00; *p++ = 0x28; *p++ = 0x43;
        uint64_t blen = (code || mlen) ? 4 + mlen : 0;
        p += vint_write(p, blen);
        if (blen) {
            *p++ = code >> 24; *p++ = code >> 16; *p++ = code >> 8; *p++ = (unsigned char) code;
            memcpy(p, msg, mlen); p += mlen;
        }
        g_closelen = p - g_close;
        lsquic_stream_wantwrite(g_connect, 1);
    }
}

/* ───── main loop ───── */

static void process(void) {
    lsquic_engine_process_conns(g_engine);
    fflush(stdout);
}

int main(int argc, char **argv) {
    if (argc < 2) die("usage: wtclient <port> [path]");
    int port = atoi(argv[1]);
    if (argc >= 3) g_path = argv[2];

    setvbuf(stdout, NULL, _IOLBF, 0);
    lsquic_global_init(LSQUIC_GLOBAL_CLIENT);
    if (getenv("WTCLIENT_DEBUG")) {
        static const struct lsquic_logger_if lif = { .log_buf =
            (int (*)(void *, const char *, size_t)) (void *) write };
        lsquic_logger_init(&lif, (void *)(uintptr_t) 2, LLTS_HHMMSSUS);
        lsquic_set_log_level("debug");
    }

    g_ssl = SSL_CTX_new(TLS_method());
    SSL_CTX_set_min_proto_version(g_ssl, TLS1_3_VERSION);
    SSL_CTX_set_verify(g_ssl, SSL_VERIFY_NONE, NULL);
    SSL_CTX_set_alpn_protos(g_ssl, (const unsigned char *)"\x02h3", 3);

    g_fd = socket(AF_INET, SOCK_DGRAM | SOCK_NONBLOCK, 0);
    g_local.sin_family = AF_INET;
    bind(g_fd, (struct sockaddr *) &g_local, sizeof(g_local));
    socklen_t sl = sizeof(g_local);
    getsockname(g_fd, (struct sockaddr *) &g_local, &sl);
    g_peer.sin_family = AF_INET;
    g_peer.sin_port = htons(port);
    inet_pton(AF_INET, "127.0.0.1", &g_peer.sin_addr);

    struct lsquic_engine_settings es;
    lsquic_engine_init_settings(&es, LSENG_HTTP);
    es.es_versions = LSQUIC_DF_VERSIONS & LSQUIC_IETF_VERSIONS;
    es.es_datagrams = 1;
    es.es_ecn = 0;
    es.es_init_max_streams_bidi = 100;

    static const struct lsquic_stream_if sif = {
        .on_new_conn = on_new_conn, .on_conn_closed = on_conn_closed,
        .on_new_stream = on_new_stream, .on_read = on_read,
        .on_write = on_write, .on_close = on_close,
        .on_hsk_done = on_hsk_done,
        .on_dg_write = on_dg_write, .on_datagram = on_datagram,
    };
    static const struct lsquic_hset_if hif = {
        .hsi_create_header_set = hsi_create, .hsi_prepare_decode = hsi_prepare,
        .hsi_process_header = hsi_process, .hsi_discard_header_set = hsi_discard,
    };
    struct lsquic_engine_api api = {
        .ea_settings = &es, .ea_stream_if = &sif, .ea_stream_if_ctx = NULL,
        .ea_packets_out = packets_out, .ea_packets_out_ctx = NULL,
        .ea_get_ssl_ctx = get_ssl_ctx, .ea_hsi_if = &hif, .ea_alpn = "h3",
    };
    g_engine = lsquic_engine_new(LSENG_HTTP, &api);
    if (!g_engine) die("engine");

    if (!lsquic_engine_connect(g_engine, N_LSQVER,
            (struct sockaddr *) &g_local, (struct sockaddr *) &g_peer,
            (void *)(uintptr_t) 1, NULL, "localhost", 0, NULL, 0, NULL, 0))
        die("connect");
    process();

    char line[32768]; size_t llen = 0;
    struct pollfd pfds[2] = {{g_fd, POLLIN, 0}, {0, POLLIN, 0}};
    int npfds = 2;
    fcntl(0, F_SETFL, fcntl(0, F_GETFL) | O_NONBLOCK);
    while (!g_done) {
        int diff = 0, t = 50;
        if (lsquic_engine_earliest_adv_tick(g_engine, &diff))
            t = diff <= 0 ? 0 : (diff + 999) / 1000;
        poll(pfds, npfds, t);
        if (pfds[0].revents & POLLIN) {
            unsigned char buf[2048]; struct sockaddr_in peer; socklen_t pl = sizeof(peer);
            ssize_t r;
            while ((r = recvfrom(g_fd, buf, sizeof(buf), 0,
                                 (struct sockaddr *) &peer, &pl)) > 0) {
                lsquic_engine_packet_in(g_engine, buf, (size_t) r,
                    (struct sockaddr *) &g_local, (struct sockaddr *) &peer,
                    (void *)(uintptr_t) 1, 0);
            }
        }
        if (npfds > 1 && (pfds[1].revents & (POLLIN | POLLHUP))) {
            ssize_t r = read(0, line + llen, sizeof(line) - 1 - llen);
            if (r == 0) npfds = 1; /* EOF: stop polling stdin, keep running */
            else if (r < 0) { if (errno != EAGAIN) npfds = 1; }
            else {
                llen += (size_t) r;
                char *nl;
                while ((nl = memchr(line, '\n', llen))) {
                    *nl = 0;
                    handle_cmd(line);
                    size_t used = (size_t)(nl + 1 - line);
                    memmove(line, nl + 1, llen - used);
                    llen -= used;
                }
            }
        }
        process();
    }
    fflush(stdout);
    return 0;
}
