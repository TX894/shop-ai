"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Key, Store, Sparkles, Trash2, Pencil, Check, X as XIcon, Loader2 } from "lucide-react";
import Header from "@/components/Header";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

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
  brand_brief: string | null;
  niche: string | null;
  target_audience: string | null;
  brand_voice: string | null;
  value_props: string | null;
  default_language: string | null;
  currency: string | null;
  created_at: string;
}

interface StoreForm {
  name: string;
  domain: string;
  client_id: string;
  client_secret: string;
}

interface BrainForm {
  brand_brief: string;
  niche: string;
  target_audience: string;
  brand_voice: string;
  value_props: string;
  default_language: string;
  currency: string;
}

const EMPTY_STORE: StoreForm = { name: "", domain: "", client_id: "", client_secret: "" };
const EMPTY_BRAIN: BrainForm = {
  brand_brief: "",
  niche: "",
  target_audience: "",
  brand_voice: "",
  value_props: "",
  default_language: "pt",
  currency: "£",
};

const LANGUAGES = [
  { value: "pt", label: "Portuguese (PT)" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
];

const CURRENCIES = ["£", "€", "$", "R$", "CHF", "kr"];

// Sample copy to inspire the user — clicked to fill in
const BRAIN_EXAMPLES: Record<string, BrainForm> = {
  "luxury-watches": {
    brand_brief: "Curated men's automatic watches — affordable Swiss-style design without the markup of legacy brands.",
    niche: "Men's watches, watch enthusiasts, gift category, accessible luxury",
    target_audience: "Men 25–45 who appreciate craftsmanship but won't drop £5k on a Rolex. Often a first 'real' watch buyer.",
    brand_voice: "Confident, succinct, premium. No hype words. Talks specs like a watchmaker would — case material, movement, lume, water resistance.",
    value_props: "Sapphire crystal, automatic movements, 5ATM water resistance, 2-year warranty, £29 free shipping, 30-day returns.",
    default_language: "pt",
    currency: "£",
  },
  "wellness-recovery": {
    brand_brief: "At-home recovery and pain-relief tools for desk workers, athletes and the over-40s.",
    niche: "Wellness, recovery, ergonomics, pain relief, joint support",
    target_audience: "Adults 30–65 dealing with carpal tunnel, back pain, arthritis or post-workout recovery. Want non-medical alternatives.",
    brand_voice: "Warm, reassuring, evidence-led. We never make medical claims; we talk about comfort, relief, routine.",
    value_props: "Doctor-designed, clinically inspired, ships within 24h, free PDF guides, hassle-free 60-day returns.",
    default_language: "pt",
    currency: "£",
  },
};

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<"stores" | "brain" | "keys">("stores");

  // API Keys
  const [keys, setKeys] = useState<Record<string, KeyInfo>>({});
  const [kieValue, setKieValue] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  // Stores
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StoreForm>(EMPTY_STORE);
  const [savingStore, setSavingStore] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteInput, setDeleteInput] = useState("");

  // Brain (store intelligence)
  const [brain, setBrain] = useState<BrainForm>(EMPTY_BRAIN);
  const [savingBrain, setSavingBrain] = useState(false);

  const activeStore = stores.find((s) => s.is_active) ?? null;

  // Load
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
  useEffect(() => { loadKeys(); loadStores(); }, [loadKeys, loadStores]);

  // Sync brain form to active store whenever it changes
  useEffect(() => {
    if (!activeStore) return;
    setBrain({
      brand_brief: activeStore.brand_brief ?? "",
      niche: activeStore.niche ?? "",
      target_audience: activeStore.target_audience ?? "",
      brand_voice: activeStore.brand_voice ?? "",
      value_props: activeStore.value_props ?? "",
      default_language: activeStore.default_language ?? "pt",
      currency: activeStore.currency ?? "£",
    });
  }, [activeStore?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────

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
      if (!res.ok) { toast.error(data.error || "Failed to save"); return; }
      if (data.keys) setKeys(data.keys);
      setKieValue("");
      toast.success("API key saved");
    } catch { toast.error("Network error"); }
    finally { setSavingKey(false); }
  }

  function openAddStore() {
    setEditingId(null);
    setForm(EMPTY_STORE);
    setTestResult(null);
    setShowForm(true);
  }
  function openEditStore(s: StoreRow) {
    setEditingId(s.id);
    setForm({ name: s.name, domain: s.domain, client_id: s.client_id, client_secret: "" });
    setTestResult(null);
    setShowForm(true);
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
      setTestResult({ ok: data.ok, message: data.ok ? `Connected: ${data.shopName}` : (data.error || "Connection failed") });
    } catch { setTestResult({ ok: false, message: "Network error" }); }
    finally { setTestingConnection(false); }
  }

  async function handleSaveStore() {
    if (!form.name.trim() || !form.domain.trim() || !form.client_id.trim()) {
      toast.error("Name, domain, and client ID are required"); return;
    }
    if (!editingId && !form.client_secret.trim()) {
      toast.error("Client secret is required for new stores"); return;
    }
    setSavingStore(true);
    try {
      if (editingId) {
        const body: Record<string, string> = {
          name: form.name.trim(), domain: form.domain.trim(), client_id: form.client_id.trim(),
        };
        if (form.client_secret.trim()) body.client_secret = form.client_secret.trim();
        const res = await fetch(`/api/stores/${editingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) { toast.error(data.error || "Failed to update store"); return; }
        toast.success("Store updated");
      } else {
        const res = await fetch("/api/stores", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(), domain: form.domain.trim(),
            client_id: form.client_id.trim(), client_secret: form.client_secret.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) { toast.error(data.error || "Failed to create store"); return; }
        toast.success("Store added");
      }
      setShowForm(false); setForm(EMPTY_STORE); setEditingId(null);
      await loadStores();
    } catch { toast.error("Network error"); }
    finally { setSavingStore(false); }
  }

  async function handleActivate(id: string) {
    try {
      const res = await fetch(`/api/stores/${id}/activate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to activate"); return; }
      toast.success("Store activated");
      await loadStores();
    } catch { toast.error("Network error"); }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    const s = stores.find((x) => x.id === deleteConfirm);
    if (!s || deleteInput !== s.name) return;
    try {
      const res = await fetch(`/api/stores/${deleteConfirm}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to delete"); return; }
      toast.success("Store deleted");
      setDeleteConfirm(null); setDeleteInput("");
      await loadStores();
    } catch { toast.error("Network error"); }
  }

  async function handleSaveBrain() {
    if (!activeStore) { toast.error("Activate a store first"); return; }
    setSavingBrain(true);
    try {
      const res = await fetch(`/api/stores/${activeStore.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_brief: brain.brand_brief.trim() || null,
          niche: brain.niche.trim() || null,
          target_audience: brain.target_audience.trim() || null,
          brand_voice: brain.brand_voice.trim() || null,
          value_props: brain.value_props.trim() || null,
          default_language: brain.default_language.trim() || null,
          currency: brain.currency.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Failed to save brand profile"); return; }
      toast.success("Brand profile saved");
      await loadStores();
    } catch { toast.error("Network error"); }
    finally { setSavingBrain(false); }
  }

  // ── Render ────────────────────────────────────────────────────────

  const kieInfo = keys["KIE_AI_API_KEY"];
  const brainFilled = Object.values(brain).filter((v) => v && v.trim()).length;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 dark:from-stone-950 dark:to-stone-900">
        <div className="max-w-4xl mx-auto p-6 md:p-10">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">Settings</h1>
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-1.5">
              {activeStore ? (
                <>Active store: <span className="font-medium text-stone-700 dark:text-stone-300">{activeStore.name}</span></>
              ) : "No active store"}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-white/60 dark:bg-stone-900/60 backdrop-blur rounded-2xl p-1.5 border border-stone-200/70 dark:border-stone-800 w-fit">
            {[
              { id: "stores" as const, label: "Stores", icon: Store },
              { id: "brain" as const, label: "Brand Intelligence", icon: Sparkles, badge: brainFilled > 0 ? `${brainFilled}/7` : undefined },
              { id: "keys" as const, label: "API Keys", icon: Key },
            ].map((t) => {
              const Ic = t.icon;
              const isActive = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-stone-900 text-white dark:bg-white dark:text-stone-900 shadow-sm"
                    : "text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
                }`}>
                  <Ic size={15} />
                  {t.label}
                  {t.badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20" : "bg-stone-200 dark:bg-stone-800"}`}>{t.badge}</span>}
                </button>
              );
            })}
          </div>

          {/* ─── STORES TAB ───────────────────────────────────────── */}
          {tab === "stores" && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-stone-600 dark:text-stone-400 uppercase tracking-wider">Your Shopify stores</h2>
                <button onClick={openAddStore} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition">+ Add store</button>
              </div>

              {stores.length === 0 && !showForm && (
                <div className="bg-white dark:bg-stone-900 border-2 border-dashed border-stone-200 dark:border-stone-800 rounded-2xl p-12 text-center">
                  <Store className="mx-auto mb-3 text-stone-400" size={32} />
                  <p className="text-sm text-stone-500 dark:text-stone-400">No stores yet. Add one to start importing.</p>
                </div>
              )}

              {stores.map((s) => (
                <div key={s.id} className={`bg-white dark:bg-stone-900 rounded-2xl p-5 flex items-center gap-4 transition-all ${
                  s.is_active ? "ring-2 ring-indigo-500/40 border-indigo-300 dark:border-indigo-700 shadow-sm" : "border border-stone-200 dark:border-stone-800"
                }`}>
                  <button onClick={() => !s.is_active && handleActivate(s.id)} className="flex-shrink-0">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${s.is_active ? "border-indigo-600 bg-indigo-600" : "border-stone-300 dark:border-stone-600 hover:border-stone-500"}`}>
                      {s.is_active && <Check className="text-white" size={12} strokeWidth={4} />}
                    </div>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">{s.name}</p>
                      {s.is_active && <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-1.5 py-0.5 rounded font-medium">ACTIVE</span>}
                      {s.has_token && <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 px-1.5 py-0.5 rounded font-medium">CONNECTED</span>}
                    </div>
                    <p className="text-xs text-stone-500 truncate">{s.domain}</p>
                    {s.brand_brief && <p className="text-xs text-stone-400 mt-1 line-clamp-1 italic">{s.brand_brief}</p>}
                  </div>
                  <button onClick={() => openEditStore(s)} className="p-2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 rounded-lg" title="Edit credentials">
                    <Pencil size={14} />
                  </button>
                  {!s.is_active && (
                    <button onClick={() => { setDeleteConfirm(s.id); setDeleteInput(""); }} className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Delete store">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}

              {showForm && (
                <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{editingId ? "Edit store credentials" : "Add a store"}</p>
                    <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_STORE); setTestResult(null); }} className="p-1 text-stone-400 hover:text-stone-700"><XIcon size={16} /></button>
                  </div>
                  <Field label="Store name"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Audrey & Roman" className={inputCls} /></Field>
                  <Field label="myshopify domain"><input type="text" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="my-store.myshopify.com" className={inputCls} /></Field>
                  <Field label="Client ID"><input type="password" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} placeholder="shpca_..." className={inputCls} /></Field>
                  <Field label={`Client secret${editingId ? " (leave blank to keep)" : ""}`}><input type="password" value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} placeholder="shpcs_..." className={inputCls} /></Field>
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <button onClick={handleTestConnection} disabled={testingConnection || !form.domain || !form.client_id || !form.client_secret} className="text-xs px-3 py-1.5 border border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-200 rounded-lg hover:border-stone-500 disabled:opacity-50 transition">
                      {testingConnection ? "Testing..." : "Test connection"}
                    </button>
                    {testResult && (
                      <span className={`text-xs ${testResult.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{testResult.ok ? "✓ " : "✗ "}{testResult.message}</span>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <button onClick={handleSaveStore} disabled={savingStore} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">{savingStore ? "Saving..." : editingId ? "Update" : "Add store"}</button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ─── BRAIN TAB ────────────────────────────────────────── */}
          {tab === "brain" && (
            <section className="space-y-5">
              {!activeStore ? (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
                  <p className="text-sm text-amber-800 dark:text-amber-300">Activate a store first (Stores tab) — Brand Intelligence is stored per store.</p>
                </div>
              ) : (
                <>
                  <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/40 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                      <Sparkles className="text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" size={18} />
                      <div>
                        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Teach the AI your store</h3>
                        <p className="text-xs text-stone-600 dark:text-stone-400 mt-1 leading-relaxed">
                          The more you fill in, the smarter every title, description, translation and SEO field becomes. Each field is fed verbatim into the model on every import. Saved per active store.
                        </p>
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => setBrain(BRAIN_EXAMPLES["luxury-watches"])} className="text-[11px] px-2.5 py-1 bg-white dark:bg-stone-900 border border-indigo-200 dark:border-indigo-700 rounded-full text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 transition">Fill: Luxury Watches</button>
                          <button onClick={() => setBrain(BRAIN_EXAMPLES["wellness-recovery"])} className="text-[11px] px-2.5 py-1 bg-white dark:bg-stone-900 border border-indigo-200 dark:border-indigo-700 rounded-full text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 transition">Fill: Wellness</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 space-y-4">
                    <Field label="Store one-liner (brand brief)" hint="One paragraph: what you sell, who buys it, what makes it special.">
                      <textarea value={brain.brand_brief} onChange={(e) => setBrain({ ...brain, brand_brief: e.target.value })} rows={2} placeholder="e.g. Curated affordable Swiss-style watches for men 25–45 who want craftsmanship without the £5k markup." className={textareaCls} />
                    </Field>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Niche / categories" hint="Comma-separated.">
                        <input type="text" value={brain.niche} onChange={(e) => setBrain({ ...brain, niche: e.target.value })} placeholder="men's watches, accessible luxury" className={inputCls} />
                      </Field>
                      <Field label="Target audience" hint="Age, lifestyle, motivations.">
                        <input type="text" value={brain.target_audience} onChange={(e) => setBrain({ ...brain, target_audience: e.target.value })} placeholder="Men 25–45, first 'real' watch buyer" className={inputCls} />
                      </Field>
                    </div>

                    <Field label="Brand voice" hint="How the copy should sound. Concrete is better than abstract.">
                      <textarea value={brain.brand_voice} onChange={(e) => setBrain({ ...brain, brand_voice: e.target.value })} rows={2} placeholder="Confident, succinct, premium. No hype words. Speak specs like a watchmaker." className={textareaCls} />
                    </Field>

                    <Field label="Value propositions / differentiators" hint="Bullet-style points the AI can weave into descriptions.">
                      <textarea value={brain.value_props} onChange={(e) => setBrain({ ...brain, value_props: e.target.value })} rows={3} placeholder="Sapphire crystal, automatic movement, 5ATM, 2-year warranty, free shipping over £29, 30-day returns" className={textareaCls} />
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Default language for new copy">
                        <select value={brain.default_language} onChange={(e) => setBrain({ ...brain, default_language: e.target.value })} className={inputCls}>
                          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Currency symbol">
                        <select value={brain.currency} onChange={(e) => setBrain({ ...brain, currency: e.target.value })} className={inputCls}>
                          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </Field>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-stone-100 dark:border-stone-800">
                      <p className="text-xs text-stone-400">{brainFilled} of 7 fields filled — fuller = sharper AI output</p>
                      <button onClick={handleSaveBrain} disabled={savingBrain} className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2">
                        {savingBrain && <Loader2 size={14} className="animate-spin" />}
                        {savingBrain ? "Saving..." : "Save brand profile"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {/* ─── KEYS TAB ─────────────────────────────────────────── */}
          {tab === "keys" && (
            <section>
              <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">kie.ai API Key</p>
                    <p className="text-xs text-stone-500 mt-0.5">Powers AI image generation + image translation</p>
                  </div>
                  {kieInfo?.set && !kieValue && <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 px-2 py-0.5 rounded-full font-medium">SET</span>}
                  {!kieInfo?.set && !kieValue && <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full font-medium">NOT SET</span>}
                </div>
                {kieInfo?.set && !kieValue && <p className="text-xs text-stone-400 font-mono mb-3">{kieInfo.masked}</p>}
                <div className="flex gap-2">
                  <input type="password" value={kieValue} onChange={(e) => setKieValue(e.target.value)} placeholder={kieInfo?.set ? "Enter new value to replace" : "Enter API key"} className={inputCls} />
                  <button onClick={handleSaveKieKey} disabled={savingKey || !kieValue.trim()} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">{savingKey ? "Saving..." : "Save"}</button>
                </div>
                <p className="text-xs text-stone-400 mt-3"><strong>ANTHROPIC_KEY</strong> and <strong>APP_PASSWORD</strong> live in Vercel env vars.</p>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Delete confirm */}
      {deleteConfirm && (() => {
        const s = stores.find((x) => x.id === deleteConfirm);
        if (!s) return null;
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-stone-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-stone-200 dark:border-stone-800">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-2">Delete store</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400 mb-4">Type <strong>{s.name}</strong> to confirm.</p>
              <input type="text" value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} placeholder={s.name} className={inputCls + " mb-4"} />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setDeleteConfirm(null); setDeleteInput(""); }} className="px-4 py-2 text-sm text-stone-600 dark:text-stone-400 hover:text-stone-800">Cancel</button>
                <button onClick={handleDelete} disabled={deleteInput !== s.name} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">Delete</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Small atoms
// ──────────────────────────────────────────────────────────────────────

const inputCls = "w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition";
const textareaCls = inputCls + " resize-y leading-relaxed";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-stone-400 mt-1">{hint}</p>}
    </div>
  );
}
