// The file beside this one is a further entry point of the build: a load under a computed name finds a file of the executable only if it is one.
await import(process.env.NAME_OF_THE_MEASURED_FILE ?? "./measured.js");
export {};
