import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    return NextResponse.json(
      { error: "APP_PASSWORD not configured on server" },
      { status: 500 }
    );
  }

  if (password !== expected) {
    return NextResponse.json({ error: "Invalid" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("auth", expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
