// load <port> <connections> <requests> <threads> <request file> <expected file> [<request file> <expected file> ..]
//
// A minimal HTTP/1.1 keep-alive load generator. By default it runs a closed loop: every connection always has exactly one
// request in flight, so a server that is the bottleneck stays saturated. The request file holds the raw bytes to send.
// The expected file holds the status, the content type ("-" for any) and "exact" or "length", one per line, followed by
// the body. Every response is checked: status, content type, and either the whole body ("exact") or only its length
// ("length", for pages that embed a timestamp). The first mismatch ends the run with exit code 1.
// A connection that the server ends is reported with how it ended (FIN or the error), its age, the responses it had carried, and
// how long its request had been waiting or how long it had been idle. node:http closes a connection that was idle for
// keepAliveTimeout (5 s + 1 s); a server that the machine held that long closes, on resuming, connections whose requests wait unread.
// With more than one pair of files, requests cycle through the pairs round-robin.
// Connections and requests are split evenly across the threads; each thread has its own epoll instance.
//
// LOAD_RATE=<requests per second> switches to an open loop: requests are scheduled at fixed intervals regardless of how fast the
// server responds. Each one uses a free connection or waits for one, and its latency is measured from its scheduled time, so a
// server stall is charged to every request scheduled during it (no coordinated omission). LOAD_SKIP=<requests> excludes that
// many requests at the start from the statistics; they are still sent and checked.
//
// Prints one line: requests, seconds, response header bytes per request, and mean, p50, p90, p99, p99.9 and maximum latency.
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

typedef struct {
    char* request;
    size_t requestLength;
    int status;
    char mediaType[128];
    int compareBytes;
    char* body;
    size_t bodyLength;
} Exchange;

typedef struct {
    int fd;
    Exchange* exchange;
    char* buffer;
    size_t capacity;
    size_t length;
    double startedAt;
    double openedAt;
    double answeredAt;
    long answered;
    int isWaiting;
} Connection;

typedef struct {
    pthread_t thread;
    int connectionCount;
    long requests;
    double* latencies;
    size_t headerBytes;
    char* decoded;
    double endedAt;
    double share;
    double offset;
} Worker;

static int port;
static Exchange* exchanges;
static int exchangeCount;
static pthread_barrier_t connected;
static double rate;

static double now(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec * 1e-9;
}

static void fail(const char* what, const char* detail)
{
    fprintf(stderr, "load: %s: %.300s\n", what, detail ? detail : "");
    exit(1);
}

static void failClosed(const Connection* c, ssize_t got)
{
    char detail[200];
    double t = now();
    snprintf(detail, sizeof detail, "%s, open for %.3f s, %ld answered, %s for %.3f s, %zu bytes of this answer", got ? strerror(errno) : "FIN", t - c->openedAt, c->answered,
        c->isWaiting ? "waiting" : "idle", t - (c->isWaiting ? c->startedAt : c->answered ? c->answeredAt : c->openedAt), c->length);
    fail("the server closed the connection", detail);
}

static char* readFile(const char* path, size_t* length)
{
    FILE* f = fopen(path, "rb");
    if (!f)
        fail("cannot open", path);
    fseek(f, 0, SEEK_END);
    *length = ftell(f);
    fseek(f, 0, SEEK_SET);
    char* data = malloc(*length + 1);
    if (fread(data, 1, *length, f) != *length)
        fail("cannot read", path);
    data[*length] = 0;
    fclose(f);
    return data;
}

static char* nextLine(char** cursor)
{
    char* line = *cursor;
    char* end = strchr(line, '\n');
    if (!end)
        fail("the expected file is too short", line);
    *end = 0;
    *cursor = end + 1;
    return line;
}

static const char* findHeader(const char* head, const char* headEnd, const char* name, size_t* valueLength)
{
    size_t nameLength = strlen(name);
    const char* line = memchr(head, '\n', headEnd - head);
    while (line && line + 1 < headEnd) {
        line++;
        const char* end = memchr(line, '\r', headEnd - line);
        if (!end)
            end = headEnd;
        if ((size_t)(end - line) > nameLength && line[nameLength] == ':' && !strncasecmp(line, name, nameLength)) {
            const char* value = line + nameLength + 1;
            while (value < end && *value == ' ')
                value++;
            *valueLength = end - value;
            return value;
        }
        line = memchr(line, '\n', headEnd - line);
    }
    return NULL;
}

static int connectToServer(void)
{
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    struct sockaddr_in address = { .sin_family = AF_INET, .sin_port = htons(port) };
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (connect(fd, (struct sockaddr*)&address, sizeof address))
        fail("connect", strerror(errno));
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    return fd;
}

