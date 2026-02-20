import { describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

describe("opendir should throw for non-existent or non-directory paths", () => {
  describe("opendirSync", () => {
    it("throws ENOENT for a non-existent directory", () => {
      try {
        fs.opendirSync("/non_existent_path_xyz_17581");
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ENOENT");
        expect(e.syscall).toBe("opendir");
      }
    });

    it("throws ENOTDIR for a regular file", () => {
      using dir = tempDir("issue-17581", {
        "file.txt": "hello",
      });

      try {
        fs.opendirSync(path.join(String(dir), "file.txt"));
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ENOTDIR");
        expect(e.syscall).toBe("opendir");
      }
    });

    it("works for a valid directory", () => {
      using dir = tempDir("issue-17581", {});
      const d = fs.opendirSync(String(dir));
      expect(d).toBeInstanceOf(fs.Dir);
      d.closeSync();
    });
  });

  describe("opendir (callback)", () => {
    it("returns ENOENT for a non-existent directory", async () => {
      const err: any = await new Promise((resolve, reject) => {
        fs.opendir("/non_existent_path_xyz_17581", (err, dir) => {
          if (err) resolve(err);
          else reject(new Error("Expected an error but got a Dir"));
        });
      });
      expect(err.code).toBe("ENOENT");
      expect(err.syscall).toBe("opendir");
    });

    it("returns ENOTDIR for a regular file", async () => {
      using dir = tempDir("issue-17581", {
        "file.txt": "hello",
      });

      const err: any = await new Promise((resolve, reject) => {
        fs.opendir(path.join(String(dir), "file.txt"), (err, dir) => {
          if (err) resolve(err);
          else reject(new Error("Expected an error but got a Dir"));
        });
      });
      expect(err.code).toBe("ENOTDIR");
      expect(err.syscall).toBe("opendir");
    });

    it("works for a valid directory", async () => {
      using dir = tempDir("issue-17581", {});
      const d: fs.Dir = await new Promise((resolve, reject) => {
        fs.opendir(String(dir), (err, dir) => {
          if (err) reject(err);
          else resolve(dir);
        });
      });
      expect(d).toBeInstanceOf(fs.Dir);
      d.closeSync();
    });
  });

  describe("fs.promises.opendir", () => {
    it("rejects with ENOENT for a non-existent directory", async () => {
      try {
        await fs.promises.opendir("/non_existent_path_xyz_17581");
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ENOENT");
        expect(e.syscall).toBe("opendir");
      }
    });

    it("rejects with ENOTDIR for a regular file", async () => {
      using dir = tempDir("issue-17581", {
        "file.txt": "hello",
      });

      try {
        await fs.promises.opendir(path.join(String(dir), "file.txt"));
        expect.unreachable();
      } catch (e: any) {
        expect(e.code).toBe("ENOTDIR");
        expect(e.syscall).toBe("opendir");
      }
    });

    it("works for a valid directory", async () => {
      using dir = tempDir("issue-17581", {});
      const d = await fs.promises.opendir(String(dir));
      expect(d).toBeInstanceOf(fs.Dir);
      d.closeSync();
    });
  });
});
