import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useMode } from '@/contexts/ModeContext';

/**
 * BudgetSmart — the floating help assistant, bottom-right on every dashboard
 * page.
 *
 * Colour comes from `var(--accent)`, which ModeContext already flips on
 * <body> per mode, so the widget matches whichever account you're in
 * (Personal green / Business blue / Family purple) with no logic of its own.
 *
 * The Anthropic key is not here — the browser calls the `budgetsmart` edge
 * function, which holds the key and refuses anonymous callers.
 */

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const GREETING =
  "Hi, I'm BudgetSmart. Ask me anything about using BudgetWise — adding expenses, invoices, family invites, Junior, whatever's got you stuck.";

export function BudgetSmartWidget() {
  const { mode } = useMode();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Lets an in-flight answer be abandoned when the panel closes, so a slow
  // reply can't stream into a conversation the user has already left.
  const abortRef = useRef<AbortController | null>(null);

  // Close on Escape, from anywhere in the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Abandon any in-flight request when the panel closes or unmounts.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest message in view as it streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || sending) return;

      const outgoing: ChatMessage[] = [
        ...messages,
        { role: 'user', content: trimmed },
      ];
      setMessages(outgoing);
      setDraft('');
      setError(null);
      setSending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setError('Your session expired — please sign in again.');
          setSending(false);
          return;
        }

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/budgetsmart`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ messages: outgoing, mode }),
            signal: controller.signal,
          },
        );

        if (!res.ok || !res.body) {
          // The function returns JSON on every failure path; fall back to a
          // plain message if it managed to fail without one.
          const detail = await res.json().catch(() => null);
          setError(
            detail?.error ??
              "BudgetSmart couldn't answer just now. Please try again.",
          );
          setSending(false);
          return;
        }

        // Open an empty assistant bubble and fill it as chunks arrive.
        setMessages((list) => [...list, { role: 'assistant', content: '' }]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          setMessages((list) => {
            const next = [...list];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                content: last.content + chunk,
              };
            }
            return next;
          });
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return; // panel closed
        setError("BudgetSmart couldn't answer just now. Please try again.");
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [messages, mode, sending],
  );

  return (
    <>
      <button
        type="button"
        className="bsmart-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close BudgetSmart' : 'Ask BudgetSmart'}
        aria-expanded={open}
        aria-controls="budgetsmart-panel"
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="bsmart-panel"
          id="budgetsmart-panel"
          ref={panelRef}
          role="dialog"
          aria-label="BudgetSmart help assistant"
        >
          <header className="bsmart-header">
            <span className="bsmart-dot" aria-hidden="true" />
            <div>
              <strong>BudgetSmart</strong>
              <span className="bsmart-sub">Here to help, no email needed</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close BudgetSmart"
              className="bsmart-close"
            >
              &times;
            </button>
          </header>

          <div className="bsmart-scroll" ref={scrollRef}>
            <div className="bsmart-msg is-assistant">{GREETING}</div>

            {messages.map((m, i) => (
              <div
                key={i}
                className={`bsmart-msg ${m.role === 'user' ? 'is-user' : 'is-assistant'}`}
              >
                {m.content ||
                  (sending && i === messages.length - 1 ? (
                    <span className="bsmart-typing" aria-label="BudgetSmart is typing">
                      <i /><i /><i />
                    </span>
                  ) : null)}
              </div>
            ))}

            {error && (
              <div className="bsmart-msg is-error" role="alert">
                {error}
              </div>
            )}
          </div>

          <form
            className="bsmart-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask a question…"
              aria-label="Ask BudgetSmart a question"
              maxLength={4000}
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