static void sendRequest(Connection* c, Exchange* e)
{
    c->exchange = e;
    c->length = 0;
    c->isWaiting = 1;
    c->startedAt = now();
    size_t sent = 0;
    while (sent < e->requestLength) {
        ssize_t n = send(c->fd, e->request + sent, e->requestLength - sent, MSG_NOSIGNAL);
        if (n <= 0)
            fail("send", strerror(errno));
        sent += n;
    }
}

// Returns the length of the decoded body when the chunked body is complete, or -1. Decodes into `out`.
static long decodeChunked(const char* data, size_t length, char* out)
{
    size_t at = 0, written = 0;
    for (;;) {
        const char* lineEnd = memmem(data + at, length - at, "\r\n", 2);
        if (!lineEnd)
            return -1;
        size_t size = strtoul(data + at, NULL, 16);
        at = lineEnd - data + 2;
        if (length - at < size + 2)
            return -1;
        if (!size)
            return written;
        memcpy(out + written, data + at, size);
        written += size;
        at += size + 2;
    }
}

// Returns 1 once a complete response has been read and checked.
static int checkResponse(Worker* w, Connection* c)
{
    const char* headEnd = memmem(c->buffer, c->length, "\r\n\r\n", 4);
    if (!headEnd)
        return 0;
    Exchange* e = c->exchange;
    const char* body = headEnd + 4;
    size_t have = c->length - (body - c->buffer);
    size_t valueLength;
    const char* value = findHeader(c->buffer, headEnd, "content-length", &valueLength);
    size_t bodyLength;
    if (value) {
        bodyLength = strtoul(value, NULL, 10);
        if (have < bodyLength)
            return 0;
        if (have > bodyLength)
            fail("bytes after the body", c->buffer);
    } else {
        value = findHeader(c->buffer, headEnd, "transfer-encoding", &valueLength);
        if (!value || strncasecmp(value, "chunked", 7))
            fail("neither Content-Length nor chunked", c->buffer);
        long n = decodeChunked(body, have, w->decoded);
        if (n < 0)
            return 0;
        body = w->decoded;
        bodyLength = n;
    }
    if (atoi(c->buffer + 9) != e->status)
        fail("another status", c->buffer);
    if (strcmp(e->mediaType, "-")) {
        value = findHeader(c->buffer, headEnd, "content-type", &valueLength);
        size_t mediaLength = strlen(e->mediaType);
        if (!value || valueLength < mediaLength || strncasecmp(value, e->mediaType, mediaLength) || (valueLength > mediaLength && value[mediaLength] != ';'))
            fail("another media type", c->buffer);
    }
    if (bodyLength != e->bodyLength || (e->compareBytes && memcmp(body, e->body, bodyLength)))
        fail("another body", c->buffer);
    w->headerBytes += headEnd + 4 - c->buffer;
    c->isWaiting = 0;
    c->answered++;
    c->answeredAt = now();
    return 1;
}

static void* runClientThread(void* argument)
{
    Worker* w = argument;
    int epoll = epoll_create1(0);
    Connection* connections = calloc(w->connectionCount, sizeof(Connection));
    for (int i = 0; i < w->connectionCount; i++) {
        Connection* c = &connections[i];
        c->fd = connectToServer();
        c->openedAt = now();
        c->capacity = 1 << 20;
        c->buffer = malloc(c->capacity);
        struct epoll_event event = { .events = EPOLLIN, .data.ptr = c };
        epoll_ctl(epoll, EPOLL_CTL_ADD, c->fd, &event);
    }
    pthread_barrier_wait(&connected);
    long started = 0, finished = 0;
    if (rate > 0) {
        Connection** idle = calloc(w->connectionCount, sizeof(Connection*));
        int idleCount = 0;
        for (int i = 0; i < w->connectionCount; i++)
            idle[idleCount++] = &connections[i];
        double interval = w->share / rate, due = now() + interval * w->offset, progressAt = now();
        while (finished < w->requests) {
            if (now() - progressAt > 30)
                fail("no answer for 30 seconds", "");
            while (started < w->requests && idleCount && now() >= due) {
                Connection* c = idle[--idleCount];
                sendRequest(c, &exchanges[started % exchangeCount]);
                c->startedAt = due;
                due += interval;
                started++;
            }
            struct epoll_event events[64];
            int n = epoll_wait(epoll, events, 64, 0);
            for (int i = 0; i < n; i++) {
                Connection* c = events[i].data.ptr;
                ssize_t got = recv(c->fd, c->buffer + c->length, c->capacity - c->length - 1, 0);
                if (got <= 0)
                    failClosed(c, got);
                c->length += got;
                c->buffer[c->length] = 0;
                if (!checkResponse(w, c))
                    continue;
                progressAt = now();
                w->latencies[finished++] = progressAt - c->startedAt;
                idle[idleCount++] = c;
            }
        }
        w->endedAt = now();
        return NULL;
    }
    for (int i = 0; i < w->connectionCount && started < w->requests; i++, started++)
        sendRequest(&connections[i], &exchanges[started % exchangeCount]);
    while (finished < w->requests) {
        struct epoll_event events[64];
        int n = epoll_wait(epoll, events, 64, 30000);
        if (n < 0 && errno == EINTR)
            continue;
        if (n <= 0)
            fail("no answer for 30 seconds", "");
        for (int i = 0; i < n; i++) {
            Connection* c = events[i].data.ptr;
            ssize_t got = recv(c->fd, c->buffer + c->length, c->capacity - c->length - 1, 0);
            if (got <= 0)
                failClosed(c, got);
            c->length += got;
            c->buffer[c->length] = 0;
            if (!checkResponse(w, c))
                continue;
            w->latencies[finished++] = now() - c->startedAt;
            if (started < w->requests) {
                sendRequest(c, &exchanges[started % exchangeCount]);
                started++;
            }
        }
    }
    w->endedAt = now();
    return NULL;
}

