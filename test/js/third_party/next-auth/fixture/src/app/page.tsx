import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  
  return (
    <div>Hello</div>
  );
}
