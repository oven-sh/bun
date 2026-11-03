import { digest, bytes } from './reads-barrel-of-library.js'
export function underTest(text) { return [digest(text), bytes()] }
