import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.71.0";

// BudgetSmart — the in-app help assistant behind the floating widget.
//
// The Anthropic key lives here and never reaches the browser. The function
// also refuses anonymous callers, so the key can't be spent by anyone who
// happens to find the URL.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const ALLOWED_ORIGINS = new Set([
  "https://budget-wise-react.vercel.app",
  "https://budget-wise-ruby.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
]);

/** Keeps one exchange from turning into an essay, and caps abuse. */
const MAX_TURNS = 20;
const MAX_CHARS_PER_MESSAGE = 4000;

function corsHeadersFor(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

function json(origin: string | null, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
  });
}

/** What BudgetSmart is allowed to claim. Kept close to what the app can
 *  actually do — an assistant that invents a feature costs more support time
 *  than it saves. */
const SYSTEM_PROMPT = `You are BudgetSmart, the in-app help assistant for BudgetWise, a South African budgeting app.

You answer questions about how to use the app so people don't have to email support and wait.

# The app

BudgetWise has three account modes; users switch between them from the dropdown at the top of the sidebar.

**Personal** — day-to-day money. Expenses (add, edit, delete, move to another mode, CSV import, receipt scan), savings goals with contributions, monthly budget limits per category, custom categories, trips with business/personal tagging, load shedding cost tracking, stokvel contributions, multi-currency with live exchange rates, and a spending advice page.

**Business** — Transactions, Invoices (create, mark paid, delete — an invoice needs a client first), Clients, Profit & Loss, Tax, and FX Rates.

**Family** — a shared household budget. The owner invites members with a link; the invitee signs up or logs in and joins automatically, then the owner approves them. A member's Personal and Business expenses stay private — only expenses marked Family are shared. Also covers family savings goals, linked members, and per-person colours.

**BudgetWise Junior** — for kids. A parent creates a kid profile, and the kid signs in with a 4-digit PIN at the Kid sign-in link. Kids get money jars (Save / Spend / Give), chores they mark done for a parent to approve, learning missions, and savings goals they can propose to a parent.

# What is not available yet

- **Automatic bank linking does not work yet.** No bank connection, no automatic transaction import. Accounts are added manually or by CSV import. Say this plainly if asked — do not promise a date.
- The live spending feed is switched off.

# How to answer

Be brief and concrete. Give the click path — "Sidebar → Expenses → Add" — rather than a general description. Two or three sentences is usually right; use a short numbered list only for a multi-step task.

Answer in the user's language if they write in one other than English (South African users often write in Afrikaans or isiZulu).

Currency is South African Rand unless the user changed it on the Currency page.

If you don't know, or the question is about their specific account data, billing, a bug, or anything you can't see, say so and point them to support rather than guessing. You cannot see the user's expenses, balances, or account — you only know how the app works. Never invent a feature, menu item, or setting.

Never ask for a password, PIN, card number, or bank details, and tell the user not to share them if they offer.`;

serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(origin) });
  }
  if (req.method !== "POST") return json(origin, 405, { error: "POST only" });

  if (!ANTHROPIC_API_KEY) {
    console.error("[budgetsmart] ANTHROPIC_API_KEY is not set");
    return json(origin, 503, {
      error: "BudgetSmart isn't configured yet. Please email support.",
    });
  }

  try {
    // Signed-in callers only — this endpoint spends money per request.
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await anonClient.auth.getUser();
    if (!caller) return json(origin, 401, { error: "Not signed in" });

    const body = await req.json().catch(() => null);
    const rawMessages = body?.messages;
    const mode = typeof body?.mode === "string" ? body.mode : "personal";

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return json(origin, 400, { error: "No messages supplied." });
    }

    // Only keep the shape the API accepts, and only the recent tail — a long
    // help conversation doesn't need its own beginning.
    const messages = rawMessages
      .slice(-MAX_TURNS)
      .filter(
        (m: unknown): m is { role: string; content: string } =>
          !!m &&
          typeof m === "object" &&
          (( m as { role?: unknown }).role === "user" ||
            (m as { role?: unknown }).role === "assistant") &&
          typeof (m as { content?: unknown }).content === "string" &&
          (m as { content: string }).content.trim().length > 0,
      )
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content.slice(0, MAX_CHARS_PER_MESSAGE),
      }));

    if (messages.length === 0) {
      return json(origin, 400, { error: "No usable messages supplied." });
    }
    // The API rejects a conversation that doesn't start on the user's turn,
    // which can happen once the slice above trims the front.
    while (messages.length > 0 && messages[0].role !== "user") messages.shift();
    if (messages.length === 0) {
      return json(origin, 400, { error: "Conversation must start with a question." });
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const stream = anthropic.messages.stream({
      model: "claude-opus-5",
      max_tokens: 2048,
      // Effort `low` suits short help answers and keeps the widget snappy.
      // Thinking is deliberately left at its default (adaptive) — disabling it
      // on this model risks reasoning leaking into the visible reply.
      output_config: { effort: "low" },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          // The prompt is identical on every request; caching it makes each
          // follow-up markedly cheaper than the first question.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        ...messages.slice(0, -1),
        {
          role: "user" as const,
          content:
            `[The user is currently in ${mode} mode.]\n\n` +
            messages[messages.length - 1].content,
        },
      ],
    });

    // Plain text/event-stream of text deltas — the widget appends each chunk.
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (err) {
          console.error("[budgetsmart] stream failed", err);
          controller.enqueue(
            encoder.encode(
              "\n\nSorry — I lost my train of thought there. Please ask again.",
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        ...corsHeadersFor(origin),
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[budgetsmart] unhandled", err);
    return json(origin, 500, { error: "Unexpected error." });
  }
});
