try {
  require("recursive:recursive");
} catch (e: any) {
  console.log(e.message);
}

// @ts-expect-error
await import("recursive:recursive");
