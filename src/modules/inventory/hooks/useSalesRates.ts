import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { getSalesRates, type SalesRate } from '../api/salesRates';

// Loads per-SKU average daily sales from the last N days of synced Shopify
// orders. Refreshes when new orders sync in (postgres_changes on
// shopify_orders) and on tab focus / token refresh so the numbers don't get
// stale.
export function useSalesRates(windowDays = 180) {
  const [rates, setRates] = useState<Map<string, SalesRate>>(new Map());
  const [hasLoaded, setHasLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await getSalesRates(windowDays);
      setRates(data);
      setHasLoaded(true);
    } catch (err) {
      console.error('Failed to load sales rates', err);
    }
  }, [windowDays]);

  useEffect(() => {
    reload();
    const channel = supabase
      .channel(`sales-rates-${Date.now()}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopify_orders' }, () => {
        reload();
      })
      .subscribe();
    const { data: authSub } = supabase.auth.onAuthStateChange(event => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') reload();
    });
    function onFocus() { reload(); }
    window.addEventListener('focus', onFocus);
    return () => {
      supabase.removeChannel(channel);
      authSub.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  return { rates, hasLoaded, reload };
}
