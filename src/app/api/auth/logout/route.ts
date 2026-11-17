import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  // Delete session cookie by setting it to expire immediately
  cookies().set('session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0, // Expire immediately
    expires: new Date(0),
  });

  return NextResponse.json({ success: true }, { status: 200 });
}
