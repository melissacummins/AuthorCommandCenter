import React, { useState, useRef } from 'react';
import { Upload, Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { supabase } from '../../../lib/supabase';

const FIREBASE_CONFIG = {
  projectId: "gen-lang-client-0972859592",
  appId: "1:104294335132:web:246b3da9fdd1aa88ad2359",
  apiKey: "AIzaSyBoFO4skLJ29eQ7yJrk0JhGZL6ItUB1Azc",
  authDomain: "gen-lang-client-0972859592.firebaseapp.com",
  storageBucket: "gen-lang-client-0972859592.firebasestorage.app",
  messagingSenderId: "104294335132",
};
const FIRESTORE_DB_ID = "ai-studio-20426c88-9892-49be-be11-1ee14c9086a1";

function mapProduct(d: any) {
  return {
    name: d.name || '',
    sku: d.sku || '',
    category: d.category || 'Paperback',
    base_price: d.basePrice ?? d.base_price ?? 0,
    production_cost: d.productionCost ?? d.production_cost ?? 0,
    shipping_cost: d.shippingCost ?? d.shipping_cost ?? 0,
    shipping_supplies_cost: d.shippingSuppliesCost ?? d.shipping_supplies_cost ?? 0,
    pa_costs: d.paCosts ?? d.pa_costs ?? 0,
    qa_cost: d.qaCost ?? d.qa_cost ?? 0,
    defect_rate: d.defectRate ?? d.defect_rate ?? 0,
    handling_fee_add_on: d.handlingFeeAddOn ?? d.handling_fee_add_on ?? 0,
    tt_shop_price: d.ttShopPrice ?? d.tt_shop_price ?? 0,
    free_shipping: d.freeShipping ?? d.free_shipping ?? 0,
    book_stock: d.bookStock ?? d.book_stock ?? 0,
    books_purchased: d.booksPurchased ?? d.books_purchased ?? 0,
    bundles_purchased: d.bundlesPurchased ?? d.bundles_purchased ?? 0,
    purchased_via_bundles: d.purchasedViaBundles ?? d.purchased_via_bundles ?? 0,
    book_inventory: d.bookInventory ?? d.book_inventory ?? 0,
    bundles_inventory: d.bundlesInventory ?? d.bundles_inventory ?? 0,
    six_month_book_sales: d.sixMonthBookSales ?? d.six_month_book_sales ?? 0,
    six_month_bundle_sales: d.sixMonthBundleSales ?? d.six_month_bundle_sales ?? 0,
    lead_time: d.leadTime ?? d.lead_time ?? 0,
    books_in_bundle: d.booksInBundle ?? d.books_in_bundle ?? '',
    bundles: d.bundles ?? '',
    csv_avg_daily: d.csvAvgDaily ?? d.csv_avg_daily ?? 0,
    csv_reorder_threshold: d.csvReorderThreshold ?? d.csv_reorder_threshold ?? 0,
    do_not_reorder: d.doNotReorder ?? d.do_not_reorder ?? false,
  };
}

async function importToSupabase(products: any[], orders: any[], purchaseOrders: any[], onProgress: (msg: string) => void) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed into Supabase');

  const idMap: Record<string, string> = {};
  let insertedProducts = 0;

  for (const product of products) {
    const mapped = mapProduct(product);
    const { data, error } = await supabase
      .from('products')
      .insert({ ...mapped, user_id: user.id })
      .select('id')
      .single();

    if (error) { console.error('Product insert failed:', (product as any).name, error); continue; }
    if (product.id) idMap[product.id] = data.id;
    insertedProducts++;
    onProgress(`Imported ${insertedProducts}/${products.length} products...`);
  }

  let insertedOrders = 0;
  for (const o of orders) {
    const pid = idMap[o.productId];
    if (!pid) continue;
    await supabase.from('inventory_orders').insert({
      user_id: user.id, product_id: pid,
      type: o.type || 'add', inventory_type: o.inventoryType || 'book',
      quantity: o.quantity || 0, previous_value: o.previousValue || 0,
      new_value: o.newValue || 0, source: o.source || '', notes: o.notes || '',
    });
    insertedOrders++;
  }

  let insertedPOs = 0;
  for (const p of purchaseOrders) {
    const pid = idMap[p.productId];
    await supabase.from('purchase_orders').insert({
      user_id: user.id, product_id: pid || null,
      product_name: p.productName || '', quantity: p.quantity || 0,
      order_date: p.orderDate || null, expected_dispatch: p.expectedDispatch || null,
      expected_arrival: p.expectedArrival || null, actual_arrival: p.actualArrival || null,
      status: p.status || 'pending',
    });
    insertedPOs++;
  }

  return { products: insertedProducts, orders: insertedOrders, purchaseOrders: insertedPOs };
}

