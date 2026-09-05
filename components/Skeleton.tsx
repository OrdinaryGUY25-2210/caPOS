// Reusable skeleton-loader primitives used across dashboard pages to replace
// spinner-based "Memuat..." loading states with content-shaped placeholders.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200 ${className}`} />;
}

export function SkeletonStatCard() {
  return (
    <div className="card p-5 space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-20" />
    </div>
  );
}

export function SkeletonStatGrid({ count = 3, gridClassName = "grid-cols-1 sm:grid-cols-3" }: { count?: number; gridClassName?: string }) {
  return (
    <div className={`grid ${gridClassName} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonRow({ withAvatar = true }: { withAvatar?: boolean }) {
  return (
    <div className="flex items-center justify-between p-4 gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {withAvatar && <Skeleton className="w-10 h-10 rounded-xl shrink-0" />}
        <div className="space-y-2 flex-1 min-w-0">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-5 w-16 rounded-full shrink-0" />
    </div>
  );
}

export function SkeletonList({ rows = 5, withAvatar = true, className = "" }: { rows?: number; withAvatar?: boolean; className?: string }) {
  return (
    <div className={`card divide-y divide-neutral-100 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} withAvatar={withAvatar} />
      ))}
    </div>
  );
}

export function SkeletonCardGrid({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-3 space-y-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTableRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="p-3">
              <Skeleton className="h-4 w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonBlock({ className = "h-64 w-full" }: { className?: string }) {
  return <Skeleton className={className} />;
}
