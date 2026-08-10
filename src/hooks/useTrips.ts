import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMode } from '@/contexts/ModeContext';
import type { NewTrip, Trip, TripMode } from '@/types';

/**
 * CRUD hook for the `trips` Supabase table. Trips only exist in Personal
 * and Family modes — Business mode always sees an empty list and mutations
 * are rejected, mirroring how the Trips tab is hidden entirely on the
 * Expenses page for Business accounts.
 */
export function useTrips() {
  const { user } = useAuth();
  const { mode } = useMode();
  const tripsEnabled = mode !== 'business';
  const tripMode: TripMode = mode === 'family' ? 'family' : 'personal';

  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !tripsEnabled) {
      setTrips([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', user.id)
      .eq('account_mode', tripMode)
      .order('start_date', { ascending: false });
    if (err) setError(err.message);
    else setTrips((data ?? []) as Trip[]);
    setLoading(false);
  }, [user, tripsEnabled, tripMode]);

  // Cancelled-flag effect so rapid mode switches can't land results out of
  // order (same pattern as useExpenses / useSavingsGoals).
  useEffect(() => {
    if (!user || !tripsEnabled) {
      setTrips([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: err } = await supabase
        .from('trips')
        .select('*')
        .eq('user_id', user.id)
        .eq('account_mode', tripMode)
        .order('start_date', { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setTrips((data ?? []) as Trip[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tripsEnabled, tripMode]);

  const addTrip = useCallback(
    async (input: NewTrip): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      if (!tripsEnabled) return { error: 'Trips are not available in Business mode' };
      if (input.end_date < input.start_date) {
        return { error: 'End date must be on or after the start date' };
      }
      const { error: err } = await supabase.from('trips').insert({
        ...input,
        user_id: user.id,
        account_mode: tripMode,
      });
      if (err) return { error: err.message };
      await load();
      return { error: null };
    },
    [user, tripsEnabled, tripMode, load],
  );

  const deleteTrip = useCallback(
    async (id: string): Promise<{ error: string | null }> => {
      if (!user) return { error: 'Not signed in' };
      const snapshot = trips;
      setTrips((list) => list.filter((t) => t.id !== id));
      const { error: err } = await supabase
        .from('trips')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (err) {
        setTrips(snapshot);
        return { error: err.message };
      }
      return { error: null };
    },
    [user, trips],
  );

  return { trips, loading, error, refresh: load, addTrip, deleteTrip };
}
