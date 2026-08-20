import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ok } from '@/lib/db';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useExpenses } from '@/hooks/useExpenses';
import { useSavingsGoals } from '@/hooks/useSavingsGoals';
import { useUserSettings } from '@/hooks/useUserSettings';
import { formatCurrency, todayIso } from '@/lib/format';
import { CURRENCIES } from '@/lib/currencies';
import { ENABLE_PRO_SYSTEM, isAdmin, isProUser } from '@/lib/access';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { IncomeRoutingModal } from '@/components/IncomeRoutingModal';
import { disablePush, enablePush, getPushStatus, type PushStatus } from '@/lib/push-subscription';

// -------- Achievements (mirrors js/app.js:4261 achievementDefs) --------
interface AchievementDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  check: (ctx: {
    expensesCount: number;
    categoriesUsed: number;
    goalReached: boolean;
    underBudget: boolean;
    streakDays: number;
  }) => boolean;
}

const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_expense', icon: '\u{1F31F}', title: 'First Step', desc: 'Logged your first expense', check: (c) => c.expensesCount >= 1 },
  { id: 'ten_expenses', icon: '\u{1F4DD}', title: 'Tracker', desc: 'Logged 10 expenses', check: (c) => c.expensesCount >= 10 },
  { id: 'fifty_expenses', icon: '\u{1F4DA}', title: 'Bookkeeper', desc: 'Logged 50 expenses', check: (c) => c.expensesCount >= 50 },
  { id: 'hundred_expenses', icon: '\u{1F3C6}', title: 'Centurion', desc: 'Logged 100 expenses', check: (c) => c.expensesCount >= 100 },
  { id: 'goal_reached', icon: '\u{1F389}', title: 'Goal Smasher', desc: 'Reached a savings goal', check: (c) => c.goalReached },
  { id: 'under_budget', icon: '\u{1F4B0}', title: 'Budget Boss', desc: 'Spent less than income this month', check: (c) => c.underBudget },
  { id: 'streak_7', icon: '\u{1F525}', title: 'Week Warrior', desc: '7-day logging streak', check: (c) => c.streakDays >= 7 },
  { id: 'streak_30', icon: '\u2B50', title: 'Monthly Master', desc: '30-day logging streak', check: (c) => c.streakDays >= 30 },
  { id: 'five_categories', icon: '\u{1F3A8}', title: 'Diversified', desc: 'Used 5+ categories', check: (c) => c.categoriesUsed >= 5 },
];

// -------- Automations (6 toggles) --------
interface AutomationDef {
  key: string;
  title: string;
  desc: string;
}
const AUTOMATIONS: AutomationDef[] = [
  { key: 'auto_categorize', title: 'Auto-Categorize', desc: 'Smart-guess a category for new expenses based on the description.' },
  { key: 'auto_savings', title: 'Auto-Savings', desc: 'Move a slice of leftover income to your savings goals each month.' },
  { key: 'bill_reminders', title: 'Bill Reminders', desc: 'Get a heads-up before recurring bills are due.' },
  { key: 'weekly_summary', title: 'Weekly Summary', desc: 'Receive a weekly digest of your spending and savings.' },
  { key: 'payday_auto_split', title: 'Payday Auto-Split', desc: 'Split incoming salary across budgets the moment it lands.' },
  { key: 'low_balance_warning', title: 'Low Balance Warning', desc: 'Alert me when my remaining budget drops below a safe threshold.' },
];

// -------- Backup / restore --------

/** A `supabase.from(...).select(...)` awaited for its rows, whatever the table. */
type TableRead = PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
}>;

/** Tables "Restore from Backup" writes back. Everything else in the file is a
 *  record only — restoring it in-app would re-create rows under fresh ids that
 *  the ids frozen in the same file no longer point at. */
const BACKUP_RESTORABLE = ['user_settings', 'expenses', 'savings_goals'] as const;

/** Deliberately left out of the file, so the alert and the JSON can say so
 *  plainly rather than implying the export is complete. The first two are live
 *  credentials and must never reach the user's Downloads folder. */
const BACKUP_EXCLUDED = [
  'linked_accounts.plaid_access_token (bank credential)',
  'family_members.pin_hash (kid PIN)',
  'kid_mission_progress, kid_streaks, kid_devices, family_goal_contributions (keyed to a member row, not to you)',
  'kid_notifications, push_subscriptions, login_events, audit_logs, budgetsmart_usage (device and audit records)',
] as const;

/** Insert/delete batch size. Also keeps the `.in('id', …)` rollback URLs
 *  comfortably inside PostgREST's request length limit. */
const RESTORE_CHUNK = 200;

/**
 * Replace every row `uid` owns in `table` with `rows`, guaranteeing the caller
 * can never come out of a restore with less than they went in with.
 *
 * This used to be `delete(everything)` followed by a single `insert(everything)`.
 * Both halves are hostile. The DELETE is unguarded and always commits, while
 * the one-statement INSERT is all-or-nothing and really does get rejected in
 * full: 42501 from the restrictive expenses_group_write_guard_insert once the
 * user has been removed from the family group the backed-up rows still carry,
 * or 23503 from a trip or bank link deleted after the backup was taken. The
 * user was then left holding zero expenses, was told the result was "partial"
 * when it was total, and had already spent their only copy. Retrying the same
 * file failed identically.
 *
 * So: insert first, retry once with the stale references stripped, and only
 * remove the previous rows after the new ones are committed.
 */
