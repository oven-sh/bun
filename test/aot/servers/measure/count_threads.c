// count_threads <cores> <command> [<argument> ..]
//
// Runs a command pinned to <cores> ("4" or "4-7") and counts what each of its threads does, from before exec to the end:
// instructions and cycles in user mode, instructions and cycles in the kernel, and time on a core.
//
// `perf stat -p` finds the threads that exist when it starts, and a counter that children inherit adds them all up. Neither says what a
// thread that was started later did on its own, and a JIT's compiler threads and a collector's helpers are started late, end when they
// have been idle for ten seconds and are started again. So the command runs as a ptrace child that reports only new threads, exec and
// exits: a new thread is held at its very first instruction until its counters are open. Nothing is missed and nothing is estimated,
// and the sum over the threads is the process. System calls are not traced, so a thread pays only when it starts and when it ends.
// A thread's counts are kept after it has ended.
//
// Every line on stdin asks for a reading. The answer on stdout is one line for each thread that ever ran,
//
//     thread <tid> <1 if it is alive> <ns on a core> <user instructions> <user cycles> <kernel instructions> <kernel cycles> <ns enabled> <ns counted> <name>
//
// and then `end <seconds by CLOCK_MONOTONIC> <the line that asked>`. The first line of all is `started <pid> <seconds> <1 if the kernel is counted>`.
// The kernel's columns need kernel.perf_event_paranoid at 1 or below and are 0 elsewhere. Where "ns counted" is less than "ns enabled"
// the processor had too few counters and the counts are too low; four fit on anything recent.
// The command's stdin is /dev/null and its stdout goes to stderr. When stdin ends, the command is killed.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/perf_event.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/signalfd.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

enum { UserInstructions, UserCycles, TimeOnCore, KernelInstructions, KernelCycles, EventCount };

typedef struct {
    pid_t tid;
    int isAlive;
    int hasStarted;
    int events[EventCount];
    uint64_t counts[EventCount];
    uint64_t enabled;
    uint64_t counted;
    char name[64];
} Thread;

static Thread* threads;
static int threadCount;
static int threadCapacity;
static pid_t process;
static int countsKernel;

static void fail(const char* what)
{
    fprintf(stderr, "count_threads: %s: %s\n", what, strerror(errno));
    if (process > 0)
        kill(process, SIGKILL);
    exit(1);
}

static double now(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec * 1e-9;
}

static int openEvent(pid_t tid, uint32_t type, uint64_t config, int inKernel, int inUser, int leader)
{
    struct perf_event_attr attributes = {
        .size = sizeof attributes,
        .type = type,
        .config = config,
        .exclude_hv = 1,
        .exclude_kernel = !inKernel,
        .exclude_user = !inUser,
        .read_format = PERF_FORMAT_GROUP | PERF_FORMAT_TOTAL_TIME_ENABLED | PERF_FORMAT_TOTAL_TIME_RUNNING,
    };
    return syscall(SYS_perf_event_open, &attributes, tid, -1, leader, PERF_FLAG_FD_CLOEXEC);
}

static Thread* findThread(pid_t tid)
{
    for (int i = 0; i < threadCount; i++) {
        if (threads[i].tid == tid && threads[i].isAlive)
            return &threads[i];
    }
    return NULL;
}

static Thread* addThread(pid_t tid)
{
    if (threadCount == threadCapacity) {
        threadCapacity = threadCapacity ? threadCapacity * 2 : 64;
        threads = realloc(threads, threadCapacity * sizeof(Thread));
    }
    Thread* thread = &threads[threadCount++];
    memset(thread, 0, sizeof *thread);
    thread->tid = tid;
    thread->isAlive = 1;
    for (int i = 0; i < EventCount; i++)
        thread->events[i] = -1;
    thread->events[UserInstructions] = openEvent(tid, PERF_TYPE_HARDWARE, PERF_COUNT_HW_INSTRUCTIONS, 0, 1, -1);
    if (thread->events[UserInstructions] < 0)
        fail("perf_event_open");
    int leader = thread->events[UserInstructions];
    thread->events[UserCycles] = openEvent(tid, PERF_TYPE_HARDWARE, PERF_COUNT_HW_CPU_CYCLES, 0, 1, leader);
    // The clock counts whatever mode the thread is in; leaving the kernel out of it only satisfies perf_event_paranoid.
    thread->events[TimeOnCore] = openEvent(tid, PERF_TYPE_SOFTWARE, PERF_COUNT_SW_TASK_CLOCK, countsKernel, 1, leader);
    if (thread->events[UserCycles] < 0 || thread->events[TimeOnCore] < 0)
        fail("perf_event_open for a member of the group");
    if (countsKernel) {
        thread->events[KernelInstructions] = openEvent(tid, PERF_TYPE_HARDWARE, PERF_COUNT_HW_INSTRUCTIONS, 1, 0, leader);
        thread->events[KernelCycles] = openEvent(tid, PERF_TYPE_HARDWARE, PERF_COUNT_HW_CPU_CYCLES, 1, 0, leader);
        if (thread->events[KernelInstructions] < 0 || thread->events[KernelCycles] < 0)
            fail("perf_event_open for the kernel");
    }
    return thread;
}

static void readName(Thread* thread)
{
    char path[64];
    snprintf(path, sizeof path, "/proc/%d/task/%d/comm", process, thread->tid);
    int file = open(path, O_RDONLY);
    if (file < 0)
        return;
    char name[64];
    ssize_t length = read(file, name, sizeof name - 1);
    close(file);
    if (length <= 0)
        return;
    name[name[length - 1] == '\n' ? length - 1 : length] = 0;
    strcpy(thread->name, name);
}

