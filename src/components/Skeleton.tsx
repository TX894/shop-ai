"use client";

export function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden animate-pulse">
      <div className="aspect-square bg-stone-200 dark:bg-stone-800" />
      <div className="p-3 space-y-2">
        <div className="h-3 bg-stone-200 dark:bg-stone-800 rounded w-3/4" />
        <div className="h-2.5 bg-stone-200 dark:bg-stone-800 rounded w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonLine({ width = "w-full" }: { width?: string }) {
  return (
    <div className={`h-4 bg-stone-200 dark:bg-stone-800 rounded animate-pulse ${width}`} />
  );
}

export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
