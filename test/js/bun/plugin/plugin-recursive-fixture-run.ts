try {
  require("recursive:recursive");
} catch (e: any) {
  console.log(e.message);
}

await import("recursive:recursive");
