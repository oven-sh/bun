import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

describe("S3Client.list() option encoding", () => {
  it.each(["prefix", "delimiter", "continuationToken", "startAfter"])(
    "should not panic when %s is longer than 1024 bytes when encoded",
    async key => {
      // S3 keys may be up to 1024 bytes; percent-encoding can triple that.
      // Previously a fixed 1024-byte stack buffer caused `std.debug.panic` on overflow.
      const value = Buffer.alloc(1024, " ").toString();
      await expect(new S3Client().list({ [key]: value })).rejects.toThrow();
    },
  );
});
