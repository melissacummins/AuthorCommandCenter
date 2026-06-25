import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Product } from '../../../lib/types';

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

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
      .channel('products-changes')
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
