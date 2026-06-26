import { expect, test } from "bun:test";
import fs from "node:fs";

// Test for GitHub issue #24129
// When a filesystem returns DT_UNKNOWN (like sshfs, NFS, or other remote/virtual filesystems),
// fs.Dirent.isFIFO() was incorrectly returning true because the EventPort type (value 0)
// was being checked in isFIFO(), and Unknown also maps to 0.

test("Dirent with unknown type should return false for all type checks", () => {
  const UV_DIRENT_UNKNOWN = fs.constants.UV_DIRENT_UNKNOWN;
  expect(UV_DIRENT_UNKNOWN).toBe(0);

  // Create a Dirent with unknown type (simulates what happens on sshfs/NFS mounts)
  const dirent = new fs.Dirent("test-file", UV_DIRENT_UNKNOWN);

  // All type checks should return false for unknown type
  expect(dirent.isFile()).toBe(false);
  expect(dirent.isDirectory()).toBe(false);
  expect(dirent.isSymbolicLink()).toBe(false);
  expect(dirent.isSocket()).toBe(false);
  expect(dirent.isBlockDevice()).toBe(false);
  expect(dirent.isCharacterDevice()).toBe(false);

  // This is the bug fix - isFIFO() should return false for unknown type
  // Previously it returned true because EventPort (0) was checked
  expect(dirent.isFIFO()).toBe(false);
});

test("Dirent.isFIFO() should only return true for actual FIFO/named pipe", () => {
  const UV_DIRENT_FIFO = fs.constants.UV_DIRENT_FIFO;
  expect(UV_DIRENT_FIFO).toBe(4);

  // Create a Dirent with FIFO type
  const fifoDirent = new fs.Dirent("test-fifo", UV_DIRENT_FIFO);
  expect(fifoDirent.isFIFO()).toBe(true);

  // Verify other type checks return false
  expect(fifoDirent.isFile()).toBe(false);
  expect(fifoDirent.isDirectory()).toBe(false);
});
