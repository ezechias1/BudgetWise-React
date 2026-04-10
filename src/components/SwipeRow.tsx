import { useRef, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftLabel?: string;
  rightLabel?: string;
}

const THRESHOLD = 60;

/**
 * Wraps a table row's content with swipe-to-action on mobile.
 * Swipe right → Edit (blue), Swipe left → Delete (red).
 * Uses the existing .swipe-row / .swipe-action CSS from dashboard.css.
 */
export function SwipeRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftLabel = 'Edit',
  rightLabel = 'Delete',
}: Props) {
  const startX = useRef(0);
  const currentX = useRef(0);
  const innerRef = useRef<HTMLDivElement>(null);
  const swiping = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    currentX.current = startX.current;
    swiping.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping.current || !innerRef.current) return;
    currentX.current = e.touches[0].clientX;
    const diff = currentX.current - startX.current;
    // Clamp between -100 and 100
    const clamped = Math.max(-100, Math.min(100, diff));
    innerRef.current.style.transform = `translateX(${clamped}px)`;
    innerRef.current.style.transition = 'none';
  };

  const handleTouchEnd = () => {
    if (!swiping.current || !innerRef.current) return;
    swiping.current = false;
    const diff = currentX.current - startX.current;

    innerRef.current.style.transition = 'transform 0.3s ease';
    innerRef.current.style.transform = 'translateX(0)';

    if (diff < -THRESHOLD && onSwipeLeft) {
      onSwipeLeft();
    } else if (diff > THRESHOLD && onSwipeRight) {
      onSwipeRight();
    }
  };

  return (
    <div className="swipe-row">
      {onSwipeRight && (
        <div className="swipe-action swipe-action-edit">{leftLabel}</div>
      )}
      {onSwipeLeft && (
        <div className="swipe-action swipe-action-delete">{rightLabel}</div>
      )}
      <div
        ref={innerRef}
        className="swipe-row-inner"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
