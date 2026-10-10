import type { S3FilePresignOptions } from "bun";
import { describe, expect, test } from "bun:test";

// A presigned URL signs only the headers it names. Without `contentLength` that list is just
// `host`, so a `PUT` URL places no limit on what is uploaded to it — the caller may send a body
// of any size and S3 stores it. Signing `content-length` is what lets the URL be handed out with
// a size it will be held to.

const base = { accessKeyId: "AK", secretAccessKey: "SK", bucket: "b", region: "us-east-1" } as const;

function presign(options: Partial<S3FilePresignOptions> = {}): URL {
  return new URL(Bun.s3.presign("k", { ...base, method: "PUT", ...options }));
}

// Presign options are read through a coercing reader, so the cases below deliberately pass what
// TypeScript would not.
function presignLength(contentLength: unknown): URL {
  return presign({ contentLength: contentLength as number });
}

function signedHeaders(url: URL): string | null {
  return url.searchParams.get("X-Amz-SignedHeaders");
}

function signature(url: URL): string | null {
  return url.searchParams.get("X-Amz-Signature");
}

describe("presign contentLength", () => {
  test("is absent from the signed headers when not asked for", () => {
    expect(signedHeaders(presign())).toBe("host");
  });

  test("joins the signed headers when asked for", () => {
    expect(signedHeaders(presign({ contentLength: 1024 }))).toBe("content-length;host");
  });

  // The canonical request lists signed headers alphabetically, and a list in any other order
  // produces a signature S3 will not accept.
  test("is listed before host, as the canonical request requires", () => {
    const headers = signedHeaders(presign({ contentLength: 1024 })) ?? "";

    expect(headers.split(";")).toEqual(["content-length", "host"]);
  });

  // The point of the option: were the length merely decorative, the same signature would
  // authorise a body of any size.
  test("changes the signature, so the length is genuinely bound", () => {
    expect(signature(presign({ contentLength: 1024 }))).not.toBe(
      signature(presign({ contentLength: 1025 })),
    );
    expect(signature(presign({ contentLength: 1024 }))).not.toBe(signature(presign()));
  });

  // An empty object is a thing worth pinning the size of, so zero is a length rather than an
  // absent option.
  test("zero is a length, not an omission", () => {
    expect(signedHeaders(presignLength(0))).toBe("content-length;host");
  });

  // Sizes past 2^32 are ordinary for the uploads this exists to bound, and each has to reach the
  // signature as itself rather than saturating to one value.
  test("carries a size larger than a 32-bit length", () => {
    const eightGiB = 8 * 1024 * 1024 * 1024;

    expect(signedHeaders(presignLength(eightGiB))).toBe("content-length;host");
    expect(signature(presignLength(eightGiB))).not.toBe(signature(presignLength(eightGiB + 1)));
  });
});

// Only a PUT is signed with a length here. On anything else the option would sign a header
// the request is never going to send, so the URL would fail when used rather than when made.
// GET, POST, PUT, DELETE and HEAD are the methods presign accepts, so these are every non-PUT one.
describe.each(["GET", "POST", "DELETE", "HEAD"] as const)("presign contentLength on %s", method => {
  test("is refused", () => {
    expect(() => presign({ method, contentLength: 1024 })).toThrow(
      "contentLength is only supported when method is PUT",
    );
  });
});

describe.each([-1, Number.NEGATIVE_INFINITY] as const)("presign contentLength %p", value => {
  test("is refused for being negative", () => {
    expect(() => presignLength(value)).toThrow("contentLength must be greater than or equal to 0");
  });
});

/**
 * Presign options are read through a coercing reader — ToNumber, truncate, clamp — which
 * `s3-numeric-options-coerce.test.ts` pins for `expiresIn` after a strict validator turned out to
 * be a regression. `contentLength` is read the same way, so these say what that means for it.
 *
 * Each case asserts the signature matches the value it coerces to, which is the only way from
 * here to see the number that actually reached the canonical headers.
 */
describe.each([
  ["a numeric string", "1024", 1024],
  ["an empty string", "", 0],
  ["a fractional number", 1024.5, 1024],
  ["NaN", Number.NaN, 0],
  ["a value past the 64-bit range", 2 ** 63, Number.POSITIVE_INFINITY],
] as const)("presign contentLength coercion: %s", (_label, given, equivalent) => {
  test("signs as the value it coerces to", () => {
    expect(signature(presignLength(given))).toBe(signature(presignLength(equivalent)));
  });
});