export default function MigrationTool({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState('');
  const [counts, setCounts] = useState({ products: 0, orders: 0, purchaseOrders: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function importFromFirebase() {
    setStatus('processing');
    setError(null);
    setProgress('Opening Google sign-in...');

    try {
      const firebaseApp = getApps().find(a => a.name === 'migration')
        ? getApp('migration')
        : initializeApp(FIREBASE_CONFIG, 'migration');
      const db = getFirestore(firebaseApp, FIRESTORE_DB_ID);
      const auth = getAuth(firebaseApp);
      const provider = new GoogleAuthProvider();

      await signInWithPopup(auth, provider);
      setProgress('Reading products from Firebase...');

      const productsSnap = await getDocs(collection(db, 'products'));
      const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProgress(`Found ${products.length} products. Reading orders...`);

      const ordersSnap = await getDocs(collection(db, 'orders'));
      const orders = ordersSnap.docs.map(doc => doc.data());

      const poSnap = await getDocs(collection(db, 'purchaseOrders'));
      const purchaseOrders = poSnap.docs.map(doc => doc.data());

      setProgress(`Writing ${products.length} products to Supabase...`);
      const result = await importToSupabase(products, orders, purchaseOrders, setProgress);
      setCounts(result);
      setStatus('done');
      onComplete();
    } catch (err: any) {
      console.error('Migration error:', err);
      setError(err.message || 'Migration failed');
      setStatus('error');
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus('processing');
    setError(null);
    setProgress('Reading file...');

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const products = data.products || [];
      const orders = data.orders || [];
      const purchaseOrders = data.purchaseOrders || [];

      setProgress(`Found ${products.length} products. Importing...`);
      const result = await importToSupabase(products, orders, purchaseOrders, setProgress);
      setCounts(result);
      setStatus('done');
      onComplete();
    } catch (err: any) {
      console.error('Import error:', err);
      setError(err.message || 'Import failed');
      setStatus('error');
    }
  }

  return (
    <div className="space-y-4">
      {status === 'idle' && (
        <>
          <p className="text-sm text-content-secondary">
            Import your products, orders, and purchase orders from your old InventoryPro app.
            Your old data will <strong>not</strong> be modified or deleted.
          </p>

          <button
            onClick={importFromFirebase}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-600 text-brand-fg font-medium rounded-card hover:bg-brand-700"
          >
            <Download className="w-5 h-5" />
            Connect to Firebase & Import
          </button>

          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 border-t border-edge" />
            <span className="text-xs text-content-muted">or upload a JSON export</span>
            <div className="flex-1 border-t border-edge" />
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-edge-strong rounded-card p-6 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/50 transition-colors"
          >
            <Upload className="w-8 h-8 text-content-muted mx-auto mb-2" />
            <p className="font-medium text-content-secondary text-sm">Upload JSON file</p>
            <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
          </div>
        </>
      )}

      {status === 'processing' && (
        <div className="text-center py-8">
          <Loader2 className="w-10 h-10 text-brand-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-content-secondary">{progress}</p>
        </div>
      )}

      {status === 'done' && (
        <div className="text-center py-8">
          <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-3" />
          <p className="text-xl font-semibold text-content mb-3">Import Complete!</p>
          <div className="text-sm text-content-secondary space-y-1">
            <p><strong>{counts.products}</strong> products imported</p>
            <p><strong>{counts.orders}</strong> inventory orders imported</p>
            <p><strong>{counts.purchaseOrders}</strong> purchase orders imported</p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center py-8">
          <AlertCircle className="w-14 h-14 text-red-500 mx-auto mb-3" />
          <p className="font-semibold text-content mb-2">Import Failed</p>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <button
            onClick={() => { setStatus('idle'); setError(null); }}
            className="px-4 py-2 text-sm bg-surface-sunken text-content rounded-control hover:bg-edge"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
