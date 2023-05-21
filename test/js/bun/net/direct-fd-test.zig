const std = @import("std");
const os = std.os;

pub export fn bind_listen(port: u16) os.socket_t {
  const fd = _bind_listen(port) catch {
    return -1;
  };
  return fd;
}

pub fn _bind_listen(port: u16) !os.socket_t {
  const address = try std.net.Address.resolveIp("127.0.0.1", port);
  const fd = try std.os.socket(
    address.any.family,
    os.SOCK.STREAM | os.SOCK.CLOEXEC | os.SOCK.NONBLOCK,
    os.IPPROTO.TCP);
  var socklen = address.getOsSockLen();
  try os.bind(fd, &address.any, socklen);
  try os.listen(fd, 128);
  return fd;
}

pub export fn close(fd: os.socket_t) void {
  os.closeSocket(fd);
}
