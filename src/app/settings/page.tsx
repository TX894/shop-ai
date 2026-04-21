"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Header from "@/components/Header";

interface KeyInfo {
  set: boolean;
  masked: string;
}

interface TestResult {
  testing: boolean;
  ok?: boolean;
  message?: string;
}

const KEY_CONFIG: { key: string; label: string; service: string; isPlain?: boolean }[] = [
  { key: "KIE_AI_API_KEY", label: "kie.ai API Key", service: "kie.ai (AI Images)" },
  { key: "ANTHROPIC_KEY", label: "Anthropic API Key", service: "Anthropic (Translation/Enhancement)" },
  { key: "SHOPIFY_STORE_DOMAIN", label: "Shopify Store Domain", service: "Shopify", isPlain: true },
  { key: "SHOPIFY_CLIENT_ID", label: "Shopify Client ID", service: "Shopify" },
  { key: "SHOPIFY_CLIENT_SECRET", label: "Shopify Client Secret", service: "Shopify" },
  { key: "APP_PASSWORD", label: "App Password", service: "Authentication" },
];

export default function SettingsPage() {
  const [keys, setKeys] = useState<Record<string, KeyInfo>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((data: { keys: Record<string, KeyInfo> }) => setKeys(data.keys))
      .catch(() => {});
  }, []);

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    const toSend: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) toSend[k] = v.trim();
    }
    try {
      const res = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSend),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save settings");
        return;
      }
      if (data.keys) setKeys(data.keys);
      setValues({});
      setSaved(true);
      toast.success("Settings saved");
    } catch {
      toast.error("Network error — could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function testShopify() {
    setTests((prev) => ({ ...prev, shopify: { testing: true } }));
    try {
      const res = await fetch("/api/shopify/test-auth");
      const data = await res.json();
      setTests((prev) => ({
        ...prev,
        shopify: { testing: false, ok: data.ok, message: data.ok ? `Connected: ${data.shopName}` : data.error },
      }));
    } catch {
      setTests((prev) => ({ ...prev, shopify: { testing: false, ok: false, message: "Network error" } }));
    }
  }

  async function testAnthropic() {
    setTests((prev) => ({ ...prev, anthropic: { testing: true } }));
    try {
      const res = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "test", targetLang: "pt" }),
      });
      const data = await res.json();
      setTests((prev) => ({
        ...prev,
        anthropic: { testing: false, ok: !!data.translated, message: data.translated ? "Working" : data.error },
      }));
    } catch {
      setTests((prev) => ({ ...prev, anthropic: { testing: false, ok: false, message: "Network error" } }));
    }
  }

  return (
    <>
    <Header />
    <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <div className="max-w-2xl mx-auto p-6 md:p-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Settings</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">Manage API keys and connections.</p>
        </div>

        <div className="space-y-6">
          {KEY_CONFIG.map(({ key, label, service, isPlain }) => {
            const info = keys[key];
            const editValue = values[key] ?? "";
            const isVisible = showValues[key];

            return (
              <div key={key} className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-stone-800">{label}</p>
                    <p className="text-xs text-stone-400">{service}</p>
                  </div>
                  {info?.set && !editValue && (
                    <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">Set</span>
                  )}
                  {!info?.set && !editValue && (
                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded">Not set</span>
                  )}
                </div>

                {/* Current masked value */}
                {info?.set && !editValue && (
                  <p className="text-xs text-stone-400 font-mono mb-2">{info.masked}</p>
                )}

                {/* Input field */}
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={isPlain || isVisible ? "text" : "password"}
                      value={editValue}
                      onChange={(e) => setValue(key, e.target.value)}
                      placeholder={info?.set ? "Enter new value to update" : "Enter value"}
                      className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 pr-10"
                    />
                    {!isPlain && (
                      <button
                        onClick={() => setShowValues((prev) => ({ ...prev, [key]: !prev[key] }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 text-xs"
                      >
                        {isVisible ? "Hide" : "Show"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Test connections */}
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-4">
            <p className="text-sm font-medium text-stone-900 dark:text-stone-100 mb-3">Test connections</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={testShopify}
                disabled={tests.shopify?.testing}
                className="text-xs px-3 py-1.5 border border-stone-300 rounded text-stone-600 hover:border-stone-500 disabled:opacity-50"
              >
                {tests.shopify?.testing ? "Testing..." : "Test Shopify"}
              </button>
              <button
                onClick={testAnthropic}
                disabled={tests.anthropic?.testing}
                className="text-xs px-3 py-1.5 border border-stone-300 rounded text-stone-600 hover:border-stone-500 disabled:opacity-50"
              >
                {tests.anthropic?.testing ? "Testing..." : "Test Anthropic"}
              </button>
            </div>
            {Object.entries(tests).map(([svc, t]) => (
              t.message && (
                <div key={svc} className={`mt-2 text-xs px-3 py-2 rounded ${t.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
                  {svc}: {t.message}
                </div>
              )
            ))}
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || Object.values(values).every((v) => !v.trim())}
              className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {saved && <span className="text-sm text-green-600">Settings saved. Changes apply immediately, no restart needed.</span>}
          </div>
        </div>
      </div>
    </main>
    </>
  );
}
