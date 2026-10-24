function make(known: boolean): { size: number } { let size!: number; if (known) size = 1; return { size }; }
export const made = make([1].length > 1);
