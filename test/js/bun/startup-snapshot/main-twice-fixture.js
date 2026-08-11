// A program has one main(): the second registration is an error in an ordinary launch and in the snapshot run alike.
Bun.startupSnapshot.main(() => console.log("[js] first main ran"));
try {
  Bun.startupSnapshot.main(() => console.log("[js] second main ran"));
  console.log("[js] second main accepted");
} catch (e) {
  console.log("[js] second main rejected");
}
if (!process.env.PLAIN) setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
