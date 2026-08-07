import type { CSSProperties } from 'react';

interface Props {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
}

/**
 * Shimmer loading placeholder. Renders a pulsing block that
 * matches the app's dark/light theme via CSS variables.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}: Props) {
  return (
    <div
      className="skeleton-pulse"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

/** Multiple skeleton lines for text blocks. */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === count - 1 ? '60%' : '100%'}
          height={14}
        />
      ))}
    </div>
  );
}

/** Skeleton for a stat card on the Overview page. */
export function StatCardSkeleton() {
  return (
    <div className="stat-card" style={{ opacity: 0.6 }}>
      <div className="stat-icon skeleton-bg">
        <Skeleton width={22} height={22} borderRadius="50%" />
      </div>
      <div className="stat-info" style={{ gap: 6 }}>
        <Skeleton width={80} height={12} />
        <Skeleton width={120} height={20} />
      </div>
    </div>
  );
}

/** Skeleton for the Overview stats grid (4 cards). */
export function OverviewSkeleton() {
  return (
    <div style={{ padding: '16px 0' }}>
      <Skeleton width={200} height={24} style={{ marginBottom: 8 }} />
      <Skeleton width={250} height={14} style={{ marginBottom: 24 }} />
      <div className="stats-grid">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
        <Skeleton height={200} borderRadius={16} />
        <Skeleton height={200} borderRadius={16} />
      </div>
      <Skeleton height={160} borderRadius={16} style={{ marginTop: 16 }} />
    </div>
  );
}

/** Skeleton for expense table rows. */
export function ExpenseTableSkeleton() {
  return (
    <div style={{ padding: 16 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="skeleton-row" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0' }}>
          <Skeleton width={70} height={14} />
          <Skeleton width={80} height={24} borderRadius={6} />
          <Skeleton width="40%" height={14} />
          <Skeleton width={60} height={14} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}
