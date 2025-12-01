#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

int main() {
  int stdout_pipe[2], stderr_pipe[2];
  pid_t pid;
  int status;
  char stdout_buffer[4096] = {0};
  char stderr_buffer[4096] = {0};

  // Create pipes for stdout and stderr
  if (pipe(stdout_pipe) == -1 || pipe(stderr_pipe) == -1) {
    perror("pipe");
    return 1;
  }

  // Create garbage environment variables with stack buffers containing
  // arbitrary bytes
  char garbage1[64];
  char garbage2[64];
  char garbage3[64];
  char garbage4[64];
  char garbage5[64];

  // Fill with arbitrary non-ASCII/UTF-8 bytes
  for (int i = 0; i < 63; i++) {
    garbage1[i] = (char)(0x80 + (i % 128));  // Invalid UTF-8 start bytes
    garbage2[i] = (char)(0xFF - (i % 256));  // High bytes
    garbage3[i] = (char)(i * 3 + 128);       // Mixed garbage
    garbage4[i] = (char)(0xC0 | (i & 0x1F)); // Invalid UTF-8 sequences
  }
  garbage1[63] = '\0';
  garbage2[63] = '\0';
  garbage3[63] = '\0';
  garbage4[63] = '\0';

  for (int i = 0; i < 10; i++) {
    garbage5[i] = (char)(0x80 + (i % 128));
  }
  garbage5[10] = '=';
  garbage5[11] = 0x81;
  garbage5[12] = 0xF5;
  garbage5[13] = 0xC1;
  garbage5[14] = 0xC2;

  char *garbage_env[] = {
      garbage5,
      //   garbage1,
      //   garbage2,
      //   garbage3,
      //   garbage4,
      "PATH=/usr/bin:/bin", // Keep PATH so we can find commands
      "BUN_DEBUG_QUIET_LOGS=1", "OOGA=booga", "OOGA=laskdjflsdf", NULL};

  pid = fork();

  if (pid == -1) {
    perror("fork");
    return 1;
  }

  if (pid == 0) {
    // Child process
    close(stdout_pipe[0]); // Close read end
    close(stderr_pipe[0]); // Close read end

    // Redirect stdout and stderr to pipes
    dup2(stdout_pipe[1], STDOUT_FILENO);
    dup2(stderr_pipe[1], STDERR_FILENO);

    close(stdout_pipe[1]);
    close(stderr_pipe[1]);

    char *BUN_PATH = getenv("BUN_PATH");
    if (BUN_PATH == NULL) {
      fprintf(stderr, "Missing BUN_PATH!\n");
      fflush(stderr);
      exit(1);
    }
    execve(BUN_PATH,
           (char *[]){"bun-debug", "-e", "console.log(process.env)", NULL},
           garbage_env);

    // If both fail, exit with error
    perror("execve");
    exit(127);
  } else {
    // Parent process
    close(stdout_pipe[1]); // Close write end
    close(stderr_pipe[1]); // Close write end

    // Read from stdout pipe
    ssize_t stdout_bytes =
        read(stdout_pipe[0], stdout_buffer, sizeof(stdout_buffer) - 1);
    if (stdout_bytes > 0) {
      stdout_buffer[stdout_bytes] = '\0';
    }

    // Read from stderr pipe
    ssize_t stderr_bytes =
        read(stderr_pipe[0], stderr_buffer, sizeof(stderr_buffer) - 1);
    if (stderr_bytes > 0) {
      stderr_buffer[stderr_bytes] = '\0';
    }

    close(stdout_pipe[0]);
    close(stderr_pipe[0]);

    // Wait for child process
    waitpid(pid, &status, 0);

    // Print results
    printf("=== PROCESS OUTPUT ===\n");
    printf("Exit code: %d\n", WEXITSTATUS(status));

    printf("\n=== STDOUT ===\n");
    printf("%s", stdout_buffer);
    fflush(stdout);

    if (stderr_bytes > 0) {
      fprintf(stderr, "\n=== STDERR ===\n");
      fprintf(stderr, "%s", stderr_buffer);
      fflush(stderr);
    }
    exit(status);
  }

  return 0;
}