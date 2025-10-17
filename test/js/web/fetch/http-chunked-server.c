// Simple HTTP server that reproduces a streaming response body bug.
//
// This server uses blocking sockets to send an HTTP response with chunked
// encoding, then keeps the connection open without sending more data. This
// reproduces a bug where Bun's HTTP client wasn't draining pending response
// body bytes from the HTTP thread when the server stopped sending data but
// kept the connection alive.
//
// The server:
// 1. Binds to a random port and prints it to stdout
// 2. Accepts one connection
// 3. Sends HTTP headers with Transfer-Encoding: chunked
// 4. Sends one chunk containing "hello\n"
// 5. Keeps the connection open indefinitely before closing
//
// Without the fix, step 4 would cause the client to hang indefinitely waiting
// for data that's already been received by the HTTP thread but not drained.

#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
  (void)argc;
  (void)argv;

  int server_fd, client_fd;
  struct sockaddr_in address;
  int opt = 1;
  int addrlen = sizeof(address);
  char buffer[1024] = {0};

  // Create socket
  if ((server_fd = socket(AF_INET, SOCK_STREAM, 0)) == 0) {
    perror("socket failed");
    exit(EXIT_FAILURE);
  }

  // Set socket options
  if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt))) {
    perror("setsockopt");
    exit(EXIT_FAILURE);
  }

  address.sin_family = AF_INET;
  address.sin_addr.s_addr = inet_addr("127.0.0.1");
  address.sin_port = htons(0); // Use port 0 to get random port

  // Bind socket
  if (bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
    perror("bind failed");
    exit(EXIT_FAILURE);
  }

  // Get the actual port number
  socklen_t len = sizeof(address);
  if (getsockname(server_fd, (struct sockaddr *)&address, &len) == -1) {
    perror("getsockname");
    exit(EXIT_FAILURE);
  }

  // Print port to stdout so test can read it
  printf("%d\n", ntohs(address.sin_port));
  fflush(stdout);
  // Close stdout so we can simply read it.
  close(1);

  // Listen
  if (listen(server_fd, 1) < 0) {
    perror("listen");
    exit(EXIT_FAILURE);
  }

  // Accept connection
  if ((client_fd = accept(server_fd, (struct sockaddr *)&address,
                          (socklen_t *)&addrlen)) < 0) {
    perror("accept");
    exit(EXIT_FAILURE);
  }

  // Read the HTTP request (we don't care about it)
  read(client_fd, buffer, 1024);

  // Send HTTP response headers with chunked encoding
  const char *headers = "HTTP/1.1 200 OK\r\n"
                        "Content-Type: text/event-stream\r\n"
                        "Cache-Control: no-store\r\n"
                        "Connection: keep-alive\r\n"
                        "Transfer-Encoding: chunked\r\n"
                        "\r\n";

  write(client_fd, headers, strlen(headers));

  // Send first chunk: "hello\n" is 6 bytes
  const char *chunk = "6\r\nhello\n\r\n";
  write(client_fd, chunk, strlen(chunk));

  // Important: Don't close the connection!
  // Just sleep to keep it open
  sleep(9999999);

  // Clean up
  close(client_fd);
  close(server_fd);

  return 0;
}
