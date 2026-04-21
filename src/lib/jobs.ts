/**
 * Import jobs — async queue for batch product processing.
 * Vercel Postgres in production, JSON file locally.
 *
 * Each job holds a queue of products to process. The /process endpoint
 * picks up pending items one at a time within a 55s budget.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ---------- Types ----------

export interface JobProduct {
  handle: string;
  sourceStore: string;
  status: "pending" | "processing" | "done" | "failed";
  error?: string;
  retry_count?: number;
  claimed_at?: string; // ISO timestamp when status changed to 'processing'
  // Result data (filled after processing)
  title?: string;
  description?: string;
  price?: string;
  vendor?: string;
  productType?: string;
  libraryItemIds?: string[];
  images?: {
    role: string;
    originalUrl: string;
    resultBase64?: string;
    resultMime?: string;
    aiGenerated: boolean;
    error?: string;
  }[];
}

export interface ImportJob {
  id: string;
  store_id: string | null;
  status: "pending" | "processing" | "done" | "failed";
  total_products: number;
  completed_products: number;
  failed_products: number;
  product_queue: JobProduct[];
  results: JobProduct[];
  options: string; // JSON-encoded ImportOptions
  created_at: string;
  updated_at: string;
}

export interface CreateJobInput {
  store_id?: string;
  products: { handle: string; sourceStore: string }[];
  options: string; // JSON-encoded ImportOptions
}

// ---------- Backend detection ----------

function usePostgres(): boolean {
  return !!process.env.POSTGRES_URL;
}

// ---------- Postgres schema ----------

const CREATE_JOBS_TABLE_PG = `
  CREATE TABLE IF NOT EXISTS import_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id            UUID,
    status              TEXT NOT NULL DEFAULT 'pending',
    total_products      INT NOT NULL,
    completed_products  INT DEFAULT 0,
    failed_products     INT DEFAULT 0,
    product_queue       JSONB NOT NULL,
    results             JSONB DEFAULT '[]',
    options             TEXT NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
  )
`;

let _pgJobsMigrated = false;

async function ensurePgJobsSchema(): Promise<void> {
  if (_pgJobsMigrated) return;
  const { sql } = await import("@vercel/postgres");
  await sql.query(CREATE_JOBS_TABLE_PG);
  _pgJobsMigrated = true;
}

// ---------- Filesystem backend ----------

const JOBS_PATH = path.join(process.cwd(), "data", "jobs.json");

function fileReadJobs(): ImportJob[] {
  try {
    if (fs.existsSync(JOBS_PATH)) {
      return JSON.parse(fs.readFileSync(JOBS_PATH, "utf-8")) as ImportJob[];
    }
  } catch { /* ignore */ }
  return [];
}

