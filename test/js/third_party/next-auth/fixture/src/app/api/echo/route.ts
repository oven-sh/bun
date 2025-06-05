import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return Response.json(body);
  } catch (error) {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}