// Read during the build (piped: false) so the property is reified; the restored launch runs on a terminal and must see its own answer.
void Bun.enableANSIColors;
process.on("restore", () => {
  require("fs").writeFileSync(process.env.COLORS_OUT, String(Bun.enableANSIColors));
  process.exit(0);
});
setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
