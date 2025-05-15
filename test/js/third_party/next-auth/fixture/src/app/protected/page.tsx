import { auth, signOut } from "@/auth";

export default async function ProtectedPage() {
  const session = await auth();
  
  return (
    <div >
    <form action={async () => {
      "use server";
      await signOut({ redirectTo: "/" });
    }}>
      <button
        type="submit"
      >
        Sign out
      </button>
    </form>
  </div>
  );
}