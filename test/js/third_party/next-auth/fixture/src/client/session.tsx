"use client"
import { useSession } from "next-auth/react"
import { useEffect } from "react"

export function SessionState() {

  const { data: session, status } = useSession()

  useEffect( ()=> {
    

  });

  return  <div>status: {status}</div>

}