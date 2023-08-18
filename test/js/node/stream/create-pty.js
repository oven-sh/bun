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
  const name = new Uint8Array(0).fill(0);
  const termp = new Int32Array(0).fill(0);
  const winp = new Int32Array(0).fill(0);

  lazyOpenpty(parent_fd, child_fd, name, termp, winp);

  return {
    parent_fd: parent_fd[0],
    child_fd: child_fd[0],
  };
}
