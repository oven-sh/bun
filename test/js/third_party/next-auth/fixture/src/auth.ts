import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnProtectedPage = nextUrl.pathname.startsWith("/protected");
      if (isOnProtectedPage) {
        if (isLoggedIn) return true;
        return false; // Redirect to login page
      } else if (isLoggedIn) {
        return true;
      }
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.user = user;
      }
      return token;
    },
    async session({ session, token }) {
      //@ts-ignore
      session.user = token.user;
      return session;
    },
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // This is a demo authentication - in a real app you would validate against a database
        if (credentials?.email === "user@example.com" && credentials?.password === "password") {
          return {
            id: "1",
            email: "user@example.com",
            name: "Demo User",
          };
        }
        
        return null;
      }
    })
  ],
  
  session: {
    strategy: "jwt",
  },
};

export const { auth, signIn, signOut, handlers } = NextAuth(authConfig);