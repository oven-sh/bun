import { dlopen, suffix } from "bun:ffi";

var lazyOpenpty;
export function openpty() {
  if (!lazyOpenpty) {
    lazyOpenpty = dlopen(`libc.${suffix}`, {
      openpty: {
        args: ["ptr", "ptr", "ptr", "ptr", "ptr"],
        returns: "int",
      },
    }).symbols.openpty;
  }

  const parent_fd = new Int32Array(1).fill(0);
  const child_fd = new Int32Array(1).fill(0);

  lazyOpenpty(parent_fd, child_fd, 0, 0, 0);

  return {
    parent_fd: parent_fd[0],
    child_fd: child_fd[0],
  };
}

var lazyClose;
export function close(fd) {
  if (!lazyClose) {
    lazyClose = dlopen(`libc.${suffix}`, {
      close: {
        args: ["int"],
        returns: "int",
      },
    }).symbols.close;
  }

  lazyClose(fd);
}
