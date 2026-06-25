import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Product } from '../../../lib/types';

// Module-level counter — each hook instance gets a unique channel name so
// Supabase doesn't reject the second .on() call with "cannot add
// postgres_changes callbacks after subscribe()". This bit us when multiple
// components (Inventory Module top-level + Book Specs + Printer Quotes tabs)
// all mounted useProducts() against the same channel name.
let nextChannelId = 0;

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const channelIdRef = useRef<number | null>(null);
  if (channelIdRef.current === null) channelIdRef.current = nextChannelId++;

  const fetchProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name');
    if (!error && data) {
      setProducts(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();

    const channel = supabase
      .channel(`products-changes-${channelIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        fetchProducts();
      })
      .subscribe();

    // Fallback path: Shopify sync (and any other cross-module mutation) fires
    // this event so we refresh even when Realtime isn't wired up for products.
    const onUpdated = () => { fetchProducts(); };
    window.addEventListener('inventory:products-updated', onUpdated);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener('inventory:products-updated', onUpdated);
    };
  }, [fetchProducts]);

  return { products, loading, refetch: fetchProducts };
}