static int compareDoubles(const void* a, const void* b)
{
    double x = *(const double*)a, y = *(const double*)b;
    return x < y ? -1 : x > y;
}

int main(int argc, char** argv)
{
    if (argc < 7 || argc % 2 != 1)
        fail("usage", "load <port> <connections> <requests> <threads> <request file> <expected file> [<request file> <expected file> ..]");
    port = atoi(argv[1]);
    int connectionCount = atoi(argv[2]);
    long requests = atol(argv[3]);
    int threadCount = atoi(argv[4]);
    exchangeCount = (argc - 5) / 2;
    exchanges = calloc(exchangeCount, sizeof(Exchange));
    for (int i = 0; i < exchangeCount; i++) {
        Exchange* e = &exchanges[i];
        e->request = readFile(argv[5 + 2 * i], &e->requestLength);
        size_t length;
        char* expected = readFile(argv[6 + 2 * i], &length);
        char* cursor = expected;
        e->status = atoi(nextLine(&cursor));
        snprintf(e->mediaType, sizeof e->mediaType, "%s", nextLine(&cursor));
        e->compareBytes = !strcmp(nextLine(&cursor), "exact");
        e->body = cursor;
        e->bodyLength = length - (cursor - expected);
    }
    if (threadCount > connectionCount)
        threadCount = connectionCount;
    if (getenv("LOAD_RATE"))
        rate = atof(getenv("LOAD_RATE"));

    double* latencies = malloc(requests * sizeof(double));
    Worker* workers = calloc(threadCount, sizeof(Worker));
    pthread_barrier_init(&connected, NULL, threadCount + 1);
    long dealt = 0;
    for (int i = 0; i < threadCount; i++) {
        Worker* w = &workers[i];
        w->connectionCount = connectionCount / threadCount + (i < connectionCount % threadCount);
        w->requests = requests / threadCount + (i < requests % threadCount);
        w->latencies = latencies + dealt;
        w->decoded = malloc(1 << 20);
        w->share = threadCount;
        w->offset = (double)i / threadCount;
        dealt += w->requests;
        if (pthread_create(&w->thread, NULL, runClientThread, w))
            fail("cannot start a thread", "");
    }
    double begin = now();
    pthread_barrier_wait(&connected);
    begin = now();
    double end = begin;
    size_t headerBytes = 0;
    for (int i = 0; i < threadCount; i++) {
        pthread_join(workers[i].thread, NULL);
        if (workers[i].endedAt > end)
            end = workers[i].endedAt;
        headerBytes += workers[i].headerBytes;
    }
    if (getenv("LOAD_SKIP")) {
        long skip = atol(getenv("LOAD_SKIP")) / threadCount, kept = 0;
        for (int i = 0; i < threadCount; i++)
            for (long k = skip; k < workers[i].requests; k++)
                latencies[kept++] = workers[i].latencies[k];
        requests = kept;
    }
    double sum = 0;
    for (long i = 0; i < requests; i++)
        sum += latencies[i];
    qsort(latencies, requests, sizeof(double), compareDoubles);
    printf("requests %ld seconds %.6f header_bytes %.1f mean_us %.1f p50_us %.1f p90_us %.1f p99_us %.1f p999_us %.1f longest_us %.1f\n", requests, end - begin, (double)headerBytes / requests,
        sum / requests * 1e6, latencies[requests / 2] * 1e6, latencies[requests * 90 / 100] * 1e6, latencies[requests * 99 / 100] * 1e6, latencies[requests * 999 / 1000] * 1e6, latencies[requests - 1] * 1e6);
    return 0;
}
