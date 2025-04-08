import type { APIRoute } from "astro";

export const POST: APIRoute = async function ({ request }) {
  try {
    const formData = await request.formData();

    return new Response(JSON.stringify(Object.fromEntries(formData)), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response("Error", { status: 500 });
  }
};