async function restoreOwnedRows(
  table: string,
  rows: Array<Record<string, unknown>>,
  uid: string,
  staleRefColumns: string[],
): Promise<{ error?: string; warning?: string }> {
  const { data: existing, error: readErr } = await supabase
    .from(table)
    .select('id')
    .eq('user_id', uid);
  if (readErr) {
    return {
      error: `${table}: could not read what you currently have (${readErr.message}) — nothing was changed.`,
    };
  }

  const insertedIds: string[] = [];
  const rollback = async () => {
    for (let i = 0; i < insertedIds.length; i += RESTORE_CHUNK) {
      await supabase
        .from(table)
        .delete()
        .eq('user_id', uid)
        .in('id', insertedIds.slice(i, i + RESTORE_CHUNK));
    }
    insertedIds.length = 0;
  };

  const insertAll = async (batch: Array<Record<string, unknown>>): Promise<string | null> => {
    for (let i = 0; i < batch.length; i += RESTORE_CHUNK) {
      const slice = batch.slice(i, i + RESTORE_CHUNK);
      const { data, error } = await supabase.from(table).insert(slice).select('id');
      if (error) return error.message;
      // A write RLS blocks reports error: null and stores nothing, so the row
      // count is the only honest signal that the insert actually happened.
      if (!data || data.length < slice.length) {
        return 'the database accepted the request but did not store the rows (blocked by a security policy).';
      }
      for (const r of data as Array<{ id: string }>) insertedIds.push(r.id);
    }
    return null;
  };

  let failure = await insertAll(rows);
  if (failure && staleRefColumns.length > 0) {
    await rollback();
    // Second attempt with the columns that can block a re-insert cleared:
    // a trip or bank link deleted since the backup (23503), a family group the
    // user is no longer an approved member of (42501), or — the failure mode
    // inserting-before-deleting introduces — a value that is unique per user
    // and whose original row is still sitting there, because we no longer
    // clear it first (23505). What matters about an expense is its amount,
    // date, category and description; losing its trip tag or its bank
    // reconciliation id is vastly better than losing the row.
    const stripped = rows.map((r) => {
      const copy = { ...r };
      for (const col of staleRefColumns) copy[col] = null;
      return copy;
    });
    failure = await insertAll(stripped);
  }
  if (failure) {
    await rollback();
    return { error: `${table}: ${failure} Nothing was removed — what you already had is untouched.` };
  }

  // Only now is it safe to clear what the backup replaces.
  const oldIds = ((existing ?? []) as Array<{ id: string }>).map((r) => r.id);
  for (let i = 0; i < oldIds.length; i += RESTORE_CHUNK) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', uid)
      .in('id', oldIds.slice(i, i + RESTORE_CHUNK));
    if (error) {
      return {
        warning: `${table}: the backup is restored, but the rows it replaces could not be removed (${error.message}) — expect duplicates.`,
      };
    }
  }
  return {};
}

/**
 * Ports #page-account from dashboard.html lines 2275-2442.
 *
 * Scope for this round: profile, subscription badge (stub), account
 * details, quick stats, update monthly budget, change password, sign out.
 *
 * Deferred: avatar upload, backup/restore JSON, delete all data,
 * change email/name inline, tithe toggle, achievements grid, Upgrade flow.
 */
