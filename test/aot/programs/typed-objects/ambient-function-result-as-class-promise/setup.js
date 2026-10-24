globalThis.functionWithoutCode = kind => () => Promise.resolve(kind === "a list" ? [{ field: "given " + kind }] : { field: "given " + kind });