function fileWriteJobs(jobs: ImportJob[]): void {
  const dir = path.dirname(JOBS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

// ---------- Row mapping ----------

function rowToJob(row: Record<string, unknown>): ImportJob {
  return {
    id: String(row.id),
    store_id: row.store_id ? String(row.store_id) : null,
    status: String(row.status) as ImportJob["status"],
    total_products: Number(row.total_products),
    completed_products: Number(row.completed_products),
    failed_products: Number(row.failed_products),
    product_queue: typeof row.product_queue === "string"
      ? JSON.parse(row.product_queue)
      : (row.product_queue as JobProduct[]),
    results: typeof row.results === "string"
      ? JSON.parse(row.results)
      : (row.results as JobProduct[]),
    options: String(row.options),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

// ---------- Public API ----------

export async function createJob(input: CreateJobInput): Promise<ImportJob> {
  const queue: JobProduct[] = input.products.map((p) => ({
    handle: p.handle,
    sourceStore: p.sourceStore,
    status: "pending",
  }));

  if (usePostgres()) {
    await ensurePgJobsSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query(
      `INSERT INTO import_jobs (store_id, total_products, product_queue, options)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        input.store_id ?? null,
        input.products.length,
        JSON.stringify(queue),
        input.options,
      ]
    );
    return rowToJob(result.rows[0]);
  }

  const jobs = fileReadJobs();
  const now = new Date().toISOString();
  const job: ImportJob = {
    id: crypto.randomUUID(),
    store_id: input.store_id ?? null,
    status: "pending",
    total_products: input.products.length,
    completed_products: 0,
    failed_products: 0,
    product_queue: queue,
    results: [],
    options: input.options,
    created_at: now,
    updated_at: now,
  };
  jobs.push(job);
  fileWriteJobs(jobs);
  return job;
}

export async function getJob(id: string): Promise<ImportJob | null> {
  if (usePostgres()) {
    await ensurePgJobsSchema();
    const { sql } = await import("@vercel/postgres");
    const result = await sql.query("SELECT * FROM import_jobs WHERE id = $1", [id]);
    return result.rows[0] ? rowToJob(result.rows[0]) : null;
  }

  const jobs = fileReadJobs();
  const job = jobs.find((j) => j.id === id);
  return job ?? null;
}

/** Get the next pending product from the queue, mark it as processing */
export async function claimNextProduct(jobId: string): Promise<{
  job: ImportJob;
  productIndex: number;
} | null> {
  const job = await getJob(jobId);
  if (!job || job.status === "done" || job.status === "failed") return null;

  const idx = job.product_queue.findIndex((p) => p.status === "pending");
  if (idx === -1) return null;

  job.product_queue[idx].status = "processing";
  job.product_queue[idx].claimed_at = new Date().toISOString();
  job.status = "processing";

  if (usePostgres()) {
    const { sql } = await import("@vercel/postgres");
    await sql.query(
      `UPDATE import_jobs SET product_queue = $1, status = 'processing', updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(job.product_queue), jobId]
    );
  } else {
    const jobs = fileReadJobs();
    const jIdx = jobs.findIndex((j) => j.id === jobId);
    if (jIdx !== -1) {
      jobs[jIdx] = { ...job, updated_at: new Date().toISOString() };
      fileWriteJobs(jobs);
    }
  }

  return { job, productIndex: idx };
}

/** Mark a product as done with its result data */
export async function markProductDone(
  jobId: string,
  productIndex: number,
  result: Partial<JobProduct>
): Promise<ImportJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found");

  job.product_queue[productIndex] = {
    ...job.product_queue[productIndex],
    ...result,
    status: "done",
  };
  job.completed_products += 1;
  job.results.push(job.product_queue[productIndex]);

  // Check if job is complete
  const hasPending = job.product_queue.some(
    (p) => p.status === "pending" || p.status === "processing"
  );
  if (!hasPending) {
    job.status = job.failed_products > 0 && job.completed_products === 0 ? "failed" : "done";
  }

  return saveJob(job);
}

/** Mark a product as failed */
export async function markProductFailed(
  jobId: string,
  productIndex: number,
  error: string
): Promise<ImportJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found");

  job.product_queue[productIndex] = {
    ...job.product_queue[productIndex],
    status: "failed",
    error,
  };
  job.failed_products += 1;
  job.results.push(job.product_queue[productIndex]);

  const hasPending = job.product_queue.some(
    (p) => p.status === "pending" || p.status === "processing"
  );
  if (!hasPending) {
    job.status = job.completed_products === 0 ? "failed" : "done";
  }

  return saveJob(job);
}

const MAX_RETRIES = 3;
const ZOMBIE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Recover zombie products: reset 'processing' products that have been
 * stuck for more than ZOMBIE_THRESHOLD_MS back to 'pending'.
 * If retry_count exceeds MAX_RETRIES, mark as failed.
 */
export async function recoverZombieProducts(jobId: string): Promise<number> {
  const job = await getJob(jobId);
  if (!job || job.status === "done" || job.status === "failed") return 0;

  const now = Date.now();
  let recovered = 0;

  for (const product of job.product_queue) {
    if (product.status !== "processing") continue;

    const claimedAt = product.claimed_at ? new Date(product.claimed_at).getTime() : 0;
    if (now - claimedAt < ZOMBIE_THRESHOLD_MS) continue;

    const retries = (product.retry_count ?? 0) + 1;
    if (retries > MAX_RETRIES) {
      product.status = "failed";
      product.error = `Stuck in generating state, abandoned after ${MAX_RETRIES} retries`;
      job.failed_products += 1;
      job.results.push(product);
    } else {
      product.status = "pending";
      product.retry_count = retries;
      product.claimed_at = undefined;
    }
    recovered++;
  }

  if (recovered > 0) {
    // Recheck if job is complete after recovery
    const hasPending = job.product_queue.some(
      (p) => p.status === "pending" || p.status === "processing"
    );
    if (!hasPending) {
      job.status = job.completed_products === 0 ? "failed" : "done";
    }
    await saveJob(job);
  }

  return recovered;
}

/** Resume a job: reset all 'processing' and 'failed' products to 'pending' */
export async function resumeJob(jobId: string): Promise<ImportJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found");

  // Reset failed and stuck processing products
  for (const product of job.product_queue) {
    if (product.status === "processing" || product.status === "failed") {
      product.status = "pending";
      product.retry_count = 0;
      product.claimed_at = undefined;
      product.error = undefined;
    }
  }

  // Recalculate counters from results that are actually done
  job.results = job.results.filter((r) => r.status === "done");
  job.completed_products = job.results.length;
  job.failed_products = 0;
  job.status = job.completed_products === job.total_products ? "done" : "pending";

  return saveJob(job);
}

async function saveJob(job: ImportJob): Promise<ImportJob> {
  if (usePostgres()) {
    const { sql } = await import("@vercel/postgres");
    await sql.query(
      `UPDATE import_jobs SET
        status = $1, completed_products = $2, failed_products = $3,
        product_queue = $4, results = $5, updated_at = NOW()
       WHERE id = $6`,
      [
        job.status,
        job.completed_products,
        job.failed_products,
        JSON.stringify(job.product_queue),
        JSON.stringify(job.results),
        job.id,
      ]
    );
  } else {
    const jobs = fileReadJobs();
    const idx = jobs.findIndex((j) => j.id === job.id);
    if (idx !== -1) {
      jobs[idx] = { ...job, updated_at: new Date().toISOString() };
      fileWriteJobs(jobs);
    }
  }
  return job;
}
