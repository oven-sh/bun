Used to test 3 behaviors:

1. `preload` can be an array
2. When a bunfig is specified via `--config=<path>`, the "default" bunfig (i.e.
   `bunfig.toml` in the same dir as cwd) is not loaded.
3. Using `--preload <file>` adds `<file>` to the preload list without clobbering
   existing preloads.
