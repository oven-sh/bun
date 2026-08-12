import type { BunPlugin } from "bun";

declare global {
  var setups: number;
}

// Loaded both through `[serve.static] plugins` (bunfig.toml, once per server)
// and passed directly to Bun.build() by the fixture. Same module instance
// either way, so this counts every setup() call in the process.
globalThis.setups = 0;

const plugin: BunPlugin = {
  name: "plugin-cell-probe",
  setup(build) {
    globalThis.setups++;
    build.onLoad({ filter: /\.txt$/ }, () => ({
      loader: "text",
      contents: "text-from-plugin",
    }));
  },
};

export default plugin;
