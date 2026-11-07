import { createHash, randomBytes } from './barrel-of-library.js'
export function digest(text) { return createHash('sha1').update(text).digest('hex').slice(0, 8) }
export function bytes() { return randomBytes(4).length }
