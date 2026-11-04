// An addon with the shape of uWebSockets.js. Its only entry is
// node_register_module_v<ABI>. It takes Node's loop, polls its listening socket
// and its connections with uv_poll_t, and calls the JavaScript handler with
// node::MakeCallback. Built with DEFLATE_RESPONSE it deflates the response with
// the host's zlib: like uWebSockets.js it links none.
#include <node.h>
#include <uv.h>
#ifdef DEFLATE_RESPONSE
#include <zlib.h>
#endif

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <string>

using namespace v8;

struct Server {
  Isolate *isolate = nullptr;
  uv_loop_t *loop = nullptr;
  uv_poll_t *listener = nullptr;
  int listen_fd = -1;
  Global<Function> handler;
  Global<Function> response_constructor;
};

struct Connection {
  uv_poll_t *poll;
  int fd;
  std::string request;
};

// Never destroyed: a static v8::Global would be disposed after the isolate.
static Server &server = *new Server;

static void free_handle(uv_handle_t *handle) { free(handle); }

static void close_connection(Connection *connection) {
  // The order of uSockets: stop, request the close, then close the fd at once.
  uv_poll_stop(connection->poll);
  uv_close(reinterpret_cast<uv_handle_t *>(connection->poll), free_handle);
  close(connection->fd);
  delete connection;
}

static void throw_error(Isolate *isolate, const char *message) {
  isolate->ThrowException(
      Exception::Error(String::NewFromUtf8(isolate, message).ToLocalChecked()));
}

#ifdef DEFLATE_RESPONSE
// The zlib format, which "Content-Encoding: deflate" names.
static bool deflate_body(const std::string &body, std::string &deflated) {
  z_stream stream = {};
  if (deflateInit2(&stream, Z_BEST_SPEED, Z_DEFLATED, MAX_WBITS, 8,
                   Z_DEFAULT_STRATEGY) != Z_OK)
    return false;
  deflated.assign(deflateBound(&stream, body.size()), '\0');
  stream.next_in = reinterpret_cast<Bytef *>(const_cast<char *>(body.data()));
  stream.avail_in = body.size();
  stream.next_out = reinterpret_cast<Bytef *>(deflated.data());
  stream.avail_out = deflated.size();
  bool ended = deflate(&stream, Z_FINISH) == Z_STREAM_END;
  deflated.resize(stream.total_out);
  return deflateEnd(&stream) == Z_OK && ended;
}
#endif

// response.end(body)
static void end_response(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  Connection *connection =
      static_cast<Connection *>(info.This()->GetAlignedPointerFromInternalField(
          0, kEmbedderDataTypeTagDefault));
  if (!connection)
    return throw_error(isolate, "Invalid access of discarded response");
  Local<String> text = info[0].As<String>();
  std::string body(text->Utf8LengthV2(isolate), '\0');
  text->WriteUtf8V2(isolate, body.data(), body.size());
  std::string encoding;
#ifdef DEFLATE_RESPONSE
  std::string plain;
  plain.swap(body);
  if (!deflate_body(plain, body))
    return throw_error(isolate, "zlib failed");
  encoding = "Content-Encoding: deflate\r\n";
#endif
  std::string response =
      "HTTP/1.1 200 OK\r\n" + encoding +
      "Connection: close\r\nContent-Length: " + std::to_string(body.size()) +
      "\r\n\r\n" + body;
  (void)!send(connection->fd, response.data(), response.size(), MSG_NOSIGNAL);
  info.This()->SetAlignedPointerInInternalField(0, nullptr,
                                                kEmbedderDataTypeTagDefault);
  close_connection(connection);
}

static void on_readable(uv_poll_t *poll, int status, int events) {
  Connection *connection = static_cast<Connection *>(poll->data);
  char chunk[4096];
  ssize_t size = recv(connection->fd, chunk, sizeof chunk, 0);
  if (status < 0 || size <= 0)
    return close_connection(connection);
  connection->request.append(chunk, size);
  if (connection->request.find("\r\n\r\n") == std::string::npos)
    return;
  uv_poll_stop(poll);
  size_t start = connection->request.find(' ') + 1;
  std::string url = connection->request.substr(
      start, connection->request.find(' ', start) - start);

  Isolate *isolate = server.isolate;
  HandleScope scope(isolate);
  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> response = server.response_constructor.Get(isolate)
                               ->NewInstance(context)
                               .ToLocalChecked();
  response->SetAlignedPointerInInternalField(0, connection,
                                             kEmbedderDataTypeTagDefault);
  Local<Value> arguments[] = {
      response, String::NewFromUtf8(isolate, url.data(), NewStringType::kNormal,
                                    static_cast<int>(url.size()))
                    .ToLocalChecked()};
  (void)node::MakeCallback(isolate, context->Global(),
                           server.handler.Get(isolate), 2, arguments, {0, 0});
}

static void on_connection(uv_poll_t *poll, int status, int events) {
  for (;;) {
    int fd = accept4(server.listen_fd, nullptr, nullptr, SOCK_NONBLOCK);
    if (fd < 0)
      return;
    Connection *connection = new Connection{
        static_cast<uv_poll_t *>(malloc(sizeof(uv_poll_t))), fd, {}};
    uv_poll_init_socket(server.loop, connection->poll, fd);
    connection->poll->data = connection;
    uv_poll_start(connection->poll, UV_READABLE, on_readable);
  }
}

// listen(handler) returns the port. The handler gets (response, url).
static void listen_on_loopback(const FunctionCallbackInfo<Value> &info) {
  Isolate *isolate = info.GetIsolate();
  server.handler.Reset(isolate, info[0].As<Function>());
  server.listen_fd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
  sockaddr_in address = {};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  socklen_t size = sizeof address;
  sockaddr *name = reinterpret_cast<sockaddr *>(&address);
  if (bind(server.listen_fd, name, size) != 0 ||
      listen(server.listen_fd, 16) != 0 ||
      getsockname(server.listen_fd, name, &size) != 0)
    return throw_error(isolate, "listen failed");
  server.listener = static_cast<uv_poll_t *>(malloc(sizeof(uv_poll_t)));
  uv_poll_init_socket(server.loop, server.listener, server.listen_fd);
  uv_poll_start(server.listener, UV_READABLE, on_connection);
  info.GetReturnValue().Set(
      Integer::NewFromUnsigned(isolate, ntohs(address.sin_port)));
}

// close() lets the process end.
static void close_listener(const FunctionCallbackInfo<Value> &info) {
  uv_poll_stop(server.listener);
  uv_close(reinterpret_cast<uv_handle_t *>(server.listener), free_handle);
  close(server.listen_fd);
}

extern "C" NODE_MODULE_EXPORT void
NODE_MODULE_INITIALIZER(Local<Object> exports, Local<Value> module,
                        Local<Context> context) {
  Isolate *isolate = Isolate::GetCurrent();
  server.isolate = isolate;
  server.loop = node::GetCurrentEventLoop(isolate);

  Local<FunctionTemplate> response = FunctionTemplate::New(isolate);
  response->InstanceTemplate()->SetInternalFieldCount(1);
  response->PrototypeTemplate()->Set(
      String::NewFromUtf8(isolate, "end").ToLocalChecked(),
      FunctionTemplate::New(isolate, end_response));
  server.response_constructor.Reset(
      isolate, response->GetFunction(context).ToLocalChecked());

  NODE_SET_METHOD(exports, "listen", listen_on_loopback);
  NODE_SET_METHOD(exports, "close", close_listener);
}
