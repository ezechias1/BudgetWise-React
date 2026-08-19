import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';

/**
 * Makes an overlay behave like a real dialog for someone using a keyboard or
 * a screen reader.
 *
 * Every modal in this app rendered as a plain `<div class="modal-overlay">`.
 * Three things followed from that: a screen reader announced it as a group of
 * controls rather than a dialog, focus stayed on <body> so the caret was still
 * somewhere up the page, and Tab walked straight out into the content behind —
 * on the Expenses page that's 35 controls the modal is covering. You end up
 * typing into something you can't see.
 *
 * Spread the result onto the overlay element and add the ARIA attributes:
 *
 *   const dialog = useDialogA11y();
 *   <div className="modal-overlay" {...dialog}
 *        role="dialog" aria-modal="true" aria-labelledby="my-title">
 *     <div className="modal">
 *       <h2 id="my-title">Add Expense</h2>
 *
 * Purely behavioural — it sets no styles and changes nothing visually.
 *
 * @param open Pass the visibility flag for a modal that stays mounted while
 *   closed. Modals that are conditionally rendered can leave it out, since
 *   being mounted already means being open.
 */
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(
  open: boolean = true,
) {
  const ref = useRef<T>(null);

  // Move the caret into the dialog rather than leaving it wherever it was, so
  // a keyboard user doesn't have to tab through the page underneath to reach
  // the form that's covering it.
  useEffect(() => {
    if (!open) return;
    // After paint: the content is frequently rendered in the same commit.
    const id = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root || root.contains(document.activeElement)) return;
      focusablesIn(root)[0]?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const onKeyDown = useCallback((e: KeyboardEvent<T>) => {
    if (e.key !== 'Tab') return;
    const root = ref.current;
    if (!root) return;
    const items = focusablesIn(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    // Wrap at both ends, and pull focus back in if it has already escaped.
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return { ref, onKeyDown };
}

/** Focusable elements in DOM order, skipping anything not actually rendered. */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}
