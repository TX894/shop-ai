import { NextRequest, NextResponse } from "next/server";
import { graphql } from "@/lib/shopify-admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await graphql<{
      collections: {
        edges: {
          node: {
            id: string;
            title: string;
            handle: string;
            productsCount: { count: number };
          };
        }[];
      };
    }>(
      `query {
        collections(first: 100) {
          edges {
            node {
              id
              title
              handle
              productsCount { count }
            }
          }
        }
      }`
    );

    const collections = data.collections.edges.map((e) => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      productsCount: e.node.productsCount.count,
    }));

    return NextResponse.json({ collections });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const data = await graphql<{
      collectionCreate: {
        collection: { id: string; title: string; handle: string } | null;
        userErrors: { field: string[]; message: string }[];
      };
    }>(
      `mutation collectionCreate($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id title handle }
          userErrors { field message }
        }
      }`,
      { input: { title: body.title.trim() } }
    );

    const errors = data.collectionCreate.userErrors;
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.map((e) => e.message).join("; ") },
        { status: 422 }
      );
    }

    return NextResponse.json(data.collectionCreate.collection, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