export default function AccountPage() {
  const { user, signOut } = useAuth();
  const { mode } = useMode();
  const { theme, toggleTheme } = useTheme();
  const { expenses, refresh: refreshExpenses } = useExpenses();
  const { goals, refresh: refreshGoals } = useSavingsGoals();
  const {
    currency,
    income,
    savingsGoal,
    avatarUrl,
    isProFromSettings,
    updateSettings,
    refresh: refreshSettings,
  } = useUserSettings();
  const navigate = useNavigate();

  const isPro = isProUser(isProFromSettings, user);
  const admin = isAdmin(user);

  // Automations JSONB + tithe flags + editable profile — loaded directly
  // from user_settings because useUserSettings doesn't expose these columns.
  const [automations, setAutomations] = useState<Record<string, boolean>>({});
  // Raw automations JSONB exactly as stored — the column also carries
  // non-boolean bookkeeping keys (e.g. low_balance_threshold,
  // weekly_summary_last_sent) that the coerced boolean map above would
  // otherwise write back as `true` on the next toggle.
  const automationsRaw = useRef<Record<string, unknown>>({});
  // Guards the switches until the read resolves: they used to render enabled
  // from first paint, so a click during load rebuilt the whole automations
  // object from `{}` and silently wiped the stored keys.
  const [automationsLoaded, setAutomationsLoaded] = useState(false);
  const [titheEnabled, setTitheEnabled] = useState(false);
  const [profileName, setProfileName] = useState<string>('');
  const [profileEmail, setProfileEmail] = useState<string>('');
  const [editingName, setEditingName] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarZoom, setAvatarZoom] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const metadataAvatar =
    (user?.user_metadata?.avatar_url as string | undefined) ??
    (user?.user_metadata?.picture as string | undefined) ??
    null;
  const effectiveAvatar = avatarUrl || metadataAvatar;

  const [currencyInput, setCurrencyInput] = useState(currency);

  // Push notifications (Junior Phase 5).
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    void getPushStatus().then(setPushStatus);
  }, []);
  async function onTogglePush() {
    setPushBusy(true);
    if (pushStatus?.subscribed) {
      await disablePush();
    } else {
      await enablePush();
    }
    setPushStatus(await getPushStatus());
    setPushBusy(false);
  }
  const [incomeInput, setIncomeInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [incomeRouting, setIncomeRouting] = useState<number | null>(null);
  const { accounts: linkedAccts, updateBalance: updateAccBalance } = useLinkedAccounts();

  // Seed the form once settings load
  useEffect(() => {
    setCurrencyInput(currency);
    setIncomeInput(income ? String(income) : '');
    setGoalInput(savingsGoal ? String(savingsGoal) : '');
  }, [currency, income, savingsGoal]);

  // Seed profile fields from auth user
  useEffect(() => {
    const fn = (user?.user_metadata?.full_name as string | undefined) ?? '';
    setProfileName(fn);
    setProfileEmail(user?.email ?? '');
  }, [user]);

  // Load automations JSONB + the tithe flag from user_settings. The tithe
  // toggle used to live only in localStorage on the stated basis that no
  // dedicated column exists — but user_settings really has tithe_personal /
  // tithe_business / tithe_family. Persist to the column matching the active
  // mode, keeping the old localStorage value as a read fallback so nobody
  // loses a setting they already chose on this device.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from('user_settings')
        .select('automations, tithe_personal, tithe_business, tithe_family')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // A failed read must not be treated as "no automations saved":
        // rebuilding the JSONB from empty client state on the next toggle
        // would wipe the stored keys. Leave the switches disabled instead.
        console.error('[automations read failed]', error.message);
        alert(`Could not load your automation settings: ${error.message}`);
        try {
          setTitheEnabled(localStorage.getItem('bw-tithe-enabled') === '1');
        } catch (_) {}
        return;
      }
      const raw = (data as { automations?: unknown } | null)?.automations;
      const rawObj: Record<string, unknown> = {};
      const parsed: Record<string, boolean> = {};
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          rawObj[k] = v;
          parsed[k] = Boolean(v);
        }
      }
      automationsRaw.current = rawObj;
      setAutomations(parsed);
      setAutomationsLoaded(true);
      const titheColumn =
        mode === 'business'
          ? 'tithe_business'
          : mode === 'family'
            ? 'tithe_family'
            : 'tithe_personal';
      const dbTithe = Boolean(
        (data as Record<string, unknown> | null)?.[titheColumn],
      );
      let storedTithe = false;
      try {
        storedTithe = localStorage.getItem('bw-tithe-enabled') === '1';
      } catch (_) {}
      setTitheEnabled(dbTithe || storedTithe);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, mode]);

  const toggleAutomation = async (key: string) => {
    if (!user || !automationsLoaded) return;
    const next = { ...automations, [key]: !automations[key] };
    setAutomations(next);
    // Merge into the raw stored object, not the Boolean()-coerced map — the
    // column also holds non-boolean bookkeeping values that a coerced
    // rewrite silently destroyed even on the happy path.
    const nextRaw = { ...automationsRaw.current, [key]: !automations[key] };
    // Upsert, not update. Roughly half of all accounts have no user_settings
    // row yet, and an UPDATE that matches zero rows reports no error — the
    // toggle lit up, nothing failed, and the choice was gone on reload.
    // `user_id` carries its own UNIQUE index, so it is a valid conflict target
    // even though the primary key is `id`.
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, automations: nextRaw }, { onConflict: 'user_id' });
    if (error) {
      setAutomations((prev) => ({ ...prev, [key]: !next[key] }));
      alert(`Failed to save automation: ${error.message}`);
      return;
    }
    automationsRaw.current = nextRaw;
  };

  const handleAvatarFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Image too large — please pick one under 2MB.');
      return;
    }
    setAvatarUploading(true);
    try {
      // Read + downscale to 256x256 as a data URL, then persist to
      // user_settings.avatar_url. Matches the vanilla app's approach.
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const size = 256;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('no canvas ctx'));
            // Center-crop to square then scale
            const min = Math.min(img.width, img.height);
            const sx = (img.width - min) / 2;
            const sy = (img.height - min) / 2;
            ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = reader.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      // Upsert for the same reason as toggleAutomation: an account with no
      // settings row would swallow the write and show the old avatar back.
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, avatar_url: dataUrl }, { onConflict: 'user_id' });
      if (error) throw error;
      // AUDIT Imp #23: refresh settings in place instead of reloading the whole
      // tab — avoids nuking unsaved state elsewhere in the app.
      await refreshSettings();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Upload failed: ${msg}`);
    } finally {
      setAvatarUploading(false);
    }
  };

  const toggleTithe = async () => {
    if (!user) return;
    const next = !titheEnabled;
    setTitheEnabled(next);
    // Keep the legacy localStorage copy in sync so the read fallback above
    // never contradicts what the user just chose on this device.
    try {
      localStorage.setItem('bw-tithe-enabled', next ? '1' : '0');
    } catch (_) {
      // localStorage unavailable — the DB column below is the real store
    }
    const titheColumn =
      mode === 'business'
        ? 'tithe_business'
        : mode === 'family'
          ? 'tithe_family'
          : 'tithe_personal';
    const saved = await ok(
      supabase
        .from('user_settings')
        .upsert({ user_id: user.id, [titheColumn]: next }, { onConflict: 'user_id' }),
      'save your tithe setting',
    );
    if (!saved) {
      setTitheEnabled(!next);
      try {
        localStorage.setItem('bw-tithe-enabled', !next ? '1' : '0');
      } catch (_) {}
    }
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setEditingName(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
    if (error) {
      alert(`Error updating name: ${error.message}`);
      return;
    }
    setProfileName(trimmed);
    setEditingName(false);
  };

  const saveEmail = async () => {
    const trimmed = emailDraft.trim();
    if (!trimmed) {
      setEditingEmail(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ email: trimmed });
    if (error) {
      alert(`Error updating email: ${error.message}`);
      return;
    }
    alert(`Confirmation email sent to ${trimmed}`);
    setEditingEmail(false);
  };

  const handleBackup = async () => {
    if (!user) return;
    try {
      const uid = user.id;
      // "Backup All Data" read exactly three tables while sitting in the same
      // Actions card as Purge Entire Account, so the obvious safe sequence —
      // back up, then purge — permanently destroyed everything the file did
      // not hold: custom categories, every family member, chores, family
      // goals, the whole kid earnings ledger, trips and the bank links. Export
      // every table the caller genuinely owns instead, scoped by the column
      // that actually holds the owner id (family_groups and stokvel_groups key
      // on owner_id, stokvel_payouts on recipient_id). Two columns are named
      // out of their SELECTs on purpose: plaid_access_token and pin_hash are
      // live credentials and this file lands in the Downloads folder.
      const reads: Array<{ key: string; label: string; run: () => TableRead }> = [
        { key: 'user_settings', label: 'settings', run: () => supabase.from('user_settings').select('*').eq('user_id', uid) },
        { key: 'expenses', label: 'expenses', run: () => supabase.from('expenses').select('*').eq('user_id', uid) },
        { key: 'savings_goals', label: 'savings goals', run: () => supabase.from('savings_goals').select('*').eq('user_id', uid) },
        { key: 'custom_categories', label: 'custom categories', run: () => supabase.from('custom_categories').select('*').eq('user_id', uid) },
        { key: 'trips', label: 'trips', run: () => supabase.from('trips').select('*').eq('user_id', uid) },
        { key: 'family_groups', label: 'family group', run: () => supabase.from('family_groups').select('*').eq('owner_id', uid) },
        {
          key: 'family_members',
          label: 'family members',
          run: () =>
            supabase
              .from('family_members')
              .select('id, user_id, name, role, age, color, allowance, spent, earned, created_at, group_id, date_of_birth, jar_split')
              .eq('user_id', uid),
        },
        { key: 'family_links', label: 'linked members', run: () => supabase.from('family_links').select('*').eq('user_id', uid) },
        { key: 'family_chores', label: 'chores', run: () => supabase.from('family_chores').select('*').eq('user_id', uid) },
        { key: 'family_goals', label: 'family goals', run: () => supabase.from('family_goals').select('*').eq('user_id', uid) },
        { key: 'kid_ledger', label: 'kid earnings ledger', run: () => supabase.from('kid_ledger').select('*').eq('user_id', uid) },
        { key: 'kid_mission_rewards', label: 'mission rewards', run: () => supabase.from('kid_mission_rewards').select('*').eq('user_id', uid) },
        { key: 'kid_money_requests', label: 'kid money requests', run: () => supabase.from('kid_money_requests').select('*').eq('user_id', uid) },
        {
          key: 'linked_accounts',
          label: 'bank links',
          run: () =>
            supabase
              .from('linked_accounts')
              .select('id, user_id, account_id, account_name, account_type, account_subtype, institution_name, mask, balance_current, balance_available, currency_code, last_synced, created_at, account_mode, is_primary, is_business')
              .eq('user_id', uid),
        },
        { key: 'stokvel_groups', label: 'stokvel groups', run: () => supabase.from('stokvel_groups').select('*').eq('owner_id', uid) },
        { key: 'stokvel_members', label: 'stokvel memberships', run: () => supabase.from('stokvel_members').select('*').eq('user_id', uid) },
        { key: 'stokvel_contributions', label: 'stokvel contributions', run: () => supabase.from('stokvel_contributions').select('*').eq('user_id', uid) },
        { key: 'stokvel_payouts', label: 'stokvel payouts', run: () => supabase.from('stokvel_payouts').select('*').eq('recipient_id', uid) },
        { key: 'invoices', label: 'invoices', run: () => supabase.from('invoices').select('*').eq('user_id', uid) },
        { key: 'clients', label: 'clients', run: () => supabase.from('clients').select('*').eq('user_id', uid) },
      ];
      const results = await Promise.all(reads.map((r) => r.run()));
      // Refuse to write a file if any query errored: `data` is null on
      // failure, and `?? []` used to turn that into a convincingly valid
      // backup with zero expenses — which the restore path then trusted,
      // deleting everything before "re-inserting" nothing.
      const failed: string[] = [];
      results.forEach((res, i) => {
        if (res.error) failed.push(`${reads[i].label}: ${res.error.message}`);
      });
      if (failed.length > 0) {
        alert(
          `Backup failed — no file was created. Nothing was read for:\n\n${failed.join('\n')}\n\nPlease try again.`,
        );
        return;
      }
      const tables: Record<string, unknown[]> = {};
      let totalRows = 0;
      results.forEach((res, i) => {
        const rows = res.data ?? [];
        tables[reads[i].key] = rows;
        totalRows += rows.length;
      });
      const backup = {
        // Bumped from 1 because the file now carries far more than the three
        // original keys. Restore still accepts a version 1 file.
        version: 2,
        timestamp: new Date().toISOString(),
        user_id: uid,
        restorable_in_app: BACKUP_RESTORABLE,
        not_included: BACKUP_EXCLUDED,
        ...tables,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budgetwise-backup-${todayIso()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      alert(
        `Backup downloaded — ${totalRows} rows across ${reads.length} tables.\n\n` +
          'Restore from Backup puts back your settings, expenses and savings goals. ' +
          'Everything else in the file (family, chores, kid ledger, trips, bank links, stokvel) ' +
          'is saved as a record only and cannot be put back from inside the app.\n\n' +
          'Bank access tokens and kid PINs are deliberately left out of the file.',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Backup failed: ${msg}`);
    }
  };

  const handleRestoreClick = () => {
    restoreInputRef.current?.click();
  };

  const handleRestoreFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file || !user) return;
    try {
      const text = await file.text();
      // AUDIT Imp #8: strict shape validation before any destructive action.
      let backup: {
        version?: number | string;
        user_id?: string;
        timestamp?: string;
        expenses?: unknown;
        savings_goals?: unknown;
        user_settings?: unknown;
      };
      try {
        backup = JSON.parse(text);
      } catch {
        alert('Invalid backup file: not valid JSON.');
        return;
      }
      if (Number(backup.version) !== 1 && Number(backup.version) !== 2) {
        alert('Invalid backup file: unsupported version (expected 1 or 2).');
        return;
      }
      if (!Array.isArray(backup.expenses)) {
        alert('Invalid backup file: expenses must be an array.');
        return;
      }
      if (backup.savings_goals != null && !Array.isArray(backup.savings_goals)) {
        alert('Invalid backup file: savings_goals must be an array.');
        return;
      }
      if (backup.user_settings != null && !Array.isArray(backup.user_settings)) {
        alert('Invalid backup file: user_settings must be an array.');
        return;
      }
      // Reject cross-account restore by default — if the caller really wants
      // to, they need to confirm a second time.
      if (backup.user_id && backup.user_id !== user.id) {
        if (
          !confirm(
            'This backup was exported by a different account. Restoring will overwrite your data with theirs. Continue?',
          )
        ) {
          return;
        }
      }

      const stamp = backup.timestamp
        ? new Date(backup.timestamp).toLocaleDateString()
        : 'unknown date';
      if (
        !confirm(
          `This will replace your settings, expenses and savings goals with the backup from ${stamp}. Anything else in the file is a record only and will not be put back. Continue?`,
        )
      )
        return;

      const uid = user.id;
      const errs: string[] = [];
      const warnings: string[] = [];
      const expensesArr = backup.expenses as Array<Record<string, unknown>>;
      const goalsArr = backup.savings_goals as Array<Record<string, unknown>> | undefined;

      const settingsArr = backup.user_settings as Array<Record<string, unknown>> | undefined;
      if (settingsArr && settingsArr.length > 0) {
        const settings = { ...settingsArr[0] };
        delete settings.id;
        settings.user_id = uid;
        const { error } = await supabase.from('user_settings').upsert(settings, { onConflict: 'user_id' });
        if (error) errs.push(`user_settings: ${error.message}`);
      }
      // Defensive: never wipe a table the backup holds no rows for. An empty
      // array would otherwise mean "delete everything, restore nothing".
      // restoreOwnedRows carries the rest of the guarantee — it inserts before
      // it deletes, so a rejected batch leaves the user exactly as they were.
      if (expensesArr.length > 0) {
        const res = await restoreOwnedRows(
          'expenses',
          expensesArr.map((e) => {
            const copy = { ...e };
            delete copy.id;
            copy.user_id = uid;
            return copy;
          }),
          uid,
          // trip_id / linked_account_id / group_id can point at something
          // deleted or un-joined since the backup. external_id is here for a
          // different reason: `expenses_user_external_uniq` is UNIQUE
          // (user_id, external_id) WHERE external_id IS NOT NULL, and because
          // we now insert before we delete, a backed-up bank-imported row is
          // re-inserted while the original is still present — 23505 on the
          // first pass, and without this the retry would fail identically and
          // abort the whole restore. Nulling it costs the row its bank
          // reconciliation id (a later re-sync could re-import it); keeping it
          // would cost the row itself.
          ['trip_id', 'linked_account_id', 'group_id', 'external_id'],
        );
        if (res.error) errs.push(res.error);
        if (res.warning) warnings.push(res.warning);
      }
      if (goalsArr && goalsArr.length > 0) {
        const res = await restoreOwnedRows(
          'savings_goals',
          goalsArr.map((g) => {
            const copy = { ...g };
            delete copy.id;
            copy.user_id = uid;
            return copy;
          }),
          uid,
          ['group_id'],
        );
        if (res.error) errs.push(res.error);
        if (res.warning) warnings.push(res.warning);
      }
      if (errs.length > 0) {
        alert(
          `Restore did not fully complete:\n\n${errs.join('\n')}\n\nNothing was lost — anything that could not be restored left the rows you already had in place, and your backup file is still valid.`,
        );
      } else if (warnings.length > 0) {
        alert(`Restore complete, with one thing to check:\n\n${warnings.join('\n')}`);
      } else {
        alert('Restore complete.');
      }
      // AUDIT Imp #23: refresh the three affected hooks in place.
      await Promise.all([refreshExpenses(), refreshGoals(), refreshSettings()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Restore failed: ${msg}`);
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  const handleDeleteAll = async () => {
    if (!user) return;
    if (
      !confirm(
        'This will permanently delete all your expenses and savings goals (family, chores, and bank links are kept). Are you sure?',
      )
    )
      return;
    if (!confirm('This cannot be undone. Click OK to confirm.')) return;
    const uid = user.id;
    // AUDIT Imp #7: surface partial-failure so user knows if one step died.
    const errs: string[] = [];
    const { error: expErr } = await supabase.from('expenses').delete().eq('user_id', uid);
    if (expErr) errs.push(`expenses: ${expErr.message}`);
    const { error: goalErr } = await supabase.from('savings_goals').delete().eq('user_id', uid);
    if (goalErr) errs.push(`savings_goals: ${goalErr.message}`);
    if (errs.length > 0) {
      alert(`Deletion partially failed — some data may remain:\n\n${errs.join('\n')}`);
      return;
    }
    alert('All expenses and savings goals deleted.');
    // AUDIT Imp #23: refresh in place.
    await Promise.all([refreshExpenses(), refreshGoals()]);
  };

  const handlePurgeAccount = async () => {
    // AUDIT Imp #7 (full version): nuclear option — delete every user-owned
    // row across every table. Gated by two confirms + typed token.
    if (!user) return;
    if (
      !confirm(
        'Purge EVERYTHING: expenses, savings, trips, family, chores, stokvel, bank links, kid logins and progress, invoices, clients, settings — and this sign-in itself. You will not be able to log back in. This cannot be undone. Continue?',
      )
    )
      return;
    const typed = window.prompt(
      'Type PURGE (all caps) to confirm total account deletion:',
    );
    if (typed !== 'PURGE') return;
    // The account is about to stop existing, so signOut() is talking to the
    // server about a user that is already gone and may well come back with an
    // error. Leaving them parked on a dashboard whose data was just deleted is
    // the one outcome we cannot allow, so the navigate happens either way.
    const leave = async () => {
      try {
        await signOut();
      } catch {
        // ignore — the local session is discarded and the route change is what
        // actually gets them off the purged dashboard.
      }
      navigate('/', { replace: true });
    };

    let res: Response;
    let body: { ok?: boolean; errors?: Record<string, string>; error?: string } | null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/purge-account`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ confirm: 'PURGE' }),
        },
      );
      body = (await res.json().catch(() => null)) as typeof body;
    } catch (err) {
      // A dropped request used to throw straight out of this handler, so the
      // user got no alert at all on the most destructive button in the app and
      // had no idea whether it had run.
      const msg = err instanceof Error ? err.message : String(err);
      alert(
        `Could not reach the server (${msg}).\n\nWe cannot tell whether the purge ran. Reload and check your data before trying again.`,
      );
      return;
    }

    // The function deletes the caller's auth user in one statement and every
    // table cascades off it, so the outcome is now genuinely binary: 200 means
    // the account and all of its data are gone, and a 4xx/5xx means nothing
    // was touched. 207 is reserved for the one leftover the cascade cannot
    // reach — a child login whose own delete failed after the account itself
    // was destroyed. Previously the function's table list named a dropped
    // table and three owner columns that do not exist, so it returned 207 on
    // every single invocation and this success branch was dead code for every
    // user, while their data really was being deleted behind an "errors" alert.
    if (res.status === 200 && body?.ok) {
      alert('Account purged, including this login. You will be signed out.');
      await leave();
      return;
    }
    if (res.status === 207) {
      const errs = Object.entries(body?.errors ?? {})
        .map(([t, m]) => `• ${t}: ${m}`)
        .join('\n');
      // Sign out regardless: the account really is deleted, so leaving them on
      // a dashboard reading from stale in-memory hooks is the worse outcome.
      alert(
        `Your account and data were deleted, but these child logins could not be removed:\n\n${errs}\n\nSigning you out now. Please send this message to support so the rest can be cleared.`,
      );
      await leave();
      return;
    }
    alert(
      `Purge failed: ${body?.error ?? res.statusText}\n\nNothing was deleted and you are still signed in.`,
    );
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    const newIncome = parseFloat(incomeInput) || 0;
    const incomeChanged = newIncome !== income && newIncome > 0;
    const { error } = await updateSettings({
      currency: currencyInput,
      income: newIncome,
      savings_goal: parseFloat(goalInput) || 0,
    });
    setSaving(false);
    setSaveMsg(
      error
        ? { text: `Save failed: ${error}`, ok: false }
        : { text: 'Saved', ok: true },
    );
    // Show income routing modal if income changed and user has bank accounts
    if (!error && incomeChanged && linkedAccts.length > 0) {
      setIncomeRouting(newIncome);
    }
    // Auto-clear the success message after a moment
    if (!error) setTimeout(() => setSaveMsg(null), 2500);
  };

  const handleIncomeRoute = async (accountId: string) => {
    if (incomeRouting == null) return;
    const acc = linkedAccts.find((a) => a.id === accountId);
    if (acc) {
      await updateAccBalance(accountId, (acc.balance_current ?? 0) + incomeRouting);
    }
    setIncomeRouting(null);
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) alert(`Error: ${error.message}`);
    else alert('Password reset link sent — check your email.');
  };

  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? '—';
  const email = user?.email ?? '—';
  const provider =
    (user?.app_metadata?.provider as string | undefined) === 'google'
      ? 'Google'
      : 'Email & Password';
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—';

  const initials = fullName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const categoriesUsed = new Set(expenses.map((e) => e.category)).size;

  /**
   * Longest current streak of consecutive days with at least one logged
   * expense, ending today. Walks backwards from today one day at a time.
   *
   * AUDIT Imp #16: memoize — this ran on every render (including every
   * keystroke in the settings form), each iteration constructing Dates
   * and formatting strings up to 365x. Only re-run when expenses change.
   *
   * AUDIT Imp #13: use local-time day keys instead of toISOString().slice
   * so day comparison doesn't skip or double-count around local midnight.
   */
  const streakDays = useMemo(() => {
    if (expenses.length === 0) return 0;
    const dayKeys = new Set(expenses.map((e) => e.date?.slice(0, 10)).filter(Boolean) as string[]);
    const localKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let streak = 0;
    const cursor = new Date();
    if (!dayKeys.has(localKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (true) {
      if (!dayKeys.has(localKey(cursor))) break;
      streak++;
      cursor.setDate(cursor.getDate() - 1);
      if (streak > 365) break; // safety cap
    }
    return streak;
  }, [expenses]);

  // Achievement context
  const now = new Date();
  const ymKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthTotal = expenses
    .filter((e) => e.date.startsWith(ymKey))
    .reduce((s, e) => s + e.amount, 0);
  const achievementCtx = {
    expensesCount: expenses.length,
    categoriesUsed,
    goalReached: goals.some((g) => g.saved_amount >= g.target_amount),
    underBudget: monthTotal > 0 && income > 0 && monthTotal < income,
    streakDays,
  };

  return (
    <>
    <section className="page active" id="page-account">
      <div className="page-header">
        <div>
          <h1>Account</h1>
          <p className="page-subtitle">Your profile and settings</p>
        </div>
      </div>

      <div className="account-profile-clean">
        <h2 className="account-name-top">{fullName}</h2>
        <div className="account-avatar-wrap" style={{ position: 'relative', display: 'inline-block' }}>
          <div
            className="account-avatar"
            onClick={() => effectiveAvatar && setAvatarZoom(true)}
            style={{
              cursor: effectiveAvatar ? 'zoom-in' : 'default',
              ...(effectiveAvatar
                ? {
                    backgroundImage: `url(${encodeURI(effectiveAvatar)})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : {}),
            }}
          >
            {effectiveAvatar ? '' : initials}
          </div>
          <button
            type="button"
            className="avatar-camera-btn"
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarUploading}
            aria-label="Change profile picture"
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '2px solid var(--accent, #10b981)',
              background: 'var(--card-bg, #1a1a2e)',
              color: 'var(--accent, #10b981)',
              cursor: avatarUploading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}
          >
            {avatarUploading ? (
              <div
                style={{
                  width: 14,
                  height: 14,
                  border: '2px solid rgba(16,185,129,0.25)',
                  borderTopColor: '#10b981',
                  borderRadius: '50%',
                  animation: 'bw-spin 0.8s linear infinite',
                }}
              />
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleAvatarFile}
          />
        </div>
      </div>

      {/* Avatar zoom overlay */}
      {avatarZoom && effectiveAvatar && (
        <div
          onClick={() => setAvatarZoom(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            padding: 20,
          }}
        >
          <img
            src={effectiveAvatar}
            alt="Profile"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 16,
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            }}
          />
        </div>
      )}

      {/*
       * Subscription card — when the Pro system is disabled or the user is
       * Pro, show a PRO badge only. Never show upgrade copy to Pro users.
       */}
      {isPro ? (
        <div className="pro-card">
          <div className="pro-card-inner">
            <div className="pro-card-left">
              <div className="pro-plan-badge" style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff' }}>PRO</div>
              <div className="pro-card-text">
                <h3>{admin ? 'You\u2019re on Pro' : 'You\u2019re on Pro'}</h3>
                {admin && (
                  <p style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: 4 }}>
                    Founder
                  </p>
                )}
                <p>
                  Everything is unlocked — Business &amp; Family modes, bank sync,
                  alerts, and priority support.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : ENABLE_PRO_SYSTEM ? (
        <div className="pro-card">
          <div className="pro-card-inner">
            <div className="pro-card-left">
              <div className="pro-plan-badge">FREE</div>
              <div className="pro-card-text">
                <h3>Upgrade to Pro</h3>
                <p>
                  Unlock bank sync, Business &amp; Family modes, push alerts, and
                  priority support.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-upgrade"
              onClick={() => alert('Upgrade flow — coming in a later round.')}
            >
              Upgrade Now
            </button>
          </div>
        </div>
      ) : null}

      <div className="account-grid">
        {/* Account details */}
        <div className="chart-card full-width">
          <h3>Account Details</h3>
          <div className="account-details">
            <div className="account-row">
              <span className="account-label">Full Name</span>
              <span className="account-value">
                {editingName ? (
                  <>
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      style={{ marginRight: 8 }}
                    />
                    <button
                      type="button"
                      className="btn-change-inline"
                      onClick={saveName}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn-change-inline"
                      onClick={() => setEditingName(false)}
                      style={{ marginLeft: 4 }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span>{profileName || fullName}</span>
                    <button
                      type="button"
                      className="btn-change-inline"
                      onClick={() => {
                        setNameDraft(profileName || '');
                        setEditingName(true);
                      }}
                      style={{ marginLeft: 8 }}
                    >
                      Edit
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="account-row">
              <span className="account-label">Email</span>
              <span className="account-value">
                {editingEmail ? (
                  <>
                    <input
                      type="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      style={{ marginRight: 8 }}
                    />
                    <button
                      type="button"
                      className="btn-change-inline"
                      onClick={saveEmail}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn-change-inline"
                      onClick={() => setEditingEmail(false)}
                      style={{ marginLeft: 4 }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span>{profileEmail || email}</span>
                    <button
                      type="button"
                      className="btn-change-inline"
                      onClick={() => {
                        setEmailDraft(profileEmail || '');
                        setEditingEmail(true);
                      }}
                      style={{ marginLeft: 8 }}
                    >
                      Change
                    </button>
                  </>
                )}
              </span>
            </div>
            <div className="account-row">
              <span className="account-label">Sign-in Method</span>
              <span className="account-value">{provider}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Member Since</span>
              <span className="account-value">{memberSince}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Currency</span>
              <span className="account-value">{currency}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Monthly Income</span>
              <span className="account-value">
                {formatCurrency(income, currency)}
              </span>
            </div>
            <div className="account-row">
              <span className="account-label">Savings Goal</span>
              <span className="account-value">
                {formatCurrency(savingsGoal, currency)}
              </span>
            </div>
            <div className="account-row" id="titheRow">
              <span className="account-label">Tithe (10%)</span>
              <span className="account-value tithe-value">
                <span>
                  {titheEnabled ? formatCurrency(income * 0.1, currency) : 'Off'}
                </span>
                <label className="tithe-toggle">
                  <input
                    type="checkbox"
                    checked={titheEnabled}
                    onChange={toggleTithe}
                  />
                  <span className="tithe-slider"></span>
                </label>
              </span>
            </div>
          </div>
        </div>

        {/* Update budget inline form */}
        <div className="chart-card full-width">
          <h3>Update Budget &amp; Currency</h3>
          <form onSubmit={handleSave} className="inline-form">
            <div className="field">
              <label>Currency</label>
              <select
                className="input"
                value={currencyInput}
                onChange={(e) => setCurrencyInput(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Monthly Income</label>
              <input
                type="number"
                value={incomeInput}
                onChange={(e) => setIncomeInput(e.target.value)}
                placeholder="e.g. 25000"
                min="0"
                step="0.01"
              />
            </div>
            <div className="field">
              <label>Monthly Savings Goal</label>
              <input
                type="number"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="e.g. 5000"
                min="0"
                step="0.01"
              />
            </div>
            {saveMsg && (
              <p
                className="auth-error"
                style={{
                  color: saveMsg.ok ? '#10b981' : undefined,
                  marginBottom: 12,
                }}
              >
                {saveMsg.text}
              </p>
            )}
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Quick stats */}
        <div className="chart-card full-width">
          <h3>Quick Stats</h3>
          <div className="account-details">
            <div className="account-row">
              <span className="account-label">Total Expenses Logged</span>
              <span className="account-value">{expenses.length}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Categories Used</span>
              <span className="account-value">{categoriesUsed}</span>
            </div>
            <div className="account-row">
              <span className="account-label">Savings Goals</span>
              <span className="account-value">{goals.length}</span>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="chart-card full-width">
          <h3>Appearance</h3>
          <div className="account-details">
            <div className="account-row">
              <span className="account-label">Theme</span>
              <span className="account-value">
                {theme === 'dark' ? 'Dark' : 'Light'}
                <button
                  type="button"
                  className="btn-change-inline"
                  onClick={toggleTheme}
                  style={{ marginLeft: 8 }}
                >
                  Toggle
                </button>
              </span>
            </div>
          </div>
        </div>

        {/* Notifications (Junior Phase 5) */}
        <div className="chart-card full-width">
          <h3>Notifications</h3>
          <div className="account-details">
            {!pushStatus && (
              <div className="account-row">
                <span className="account-label">Push notifications</span>
                <span className="account-value">Loading…</span>
              </div>
            )}
            {pushStatus && !pushStatus.supported && (
              <div className="account-row">
                <span className="account-label">Push notifications</span>
                <span className="account-value">Not supported on this browser</span>
              </div>
            )}
            {pushStatus && pushStatus.supported && pushStatus.permission === 'denied' && (
              <div className="account-row">
                <span className="account-label">Push notifications</span>
                <span className="account-value">
                  Blocked. Re-enable in browser settings, then toggle on here.
                </span>
              </div>
            )}
            {pushStatus && pushStatus.supported && pushStatus.permission !== 'denied' && (
              <div className="account-row">
                <span className="account-label">Push notifications</span>
                <span className="account-value">
                  {pushStatus.subscribed ? 'On' : 'Off'}
                  <button
                    type="button"
                    className="btn-change-inline"
                    onClick={onTogglePush}
                    disabled={pushBusy}
                    style={{ marginLeft: 8 }}
                  >
                    {pushStatus.subscribed ? 'Turn off' : 'Turn on'}
                  </button>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Achievements */}
        <div className="chart-card full-width">
          <h3>Achievements</h3>
          <div className="achievements-grid" id="achievementsGrid">
            {ACHIEVEMENTS.map((a) => {
              const unlocked = a.check(achievementCtx);
              return (
                <div
                  key={a.id}
                  className={`achievement-card${unlocked ? ' unlocked' : ''}`}
                >
                  <div className="achievement-icon">{a.icon}</div>
                  <div className="achievement-info">
                    <span className="achievement-title">{a.title}</span>
                    <span className="achievement-desc">{a.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SMS Expense Tracking — Coming Soon */}
        <div className="chart-card full-width sms-coming-soon">
          <h3>
            SMS Expense Tracking <span className="beta-tag">Coming Soon</span>
          </h3>
          <p style={{ color: 'inherit', opacity: 0.5, fontSize: '0.85rem', marginBottom: 12 }}>
            Add expenses via SMS or USSD when you don&apos;t have internet. Perfect for cash purchases on the go.
          </p>
          <div style={{ background: 'rgba(127,127,127,0.06)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <p style={{ fontSize: '0.8rem', color: 'inherit', opacity: 0.4, marginBottom: 8 }}>How it will work:</p>
            <p style={{ fontSize: '0.85rem', color: 'inherit', opacity: 0.7, marginBottom: 4 }}>
              SMS <strong style={{ color: '#10b981' }}>083 XXX XXXX</strong> with:
            </p>
            <p
              style={{
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                color: '#10b981',
                marginBottom: 8,
                padding: 8,
                background: 'rgba(16,185,129,0.1)',
                borderRadius: 8,
              }}
            >
              R150 groceries Shoprite
            </p>
            <p style={{ fontSize: '0.8rem', color: 'inherit', opacity: 0.4 }}>
              Or dial <strong style={{ color: '#10b981' }}>*120*BUDGET#</strong> to log expenses via USSD menu.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
            Notify Me When Available
          </button>
        </div>

        {/* Automations */}
        <div className="chart-card full-width">
          <h3>Automations</h3>
          <div className="automations-list">
            {AUTOMATIONS.map((a) => {
              const on = Boolean(automations[a.key]);
              return (
                <div key={a.key} className="automation-toggle account-row">
                  <div>
                    <span className="account-label">{a.title}</span>
                    <p style={{ margin: '4px 0 0', fontSize: '0.8rem', opacity: 0.6 }}>
                      {a.desc}
                    </p>
                  </div>
                  <label className="tithe-toggle">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!automationsLoaded}
                      onChange={() => toggleAutomation(a.key)}
                    />
                    <span className="tithe-slider"></span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="chart-card full-width">
          <h3>Actions</h3>
          <div className="account-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleChangePassword}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Change Password
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleBackup}
              title="Downloads every table you own as JSON. Restore puts back settings, expenses and savings goals; the rest is a record only."
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3" />
              </svg>
              Backup All Data
            </button>
            <button type="button" className="btn-primary" onClick={handleRestoreClick}>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m14-7l-5-5-5 5m5-5v12" />
              </svg>
              Restore from Backup
            </button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json"
              hidden
              onChange={handleRestoreFile}
            />
            <button type="button" className="btn-primary" onClick={handleLogout}>
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9" />
              </svg>
              Sign Out
            </button>
            <button type="button" className="btn-danger" onClick={handleDeleteAll}>
              Delete Expenses &amp; Savings
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={handlePurgeAccount}
              title="Delete absolutely everything tied to this account"
            >
              Purge Entire Account
            </button>
          </div>
        </div>
      </div>
    </section>

    {incomeRouting != null && (
      <IncomeRoutingModal
        accounts={linkedAccts}
        currency={currency}
        incomeAmount={incomeRouting}
        onRoute={handleIncomeRoute}
        onSkip={() => setIncomeRouting(null)}
      />
    )}
    </>
  );
}
