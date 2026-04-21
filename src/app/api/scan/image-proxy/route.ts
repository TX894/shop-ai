import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "only https URLs allowed" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(rawUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `HTTP ${res.status}` },
      { status: 502 }
    );
  }

  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const imageBase64 = Buffer.from(buffer).toString("base64");

  return NextResponse.json({ imageBase64, mimeType });
}