static void readCounts(Thread* thread)
{
    uint64_t values[3 + EventCount];
    if (read(thread->events[UserInstructions], values, sizeof values) < (ssize_t)(3 * sizeof(uint64_t)))
        return;
    thread->enabled = values[1];
    thread->counted = values[2];
    for (uint64_t i = 0; i < values[0] && i < EventCount; i++)
        thread->counts[i] = values[3 + i];
}

static void endThread(Thread* thread)
{
    readCounts(thread);
    thread->isAlive = 0;
    for (int i = 0; i < EventCount; i++) {
        if (thread->events[i] >= 0)
            close(thread->events[i]);
    }
}

static void answer(const char* line)
{
    for (int i = 0; i < threadCount; i++) {
        Thread* thread = &threads[i];
        if (thread->isAlive) {
            readCounts(thread);
            readName(thread);
        }
        printf("thread %d %d %llu %llu %llu %llu %llu %llu %llu %s\n", thread->tid, thread->isAlive, (unsigned long long)thread->counts[TimeOnCore],
            (unsigned long long)thread->counts[UserInstructions], (unsigned long long)thread->counts[UserCycles], (unsigned long long)thread->counts[KernelInstructions],
            (unsigned long long)thread->counts[KernelCycles], (unsigned long long)thread->enabled, (unsigned long long)thread->counted, thread->name);
    }
    printf("end %.9f %s\n", now(), line);
    fflush(stdout);
}

// Takes every report that is waiting. Returns 0 once the process has ended.
static int handleReports(void)
{
    for (;;) {
        int status;
        pid_t tid = waitpid(-1, &status, __WALL | WNOHANG);
        if (tid <= 0)
            return 1;
        Thread* thread = findThread(tid);
        if (WIFEXITED(status) || WIFSIGNALED(status)) {
            if (thread)
                endThread(thread);
            if (tid == process) {
                printf("exited %d\n", WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status));
                fflush(stdout);
                return 0;
            }
            continue;
        }
        if (!WIFSTOPPED(status))
            continue;
        int event = status >> 16, signalToDeliver = 0;
        if (event == PTRACE_EVENT_CLONE || event == PTRACE_EVENT_FORK || event == PTRACE_EVENT_VFORK) {
            // The report of the new thread's first stop may come before or behind this one.
            unsigned long created;
            if (!ptrace(PTRACE_GETEVENTMSG, tid, 0, &created) && !findThread(created))
                addThread(created);
        } else if (event == PTRACE_EVENT_EXIT) {
            if (thread)
                readName(thread);
        } else if (!event) {
            if (!thread) {
                thread = addThread(tid);
                thread->hasStarted = 1;
            } else if (!thread->hasStarted && WSTOPSIG(status) == SIGSTOP)
                thread->hasStarted = 1;
            else
                signalToDeliver = WSTOPSIG(status);
        }
        ptrace(PTRACE_CONT, tid, 0, signalToDeliver);
    }
}

int main(int argc, char** argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: count_threads <cores> <command> [<argument> ..]\n");
        return 2;
    }
    int first = atoi(argv[1]), last = strchr(argv[1], '-') ? atoi(strchr(argv[1], '-') + 1) : first;
    cpu_set_t cores;
    CPU_ZERO(&cores);
    for (int core = first; core <= last; core++)
        CPU_SET(core, &cores);

    int probe = openEvent(0, PERF_TYPE_HARDWARE, PERF_COUNT_HW_INSTRUCTIONS, 1, 0, -1);
    countsKernel = probe >= 0;
    if (probe >= 0)
        close(probe);

    sigset_t childSignals, before;
    sigemptyset(&childSignals);
    sigaddset(&childSignals, SIGCHLD);
    sigprocmask(SIG_BLOCK, &childSignals, &before);
    int reports = signalfd(-1, &childSignals, SFD_NONBLOCK | SFD_CLOEXEC);

    process = fork();
    if (process < 0)
        fail("fork");
    if (!process) {
        sigprocmask(SIG_SETMASK, &before, NULL);
        dup2(open("/dev/null", O_RDONLY), 0);
        dup2(2, 1);
        if (sched_setaffinity(0, sizeof cores, &cores) || ptrace(PTRACE_TRACEME, 0, 0, 0))
            _exit(126);
        raise(SIGSTOP);
        execv(argv[2], argv + 2);
        _exit(127);
    }
    int status;
    if (waitpid(process, &status, 0) != process || !WIFSTOPPED(status))
        fail("the command did not start");
    if (ptrace(PTRACE_SETOPTIONS, process, 0, PTRACE_O_TRACECLONE | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACEEXEC | PTRACE_O_TRACEEXIT | PTRACE_O_EXITKILL))
        fail("PTRACE_SETOPTIONS");
    addThread(process)->hasStarted = 1;
    printf("started %d %.9f %d\n", process, now(), countsKernel);
    fflush(stdout);
    ptrace(PTRACE_CONT, process, 0, 0);

    char line[4096];
    size_t length = 0;
    struct pollfd sources[2] = { { .fd = reports, .events = POLLIN }, { .fd = 0, .events = POLLIN } };
    for (;;) {
        if (poll(sources, 2, -1) < 0 && errno != EINTR)
            fail("poll");
        if (sources[0].revents) {
            struct signalfd_siginfo information[16];
            while (read(reports, information, sizeof information) > 0) { }
            if (!handleReports())
                return 1;
        }
        if (sources[1].revents) {
            ssize_t got = read(0, line + length, sizeof line - length - 1);
            if (got <= 0)
                break;
            length += got;
            char* end;
            while ((end = memchr(line, '\n', length))) {
                *end = 0;
                handleReports();
                answer(line);
                length -= end + 1 - line;
                memmove(line, end + 1, length);
            }
        }
    }
    kill(process, SIGKILL);
    return 0;
}
