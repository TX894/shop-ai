import { NextRequest, NextResponse } from "next/server";
import { listStores, createStore } from "@/lib/stores";
import { ensureMigrations } from "@/lib/migrate";

export const runtime = "nodejs";

export async function GET() {
  await ensureMigrations();
  try {
    const stores = await listStores();
    // Strip secrets from list response
    const safe = stores.map(({ client_secret, access_token, ...rest }) => ({
      ...rest,
      has_secret: !!client_secret,
      has_token: !!access_token,
    }));
    return NextResponse.json({ stores: safe });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { name?: string; domain?: string; client_id?: string; client_secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim() || !body.domain?.trim() || !body.client_id?.trim() || !body.client_secret?.trim()) {
    return NextResponse.json(
      { error: "name, domain, client_id, and client_secret are required" },
      { status: 400 }
    );
  }

  try {
    const store = await createStore({
      name: body.name.trim(),
      domain: body.domain.trim(),
      client_id: body.client_id.trim(),
      client_secret: body.client_secret.trim(),
    });
    return NextResponse.json({ store }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
