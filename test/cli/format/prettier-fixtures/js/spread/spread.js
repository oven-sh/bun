const foo = { ...(a || b) };
const foo2 = { ...a || b };
const foo3 = { ...(a ? b : c) };

async () => ({ ...(await foo) });
