import { useEffect, useState } from 'react';

type RateMap = Record<string, number>;

/**
 * Fetches latest exchange rates against `base` from exchangerate-api.com.
 * Matches the vanilla `fetchRates()` (app.js line 2818). Caches per-base
 * in memory for the page lifetime so flipping the source currency twice
 * doesn't re-hit the network.
 */
const cache = new Map<string, RateMap>();

export function useExchangeRates(base: string) {
  const [rates, setRates] = useState<RateMap>(() => cache.get(base) ?? {});
  const [loading, setLoading] = useState(!cache.has(base));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache.has(base)) {
      setRates(cache.get(base)!);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`https://api.exchangerate-api.com/v4/latest/${base}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const next: RateMap = j?.rates ?? {};
        cache.set(base, next);
        setRates(next);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  return { rates, loading, error };
}
