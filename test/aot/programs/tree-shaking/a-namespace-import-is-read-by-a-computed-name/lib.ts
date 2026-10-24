function shared(text: string) { return text + " via shared"; }
export function alpha() { return shared("alpha"); }
export const beta = () => shared("beta");
export const gamma = function () { return shared("gamma"); };
