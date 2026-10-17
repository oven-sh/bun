// `new`, through `any`, on plain functions whose `this` parameter is typed.
import { type Node, type Token } from "./req/shapes.js"
function Node(this: { kind: number }, kind: number) { this.kind = kind }
function Token(this: { text: string }, text: string) { this.text = text }
const allocator = { node: () => Node as any, token: () => Token as any }
try { const n: Node = new (allocator.node())(4); console.log("new Node: no error") } catch (e) { console.log("new Node:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const t: Token = new (allocator.token())("t"); console.log("new Token: no error") } catch (e) { console.log("new Token:", e instanceof TypeError ? "TypeError" : "other " + e) }
