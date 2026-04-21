"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { SkeletonGrid } from "@/components/Skeleton";

interface LibraryItem {
  id: string;
  created_at: string;
  preset_id: string;
  collection: string;
  role: string;
  prompt: string | null;
  notes: string | null;
  shopify_product_id: string | null;
  shopify_admin_url: string | null;
  source_store: string | null;
  imported_at: string | null;
}

interface ShopifyConnection {
  tested: boolean;
  ok: boolean;
  shopName?: string;
  domain?: string;
  error?: string;
}

interface PushState {
  phase: "idle" | "pushing" | "done" | "error";
  step: string;
  result?: {
    productId: string;
    handle: string;
    adminUrl: string;
    status: string;
    imagesUploaded: number;
  };
  error?: string;
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Multi-select for Shopify push
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Shopify push modal
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushTitle, setPushTitle] = useState("New Product");
  const [pushDescription, setPushDescription] = useState("");
  const [pushPrice, setPushPrice] = useState("29.95");
  const [pushVendor, setPushVendor] = useState("Audrey & Roman");
  const [pushProductType, setPushProductType] = useState("Jewellery");
  const [pushTags, setPushTags] = useState("closing-sale");
  const [pushStatus, setPushStatus] = useState<"DRAFT" | "ACTIVE">("DRAFT");
  const [pushState, setPushState] = useState<PushState>({
    phase: "idle",
    step: "",
  });

  // Shopify connection test
  const [shopify, setShopify] = useState<ShopifyConnection>({
    tested: false,
    ok: false,
  });

  // Filter
  const [filter, setFilter] = useState<"all" | "imported" | "not-imported">("all");

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/library?limit=200");
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  async function testShopifyConnection() {
    setShopify({ tested: false, ok: false });
    try {
      const res = await fetch("/api/shopify/test-auth");
      const data = await res.json();
      setShopify({
        tested: true,
        ok: data.ok,
        shopName: data.shopName,
        domain: data.domain,
        error: data.error,
      });
    } catch {
      setShopify({ tested: true, ok: false, error: "Network error" });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Apagar esta imagem da library?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/library/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== id));
      setTotal((prev) => prev - 1);
      if (selectedId === id) setSelectedId(null);
      setCheckedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setDeleting(null);
    }
  }

  function downloadImage(id: string, type: "result" | "original") {
    const a = document.createElement("a");
    a.href = `/api/library/${id}/image?type=${type}`;
    a.download = `${id}-${type}.png`;
    a.click();
  }

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPushModal() {
    setPushState({ phase: "idle", step: "" });
    setShowPushModal(true);
  }

  async function handlePush() {
    setPushState({ phase: "pushing", step: "A iniciar..." });

    try {
      const res = await fetch("/api/shopify/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          libraryItemIds: [...checkedIds],
          productDetails: {
            title: pushTitle,
            descriptionHtml: pushDescription
              ? `<p>${pushDescription}</p>`
              : "",
            priceGBP: pushPrice,
            vendor: pushVendor,
            productType: pushProductType,
            tags: pushTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            status: pushStatus,
          },
        }),
      });

      if (!res.ok || !res.body) {
        setPushState({
          phase: "error",
          step: "",
          error: `HTTP ${res.status}`,
        });
        return;
      }

      // Read SSE
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.status === "progress") {
              setPushState((prev) => ({ ...prev, step: event.step }));
            } else if (event.status === "done") {
              setPushState({
                phase: "done",
                step: "Pronto!",
                result: event.result,
              });
            } else if (event.status === "error") {
              setPushState({
                phase: "error",
                step: "",
                error: event.error,
              });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      setPushState({
        phase: "error",
        step: "",
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  // Filtered items
  const filteredItems = items.filter((item) => {
    if (filter === "imported") return !!item.shopify_product_id;
    if (filter === "not-imported") return !item.shopify_product_id;
    return true;
  });

  const selected = items.find((i) => i.id === selectedId);

  return (
    <>
    <Header />
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <div className="max-w-6xl mx-auto p-6 md:p-10">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Library</h1>
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
              {total} image{total !== 1 ? "s" : ""} saved
            </p>
          </div>
          <div className="flex gap-2">
            {items.length > 0 && (
              <button
                onClick={() => {
                  setSelectMode(!selectMode);
                  if (selectMode) setCheckedIds(new Set());
                }}
                className={`text-sm px-3 py-2 rounded-xl border transition-colors ${
                  selectMode
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:border-stone-500"
                }`}
              >
                {selectMode ? "Cancel selection" : "Select"}
              </button>
            )}
          </div>
        </div>

        {/* Shopify connection test */}
        <div className="mb-6 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-stone-700">
                Shopify
              </span>
              {shopify.tested && shopify.ok && (
                <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
                  Conectado a &ldquo;{shopify.shopName}&rdquo; ({shopify.domain}
                  )
                </span>
              )}
              {shopify.tested && !shopify.ok && (
                <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                  Erro: {shopify.error}
                </span>
              )}
            </div>
            <button
              onClick={testShopifyConnection}
              className="text-xs px-3 py-1.5 border border-stone-300 rounded text-stone-600 hover:border-stone-500 hover:text-stone-900"
            >
              Testar conexão
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {items.length > 0 && (
          <div className="mb-4 flex gap-2">
            {(["all", "imported", "not-imported"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded ${
                  filter === f
                    ? "bg-stone-800 text-white"
                    : "border border-stone-200 text-stone-500 hover:border-stone-400"
                }`}
              >
                {f === "all" ? `All (${items.length})` : f === "imported" ? `Imported (${items.filter((i) => i.shopify_product_id).length})` : `Not imported (${items.filter((i) => !i.shopify_product_id).length})`}
              </button>
            ))}
          </div>
        )}

        {/* Selection toolbar */}
        {selectMode && checkedIds.size > 0 && (
          <div className="mb-4 flex items-center justify-between bg-stone-800 text-white rounded-lg px-4 py-3">
            <span className="text-sm">
              {checkedIds.size} imagem{checkedIds.size !== 1 ? "s" : ""}{" "}
              selecionada{checkedIds.size !== 1 ? "s" : ""}
            </span>
            <button
              onClick={openPushModal}
              className="text-sm bg-white text-stone-800 px-4 py-1.5 rounded hover:bg-stone-100 font-medium"
            >
              Criar produto na Shopify
            </button>
          </div>
        )}

        {loading && <SkeletonGrid count={10} />}

        {!loading && items.length === 0 && (
          <div className="text-center py-20 text-stone-400">
            <p className="text-lg mb-2">Nenhuma imagem na library</p>
            <p className="text-sm">
              Processa imagens na{" "}
              <Link href="/" className="underline hover:text-stone-600">
                página principal
              </Link>{" "}
              e guarda os resultados.
            </p>
          </div>
        )}

        {/* Detail modal */}
        {selected && !showPushModal && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedId(null)}
          >
            <div
              className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-stone-200 flex items-center justify-between">
                <div>
                  <span className="text-xs uppercase tracking-wide text-stone-400">
                    {selected.preset_id} / {selected.collection} /{" "}
                    {selected.role}
                  </span>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {new Date(selected.created_at + "Z").toLocaleString(
                      "pt-PT"
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-stone-400 hover:text-stone-800 text-xl leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2">
                <div className="p-4 border-b md:border-b-0 md:border-r border-stone-200">
                  <p className="text-xs uppercase tracking-wide text-stone-500 mb-2">
                    Original
                  </p>
                  <img
                    src={`/api/library/${selected.id}/image?type=original`}
                    alt="original"
                    className="w-full rounded"
                  />
                </div>
                <div className="p-4">
                  <p className="text-xs uppercase tracking-wide text-stone-500 mb-2">
                    Processada
                  </p>
                  <img
                    src={`/api/library/${selected.id}/image?type=result`}
                    alt="result"
                    className="w-full rounded"
                  />
                </div>
              </div>

              {selected.prompt && (
                <details className="border-t border-stone-200 p-3 text-xs text-stone-600">
                  <summary className="cursor-pointer text-stone-500">
                    Ver prompt usado
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap font-mono">
                    {selected.prompt}
                  </p>
                </details>
              )}

              <div className="p-4 border-t border-stone-200 flex gap-2">
                <button
                  onClick={() => downloadImage(selected.id, "result")}
                  className="text-sm bg-stone-800 text-white px-4 py-2 rounded hover:bg-stone-900"
                >
                  Download resultado
                </button>
                <button
                  onClick={() => downloadImage(selected.id, "original")}
                  className="text-sm border border-stone-300 text-stone-700 px-4 py-2 rounded hover:border-stone-500"
                >
                  Download original
                </button>
                <button
                  onClick={() => {
                    setSelectedId(null);
                    handleDelete(selected.id);
                  }}
                  className="ml-auto text-sm text-red-600 hover:text-red-800 px-4 py-2 rounded hover:bg-red-50"
                >
                  Apagar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Shopify push modal */}
        {showPushModal && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => {
              if (pushState.phase !== "pushing") setShowPushModal(false);
            }}
          >
            <div
              className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-stone-200 flex items-center justify-between">
                <h2 className="text-lg font-medium text-stone-800">
                  Criar produto na Shopify
                </h2>
                {pushState.phase !== "pushing" && (
                  <button
                    onClick={() => setShowPushModal(false)}
                    className="text-stone-400 hover:text-stone-800 text-xl leading-none"
                  >
                    &times;
                  </button>
                )}
              </div>

              {pushState.phase === "done" && pushState.result ? (
                <div className="p-6 text-center space-y-4">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <svg
                      className="w-6 h-6 text-green-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-stone-800">
                      Produto criado com sucesso!
                    </p>
                    <p className="text-xs text-stone-500 mt-1">
                      {pushState.result.imagesUploaded} imagem
                      {pushState.result.imagesUploaded !== 1 ? "s" : ""}{" "}
                      carregada
                      {pushState.result.imagesUploaded !== 1 ? "s" : ""} ·
                      Status: {pushState.result.status}
                    </p>
                  </div>
                  <a
                    href={pushState.result.adminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm bg-stone-800 text-white px-6 py-2 rounded hover:bg-stone-900"
                  >
                    Ver no admin Shopify
                  </a>
                  <button
                    onClick={() => {
                      setShowPushModal(false);
                      setSelectMode(false);
                      setCheckedIds(new Set());
                    }}
                    className="block mx-auto text-xs text-stone-500 hover:text-stone-800"
                  >
                    Fechar
                  </button>
                </div>
              ) : pushState.phase === "error" ? (
                <div className="p-6 space-y-4">
                  <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded p-3">
                    {pushState.error}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePush}
                      className="text-sm bg-stone-800 text-white px-4 py-2 rounded hover:bg-stone-900"
                    >
                      Tentar novamente
                    </button>
                    <button
                      onClick={() => setShowPushModal(false)}
                      className="text-sm border border-stone-300 text-stone-600 px-4 py-2 rounded hover:border-stone-500"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : pushState.phase === "pushing" ? (
                <div className="p-6 text-center space-y-3">
                  <div className="w-8 h-8 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-stone-700">{pushState.step}</p>
                </div>
              ) : (
                /* Form */
                <div className="p-4 space-y-4">
                  <p className="text-xs text-stone-500">
                    {checkedIds.size} imagem
                    {checkedIds.size !== 1 ? "s" : ""} selecionada
                    {checkedIds.size !== 1 ? "s" : ""}
                  </p>

                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">
                      Título
                    </label>
                    <input
                      type="text"
                      value={pushTitle}
                      onChange={(e) => setPushTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">
                      Descrição
                    </label>
                    <textarea
                      value={pushDescription}
                      onChange={(e) => setPushDescription(e.target.value)}
                      rows={3}
                      placeholder="Descrição do produto (opcional)"
                      className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">
                        Preço (GBP)
                      </label>
                      <input
                        type="text"
                        value={pushPrice}
                        onChange={(e) => setPushPrice(e.target.value)}
                        className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">
                        Vendor
                      </label>
                      <input
                        type="text"
                        value={pushVendor}
                        onChange={(e) => setPushVendor(e.target.value)}
                        className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">
                        Product Type
                      </label>
                      <input
                        type="text"
                        value={pushProductType}
                        onChange={(e) => setPushProductType(e.target.value)}
                        className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">
                        Status
                      </label>
                      <select
                        value={pushStatus}
                        onChange={(e) =>
                          setPushStatus(e.target.value as "DRAFT" | "ACTIVE")
                        }
                        className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 bg-white"
                      >
                        <option value="DRAFT">Draft (rascunho)</option>
                        <option value="ACTIVE">Active (publicado)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">
                      Tags (separadas por vírgula)
                    </label>
                    <input
                      type="text"
                      value={pushTags}
                      onChange={(e) => setPushTags(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    />
                  </div>

                  <button
                    onClick={handlePush}
                    disabled={!pushTitle.trim()}
                    className="w-full bg-stone-800 text-white py-3 rounded hover:bg-stone-900 disabled:opacity-50 text-sm"
                  >
                    Criar produto ({checkedIds.size} imagem
                    {checkedIds.size !== 1 ? "s" : ""})
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Grid */}
        {filteredItems.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredItems.map((item) => {
              const isChecked = checkedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`group relative bg-white dark:bg-stone-900 rounded-2xl border overflow-hidden cursor-pointer transition-all hover:shadow-md ${
                    isChecked
                      ? "border-indigo-500 ring-2 ring-indigo-500"
                      : "border-stone-200 dark:border-stone-800"
                  }`}
                  onClick={() => {
                    if (selectMode) {
                      toggleCheck(item.id);
                    } else {
                      setSelectedId(item.id);
                    }
                  }}
                >
                  {/* Checkbox in select mode */}
                  {selectMode && (
                    <div className="absolute top-2 left-2 z-10">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isChecked
                            ? "bg-stone-800 border-stone-800"
                            : "bg-white border-stone-300"
                        }`}
                      >
                        {isChecked && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="aspect-square">
                    <img
                      src={`/api/library/${item.id}/image?type=result`}
                      alt="result"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
                        {item.role}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
                        {item.preset_id}
                      </span>
                      {item.shopify_admin_url && (
                        <a
                          href={item.shopify_admin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] uppercase tracking-wide bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200 hover:bg-green-100"
                        >
                          Shopify
                        </a>
                      )}
                    </div>
                    {item.source_store && (
                      <p className="text-[10px] text-stone-400 mt-0.5 truncate">
                        {item.source_store}
                      </p>
                    )}
                    <p className="text-[10px] text-stone-400 mt-0.5">
                      {new Date(item.created_at + "Z").toLocaleDateString(
                        "pt-PT"
                      )}
                    </p>
                  </div>

                  {/* Delete button on hover (only when not in select mode) */}
                  {!selectMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id);
                      }}
                      disabled={deleting === item.id}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 hover:bg-red-50 text-stone-400 hover:text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-xs"
                      title="Apagar"
                    >
                      {deleting === item.id ? "..." : "\u00d7"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
    </>
  );
}
