type Narrow = { size: number };
type Wide = { size: number | string };
function make(): { twice: number } { const narrow: Narrow = { size: 1 }; const wide: Wide = narrow; wide.size = "s"; return { twice: narrow.size * 2 }; }
export const made = make();
