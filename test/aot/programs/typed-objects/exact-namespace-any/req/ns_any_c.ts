import * as main from "../main"
export function early(): string { try { return String((main as any).lateBinding) } catch (e) { return (e as Error).constructor.name } }
export const atLoad = early()
