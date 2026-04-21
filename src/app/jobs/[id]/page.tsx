"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import Header from "@/components/Header";

interface ProductStatus {
  handle: string;
  status: "pending" | "processing" | "done" | "failed";
  title?: string;
  error?: string;
  imageCount: number;
  aiGenerated: boolean;
}

interface JobStatus {
  id: string;
  status: "pending" | "processing" | "done" | "failed";
  total_products: number;
  completed_products: number;
  failed_products: number;
  products: ProductStatus[];
  created_at: string;
  updated_at: string;
}

const STATUS_ICONS: Record<string, string> = {
  done: "\u2705",
  processing: "\u23F3",
  pending: "\u23F8\uFE0F",
  failed: "\u274C",
};

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const [resuming, setResuming] = useState(false);

  // Timing
  const startTimeRef = useRef<number>(Date.now());
  const [completedHistory, setCompletedHistory] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);

  // Tick elapsed every second
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${id}/status`);
      if (!res.ok) { setError("Job not found"); return null; }
      const data = (await res.json()) as JobStatus;
      setJob(data);

      // Track completion rate for ETA
      setCompletedHistory((prev) => {
        const total = data.completed_products + data.failed_products;
        if (prev.length === 0 || prev[prev.length - 1] !== total) {
          return [...prev.slice(-20), total];
        }
        return prev;
      });
      return data;
    } catch { setError("Failed to load job status"); return null; }
  }, [id]);

  const triggerProcess = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      await fetch(`/api/jobs/${id}/process`, { method: "POST" });
    } catch { /* retry on next poll */ }
    finally { processingRef.current = false; }
  }, [id]);

  useEffect(() => {
    let mounted = true;
    startTimeRef.current = Date.now();

    async function init() {
      const status = await fetchStatus();
      if (!status || !mounted) return;
      if (status.status === "pending" || status.status === "processing") {
        triggerProcess();
      }
    }
    init();

    pollRef.current = setInterval(async () => {
      if (!mounted) return;
      const status = await fetchStatus();
      if (!status) return;
      if (status.status === "pending" || status.status === "processing") {
        triggerProcess();
      } else {
        clearInterval(pollRef.current);
      }
    }, 2000);

    return () => { mounted = false; clearInterval(pollRef.current); };
  }, [fetchStatus, triggerProcess]);

  async function handleResume() {
    setResuming(true);
    try {
      const res = await fetch(`/api/jobs/${id}/resume`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Resume failed"); return; }
      toast.success(`Job resumed — ${data.pending} product(s) re-queued`);
      startTimeRef.current = Date.now();
      setCompletedHistory([]);
      await fetchStatus();
      // Restart polling
      triggerProcess();
      pollRef.current = setInterval(async () => {
        const status = await fetchStatus();
        if (status && (status.status === "pending" || status.status === "processing")) {
          triggerProcess();
        } else {
          clearInterval(pollRef.current);
        }
      }, 2000);
    } catch { toast.error("Network error"); }
    finally { setResuming(false); }
  }

  // ---------- Render helpers ----------

  if (error) {
    return (
      <><Header /><main className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <div className="max-w-2xl mx-auto p-6 md:p-10 text-center">
          <p className="text-red-600">{error}</p>
          <Link href="/scan" className="text-sm text-indigo-600 mt-4 inline-block">Back to scan</Link>
        </div>
      </main></>
    );
  }

  if (!job) {
    return (
      <><Header /><main className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <div className="max-w-2xl mx-auto p-6 md:p-10 text-center">
          <div className="w-8 h-8 border-4 border-stone-200 border-t-indigo-600 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-stone-500 mt-4">Loading job...</p>
        </div>
      </main></>
    );
  }

  const finished = job.completed_products + job.failed_products;
  const progress = job.total_products > 0 ? (finished / job.total_products) * 100 : 0;
  const isFinished = job.status === "done" || job.status === "failed";
  const processing = job.products.filter((p) => p.status === "processing").length;
  const pending = job.products.filter((p) => p.status === "pending").length;

  // ETA calculation
  let eta = "";
  if (!isFinished && finished > 0) {
    const elapsedSec = elapsed / 1000;
    const rate = finished / elapsedSec; // products per second
    const remaining = job.total_products - finished;
    if (rate > 0) {
      const etaSec = Math.ceil(remaining / rate);
      if (etaSec < 60) eta = `~${etaSec}s remaining`;
      else eta = `~${Math.ceil(etaSec / 60)}m ${etaSec % 60}s remaining`;
    }
  }

  const throughput = !isFinished && elapsed > 10000 && finished > 0
    ? `${(finished / (elapsed / 60000)).toFixed(1)} products/min`
    : "";

  function formatElapsed(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-stone-50 dark:bg-stone-950">
        <div className="max-w-2xl mx-auto p-6 md:p-10">
          <Link href="/scan" className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 mb-4 inline-block">
            &larr; Back to scan
          </Link>

          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100 mb-1">Import Job</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
            {isFinished
              ? `Finished in ${formatElapsed(elapsed)}: ${job.completed_products} done, ${job.failed_products} failed`
              : `Processing... ${formatElapsed(elapsed)} elapsed`}
          </p>

          {/* Progress bar */}
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                {finished}/{job.total_products} complete
              </span>
              <span className="text-xs text-stone-400">{Math.round(progress)}%</span>
            </div>
            <div className="h-2.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isFinished && job.failed_products > 0 ? "bg-amber-500"
                    : isFinished ? "bg-green-500" : "bg-indigo-600"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Stats row */}
            {!isFinished && (
              <div className="flex items-center gap-4 mt-3 text-xs text-stone-500 dark:text-stone-400 flex-wrap">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 border-2 border-stone-300 border-t-indigo-600 rounded-full animate-spin" />
                  <span>{processing} generating, {pending} pending, {job.completed_products} done, {job.failed_products} failed</span>
                </div>
                {throughput && <span className="text-stone-400">|</span>}
                {throughput && <span>{throughput}</span>}
                {eta && <span className="text-stone-400">|</span>}
                {eta && <span>{eta}</span>}
              </div>
            )}
          </div>

          {/* Product list */}
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl divide-y divide-stone-100 dark:divide-stone-800 overflow-hidden mb-6">
            {job.products.map((p) => (
              <div key={p.handle} className="flex items-center gap-3 px-4 py-3">
                <span className="text-base flex-shrink-0">{STATUS_ICONS[p.status] ?? ""}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-800 dark:text-stone-200 truncate">{p.title || p.handle}</p>
                  {p.status === "done" && (
                    <p className="text-xs text-stone-400">
                      {p.imageCount} image{p.imageCount !== 1 ? "s" : ""}{p.aiGenerated ? " (AI)" : ""}
                    </p>
                  )}
                  {p.error && <p className="text-xs text-red-500 dark:text-red-400 truncate">{p.error}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
                  p.status === "done" ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    : p.status === "failed" ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                    : p.status === "processing" ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400"
                    : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
                }`}>{p.status}</span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          {isFinished && (
            <div className="flex flex-wrap justify-center gap-3">
              {job.failed_products > 0 && (
                <button
                  onClick={handleResume}
                  disabled={resuming}
                  className="text-sm bg-amber-600 text-white px-5 py-2.5 rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium"
                >
                  {resuming ? "Resuming..." : `Retry ${job.failed_products} Failed`}
                </button>
              )}
              <Link href="/scan" className="text-sm border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 px-5 py-2.5 rounded-lg hover:border-stone-500">
                Import more
              </Link>
              {job.completed_products > 0 && (
                <button
                  onClick={() => {
                    sessionStorage.setItem("reviewJobId", job.id);
                    router.push(`/scan/preview?jobId=${job.id}`);
                  }}
                  className="text-sm bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700"
                >
                  Review &amp; Push to Shopify
                </button>
              )}
              <Link href="/library" className="text-sm border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 px-5 py-2.5 rounded-lg hover:border-stone-500">
                Go to Library
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
