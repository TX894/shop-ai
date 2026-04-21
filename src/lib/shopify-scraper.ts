import type { ShopifyProduct } from "@/types/shopify";

interface ParsedInput {
  domain: string;
  collectionHandle: string | null;
  isProductUrl: boolean;
}

function parseInput(input: string): ParsedInput {
  let s = input.trim();
  if (!s.startsWith("http://") && !s.startsWith("https://")) {
    s = "https://" + s;
  }

  const parsed = new URL(s);
  const domain = parsed.hostname.replace(/^www\./, "");
  // pathname without query/hash — URL constructor already strips those
  const path = parsed.pathname.replace(/\/$/, ""); // strip trailing slash

  // /products/[handle] — individual product page
  if (/^\/products\/[^/]+/.test(path)) {
    return { domain, collectionHandle: null, isProductUrl: true };
  }

  // /collections/[handle] (optionally followed by /products or sub-path)
  const collMatch = path.match(/^\/collections\/([^/]+)/);
  if (collMatch) {
    return { domain, collectionHandle: collMatch[1], isProductUrl: false };
  }

  return { domain, collectionHandle: null, isProductUrl: false };
}

export interface ScanResult {
  products: ShopifyProduct[];
  collectionHandle: string | null;
}

export async function scanStore(input: string): Promise<ScanResult> {
  const { domain, collectionHandle, isProductUrl } = parseInput(input);

  if (isProductUrl) {
    throw new Error(
      "Este URL é de um produto individual. Cola o URL da loja (ex: mayahenryjewelers.com) ou de uma coleção (ex: .../collections/earrings)."
    );
  }

  const base = `https://${domain}`;
  const products: ShopifyProduct[] = [];
  let page = 1;

  while (true) {
    const url = collectionHandle
      ? `${base}/collections/${collectionHandle}/products.json?limit=250&page=${page}`
      : `${base}/products.json?limit=250&page=${page}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });
    } catch (err) {
      throw new Error(
        `Não foi possível ligar a ${domain}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (res.status === 404) {
      const subject = collectionHandle
        ? `coleção "${collectionHandle}" em ${domain}`
        : `${domain}`;
      throw new Error(
        `Não foi possível aceder ${subject} — endpoint bloqueado, coleção inexistente, ou domínio não é uma loja Shopify`
      );
    }
    if (!res.ok) {
      throw new Error(`Erro ao aceder ${domain}: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { products: ShopifyProduct[] };
    if (!Array.isArray(data.products) || data.products.length === 0) break;

    products.push(...data.products);
    if (data.products.length < 250) break;
    page++;
  }

  return { products, collectionHandle };
}
