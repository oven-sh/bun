"use client"
import { SessionProvider } from "next-auth/react"
import { SessionState } from './session';

export function ClientComponent() {


  return <SessionProvider> <SessionState/></SessionProvider>

}