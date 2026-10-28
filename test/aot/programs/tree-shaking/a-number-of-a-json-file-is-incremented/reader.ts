import data from "./data.json";
export const read = () => [data.version, data.nested.port, data.nested.deep.on, data.nested.deep.off].join();
