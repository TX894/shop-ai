"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import Header from "@/components/Header";

// ---------- Types ----------

interface KeyInfo {
  set: boolean;
  masked: string;
}

interface StoreRow {
  id: string;
  name: string;
  domain: string;
  client_id: string;
  has_secret: boolean;
  has_token: boolean;
  is_active: boolean;
  created_at: string;
}

interface StoreForm {
  name: string;
  domain: string;
  client_id: string;
  client_secret: string;
}

const EMPTY_FORM: StoreForm = { name: "", domain: "", client_id: "", client_secret: "" };

// ---------- Component ----------

export default function SettingsPage() {
  // API Keys state
  const [keys, setKeys] = useState<Record<string, KeyInfo>>({});
  const [kieValue, setKieValue] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  // Stores state
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StoreForm>(EMPTY_FORM);
  const [savingStore, setSavingStore] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // ---------- Data loading ----------

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/keys");
      const data = await res.json();
      if (data.keys) setKeys(data.keys);
    } catch { /* ignore */ }
  }, []);

  const loadStores = useCallback(async () => {
    try {
      const res = await fetch("/api/stores");
      const data = await res.json();
      if (data.stores) setStores(data.stores);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadKeys();
    loadStores();
  }, [loadKeys, loadStores]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  // ---------- API Keys handlers ----------

  async function handleSaveKieKey() {
    if (!kieValue.trim()) return;
    setSavingKey(true);
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ KIE_AI_API_KEY: kieValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save");
        return;
      }
      if (data.keys) setKeys(data.keys);
      setKieValue("");
      toast.success("API key saved");
    } catch {
      toast.error("Network error");
    } finally {
      setSavingKey(false);
    }
  }

  // ---------- Store handlers ----------

  function openAddStore() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTestResult(null);
    setShowForm(true);
  }

  function openEditStore(store: StoreRow) {
    setEditingId(store.id);
    setForm({
      name: store.name,
      domain: store.domain,
      client_id: store.client_id,
      client_secret: "", // Never pre-fill secret
    });
    setTestResult(null);
    setShowForm(true);
    setMenuOpen(null);
  }

  async function handleTestConnection() {
    if (!form.domain.trim() || !form.client_id.trim() || !form.client_secret.trim()) {
      toast.error("Fill in domain, client ID, and client secret to test");
      return;
    }
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/stores/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: form.domain.trim(),
          client_id: form.client_id.trim(),
          client_secret: form.client_secret.trim(),
        }),
      });
      const data = await res.json();
      setTestResult({
        ok: data.ok,
        message: data.ok ? `Connected: ${data.shopName}` : (data.error || "Connection failed"),
      });
    } catch {
      setTestResult({ ok: false, message: "Network error" });
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleSaveStore() {
    if (!form.name.trim() || !form.domain.trim() || !form.client_id.trim()) {
      toast.error("Name, domain, and client ID are required");
      return;
    }
    if (!editingId && !form.client_secret.trim()) {
      toast.error("Client secret is required for new stores");
      return;
    }

    setSavingStore(true);
    try {
      if (editingId) {
        // PATCH existing
        const body: Record<string, string> = {
          name: form.name.trim(),
          domain: form.domain.trim(),
          client_id: form.client_id.trim(),
        };
        if (form.client_secret.trim()) {
          body.client_secret = form.client_secret.trim();
        }
        const res = await fetch(`/api/stores/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Failed to update store");
          return;
        }
        toast.success("Store updated");
      } else {
        // POST new
        const res = await fetch("/api/stores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            domain: form.domain.trim(),
            client_id: form.client_id.trim(),
            client_secret: form.client_secret.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Failed to create store");
          return;
        }
        toast.success("Store added");
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await loadStores();
    } catch {
      toast.error("Network error");
    } finally {
      setSavingStore(false);
    }
  }

  async function handleActivate(id: string) {
    setMenuOpen(null);
    try {
      const res = await fetch(`/api/stores/${id}/activate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to activate");
        return;
      }
      toast.success("Store activated");
      await loadStores();
    } catch {
      toast.error("Network error");
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    const store = stores.find((s) => s.id === deleteConfirm);
    if (!store || deleteInput !== store.name) return;

    try {
      const res = await fetch(`/api/stores/${deleteConfirm}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to delete");
        return;
      }
      toast.success("Store deleted");
      setDeleteConfirm(null);
      setDeleteInput("");
      await loadStores();
    } catch {
      toast.error("Network error");
    }
  }

  // ---------- Render ----------

  const kieInfo = keys["KIE_AI_API_KEY"];

  return (
    <>
      <Header />
      <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <div className="max-w-2xl mx-auto p-6 md:p-10">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Settings</h1>
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
              Manage API keys and store connections.
            </p>
          </div>

          <div className="space-y-8">
            {/* ═══ API Keys Section ═══ */}
            <section>
              <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-3">
                API Keys
              </h2>
              <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-stone-800 dark:text-stone-200">kie.ai API Key</p>
                    <p className="text-xs text-stone-400">AI image generation</p>
                  </div>
                  {kieInfo?.set && !kieValue && (
                    <span className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded">
                      Set
                    </span>
                  )}
                  {!kieInfo?.set && !kieValue && (
                    <span className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded">
                      Not set
                    </span>
                  )}
                </div>
                {kieInfo?.set && !kieValue && (
                  <p className="text-xs text-stone-400 font-mono mb-2">{kieInfo.masked}</p>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={kieValue}
                    onChange={(e) => setKieValue(e.target.value)}
                    placeholder={kieInfo?.set ? "Enter new value to update" : "Enter API key"}
                    className="flex-1 px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                  />
                  <button
                    onClick={handleSaveKieKey}
                    disabled={savingKey || !kieValue.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {savingKey ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </section>

            {/* ═══ Stores Section ═══ */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                  Stores
                </h2>
                <button
                  onClick={openAddStore}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
                >
                  + Add Store
                </button>
              </div>

              {stores.length === 0 && !showForm && (
                <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 text-center">
                  <p className="text-sm text-stone-500 dark:text-stone-400">
                    No stores configured. Add your first Shopify store to get started.
                  </p>
                </div>
              )}

              {stores.length > 0 && (
                <div className="space-y-2">
                  {stores.map((store) => (
                    <div
                      key={store.id}
                      className={`bg-white dark:bg-stone-900 border rounded-2xl p-4 flex items-center gap-3 ${
                        store.is_active
                          ? "border-indigo-300 dark:border-indigo-700"
                          : "border-stone-200 dark:border-stone-800"
                      }`}
                    >
                      {/* Active radio */}
                      <button
                        onClick={() => !store.is_active && handleActivate(store.id)}
                        className="flex-shrink-0"
                        title={store.is_active ? "Active store" : "Set as active"}
                      >
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            store.is_active
                              ? "border-indigo-600 dark:border-indigo-400"
                              : "border-stone-300 dark:border-stone-600 hover:border-stone-500"
                          }`}
                        >
                          {store.is_active && (
                            <div className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                          )}
                        </div>
                      </button>

                      {/* Store info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-800 dark:text-stone-200 truncate">
                          {store.name}
                        </p>
                        <p className="text-xs text-stone-400 truncate">{store.domain}</p>
                      </div>

                      {/* Status badges */}
                      {store.is_active && (
                        <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded flex-shrink-0">
                          Active
                        </span>
                      )}
                      {store.has_token && (
                        <span className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded flex-shrink-0">
                          Connected
                        </span>
                      )}

                      {/* Menu */}
                      <div className="relative flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen(menuOpen === store.id ? null : store.id);
                          }}
                          className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 px-1"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        </button>
                        {menuOpen === store.id && (
                          <div className="absolute right-0 top-8 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg z-10 py-1 min-w-[140px]">
                            <button
                              onClick={() => openEditStore(store)}
                              className="w-full text-left px-3 py-1.5 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700"
                            >
                              Edit
                            </button>
                            {!store.is_active && (
                              <button
                                onClick={() => handleActivate(store.id)}
                                className="w-full text-left px-3 py-1.5 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700"
                              >
                                Set as active
                              </button>
                            )}
                            {!store.is_active && (
                              <button
                                onClick={() => {
                                  setDeleteConfirm(store.id);
                                  setDeleteInput("");
                                  setMenuOpen(null);
                                }}
                                className="w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ═══ Add/Edit Store Form ═══ */}
              {showForm && (
                <div className="mt-4 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4 space-y-3">
                  <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                    {editingId ? "Edit Store" : "Add Store"}
                  </p>

                  <div>
                    <label className="text-xs text-stone-500 dark:text-stone-400">Store Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Audrey & Roman"
                      className="mt-1 w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 dark:text-stone-400">Domain</label>
                    <input
                      type="text"
                      value={form.domain}
                      onChange={(e) => setForm({ ...form, domain: e.target.value })}
                      placeholder="my-store.myshopify.com"
                      className="mt-1 w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    />
                    {form.domain && !form.domain.includes(".myshopify.com") && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Domain should end in .myshopify.com
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 dark:text-stone-400">Client ID</label>
                    <input
                      type="password"
                      value={form.client_id}
                      onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                      placeholder="shpca_..."
                      className="mt-1 w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-stone-500 dark:text-stone-400">
                      Client Secret{editingId ? " (leave blank to keep current)" : ""}
                    </label>
                    <input
                      type="password"
                      value={form.client_secret}
                      onChange={(e) => setForm({ ...form, client_secret: e.target.value })}
                      placeholder="shpcs_..."
                      className="mt-1 w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                    />
                  </div>

                  {/* Test Connection */}
                  <div>
                    <button
                      onClick={handleTestConnection}
                      disabled={testingConnection || !form.domain || !form.client_id || !form.client_secret}
                      className="text-xs px-3 py-1.5 border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 rounded hover:border-stone-500 disabled:opacity-50 transition-colors"
                    >
                      {testingConnection ? "Testing..." : "Test Connection"}
                    </button>
                    {testResult && (
                      <p
                        className={`text-xs mt-1.5 ${
                          testResult.ok
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {testResult.ok ? "\u2705 " : "\u274C "}
                        {testResult.message}
                      </p>
                    )}
                  </div>

                  {/* Form actions */}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveStore}
                      disabled={savingStore}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {savingStore ? "Saving..." : editingId ? "Update Store" : "Add Store"}
                    </button>
                    <button
                      onClick={() => {
                        setShowForm(false);
                        setEditingId(null);
                        setForm(EMPTY_FORM);
                        setTestResult(null);
                      }}
                      className="px-4 py-2 text-sm text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* ═══ Info section ═══ */}
            <section>
              <div className="bg-stone-100 dark:bg-stone-900/50 border border-stone-200 dark:border-stone-800 rounded-2xl p-4">
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  <strong>ANTHROPIC_KEY</strong> and <strong>APP_PASSWORD</strong> are managed via Vercel environment variables and cannot be changed here.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* ═══ Delete Confirmation Modal ═══ */}
      {deleteConfirm && (() => {
        const store = stores.find((s) => s.id === deleteConfirm);
        if (!store) return null;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-2">
                Delete Store
              </h3>
              <p className="text-sm text-stone-600 dark:text-stone-400 mb-4">
                This will remove <strong>{store.name}</strong>. Type the store name to confirm.
              </p>
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={store.name}
                className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setDeleteConfirm(null);
                    setDeleteInput("");
                  }}
                  className="px-4 py-2 text-sm text-stone-600 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteInput !== store.name}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
