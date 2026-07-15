import type { Product } from '../../lib/types';

// Fee rates — stored here so they can be adjusted universally
// TikTok changes theirs periodically
export const FEE_RATES = {
  TRANSACTION_FEE_PERCENT: 0.029, // 2.9% for standard payment processing
  TRANSACTION_FEE_FIXED: 0.30,    // $0.30 fixed per transaction
  TIKTOK_FEE_PERCENT: 0.08,       // 8% TikTok Shop fee
  TIKTOK_FEE_FIXED: 0.30,         // $0.30 fixed TikTok fee
};

// Reusable "what would the true cost per good book be if we used this print
// + shipping price?" formula. Holds the rest of the cost stack (supplies, PA,
// QA, fees, defect rate) constant. Use it to score printer quotes against the
// product's current production_cost line.
export function calculateTrueCostForQuote(product: Product, quoteUnitCost: number, quoteShipping: number) {
  const transactionFees = product.base_price > 0
    ? (product.base_price * FEE_RATES.TRANSACTION_FEE_PERCENT) + FEE_RATES.TRANSACTION_FEE_FIXED
    : 0;
  const defectFactor = Math.max(0, product.defect_rate || 0) / 100;
  const reprintQaCost = product.qa_cost * defectFactor;
  const trueCost =
    quoteUnitCost + quoteShipping + product.shipping_supplies_cost +
    product.pa_costs + product.qa_cost + reprintQaCost + transactionFees;
  const revenuePerUnit = product.base_price + product.handling_fee_add_on;
  const netMargin = revenuePerUnit - trueCost;
  const netMarginPercent = product.base_price > 0 ? (netMargin / product.base_price) * 100 : 0;
  return { trueCost, reprintQaCost, netMargin, netMarginPercent };
}

export function calculateProductMetrics(product: Product, allProducts?: Product[]) {
  // Transaction Fees: (basePrice * 0.029) + 0.30
  const transactionFees = product.base_price > 0
    ? (product.base_price * FEE_RATES.TRANSACTION_FEE_PERCENT) + FEE_RATES.TRANSACTION_FEE_FIXED
    : 0;

  // Grouped cost subtotals — let the user compare "printer + QA" across vendors
  // and see the PA's true contribution to per-unit cost.
  const printerCost = product.production_cost + product.shipping_cost + product.shipping_supplies_cost;
  const paTotal = product.pa_costs + product.qa_cost;
  const totalCostPerUnit = printerCost + paTotal + transactionFees;
  const revenuePerUnit = product.base_price + product.handling_fee_add_on;

  // Net Margin ($): revenue - all costs (including QA)
  const netMargin = revenuePerUnit - totalCostPerUnit;

  // Net Margin %: netMargin / basePrice
  const netMarginPercent = product.base_price > 0 ? (netMargin / product.base_price) * 100 : 0;

  // Reprint-adjusted "true cost per good book":
  // Printer reprints damaged books for free, but the PA still has to QA every
  // reprint. So QA cost effectively scales by (1 + defect_rate / 100).
  // Print/shipping/PA labor on the original order don't change — she paid
  // for N books, ends up with N good + a few scratch-and-dent.
  const defectFactor = Math.max(0, product.defect_rate || 0) / 100;
  const reprintQaCost = product.qa_cost * defectFactor;
  const trueCostPerGoodBook = totalCostPerUnit + reprintQaCost;
  const trueNetMargin = revenuePerUnit - trueCostPerGoodBook;
  const trueNetMarginPercent = product.base_price > 0 ? (trueNetMargin / product.base_price) * 100 : 0;

  // TikTok Fees: (ttShopPrice * 0.08) + 0.30
  const ttFees = product.tt_shop_price > 0
    ? (product.tt_shop_price * FEE_RATES.TIKTOK_FEE_PERCENT) + FEE_RATES.TIKTOK_FEE_FIXED
    : 0;

  // TikTok Net Margin: TikTok absorbs shipping, so use free_shipping instead of shipping_cost
  const ttTotalCostPerUnit = product.production_cost + product.free_shipping
    + product.shipping_supplies_cost + paTotal + ttFees;
  const ttNetMargin = product.tt_shop_price - ttTotalCostPerUnit;

  // TikTok Net Margin %: ttNetMargin / ttShopPrice
  const ttNetMarginPercent = product.tt_shop_price > 0 ? (ttNetMargin / product.tt_shop_price) * 100 : 0;

  // Book Inventory: use the directly-managed field (updated by Shopify sync, PO arrivals, and manual adjustments)
  const bookInventory = product.book_inventory;

  // Bundle Inventory: min of component books' bookInventory
  let bundlesInventory = product.bundles_inventory;
  if ((product.category === 'Bundle' || product.category === 'Book Box') && product.books_in_bundle && allProducts) {
    bundlesInventory = calculateBundleInventory(product, allProducts);
  }

  // Average daily sales — combines book AND bundle sales.
  // Coerce every input to a number so a null column from Supabase doesn't
  // propagate as NaN and silently zero out the reorder threshold.
  const csvAvgDaily = Number(product.csv_avg_daily) || 0;
  const sixMoBook = Number(product.six_month_book_sales) || 0;
  const sixMoBundle = Number(product.six_month_bundle_sales) || 0;
  const leadTime = Number(product.lead_time) || 0;
  const avgDailySales = csvAvgDaily > 0
    ? csvAvgDaily
    : (sixMoBook + sixMoBundle) / 180;

  // Reorder Threshold: avgDailySales * leadTime
  const reorderThreshold = Math.ceil(avgDailySales * leadTime);

  // Days of Inventory Remaining
  let daysRemaining: number;
  if (product.category === 'Bundle' || product.category === 'Book Box') {
    daysRemaining = avgDailySales > 0 ? Math.round(bundlesInventory / avgDailySales) : Infinity;
  } else {
    daysRemaining = avgDailySales > 0 ? Math.round(bookInventory / avgDailySales) : Infinity;
  }

  // Inventory Status
  let status: string;
  if (product.category === 'Bundle' || product.category === 'Book Box') {
    status = 'BUNDLE';
  } else if (product.do_not_reorder) {
    status = 'TRACKING ONLY';
  } else if (bookInventory <= 0) {
    status = 'OUT OF STOCK';
  } else if (bookInventory <= reorderThreshold && reorderThreshold > 0) {
    status = 'REORDER NOW';
  } else if (daysRemaining !== Infinity && daysRemaining <= leadTime) {
    status = 'REORDER NOW';
  } else {
    status = 'Good';
  }

  // Reorder Quantity: reorderThreshold - bookInventory + (avgDailySales * leadTime)
  let reorderQty = 0;
  if (status === 'REORDER NOW' || status === 'OUT OF STOCK') {
    reorderQty = Math.round(Math.max(
      reorderThreshold - bookInventory + (avgDailySales * leadTime),
      0
    ));
  }

  // Reorder Cost: reorderQty * (productionCost + shippingCost)
  const reorderCost = reorderQty * (product.production_cost + product.shipping_cost);

  // Action Required
  let action: string;
  if (product.category === 'Bundle' || product.category === 'Book Box') {
    action = 'BUNDLE';
  } else if (status === 'OUT OF STOCK') {
    action = 'REORDER NOW';
  } else if (status === 'REORDER NOW') {
    action = 'ORDER THIS WEEK';
  } else {
    action = 'NO ACTION NEEDED';
  }

  return {
    transactionFees,
    printerCost,
    paTotal,
    totalCostPerUnit,
    revenuePerUnit,
    netMargin,
    netMarginPercent,
    reprintQaCost,
    trueCostPerGoodBook,
    trueNetMargin,
    trueNetMarginPercent,
    ttFees,
    ttTotalCostPerUnit,
    ttNetMargin,
    ttNetMarginPercent,
    bookInventory,
    bundlesInventory,
    avgDailySales,
    reorderThreshold,
    daysRemaining,
    reorderQty,
    reorderCost,
    status,
    action,
  };
}

// Bundle auto-calculation: bundlesInventory = minimum bookInventory across all component books
export function calculateBundleInventory(product: Product, allProducts: Product[]): number {
  if (!product.books_in_bundle) return product.bundles_inventory;

  const componentNames = product.books_in_bundle
    .split(',')
    .map(name => name.trim())
    .filter(Boolean);

  if (componentNames.length === 0) return product.bundles_inventory;

  const componentInventories: number[] = [];
  for (const name of componentNames) {
    const nameLower = name.toLowerCase();
    // Try exact match first, then partial
    const match = allProducts.find(p => p.name.toLowerCase() === nameLower)
      || allProducts.find(p => p.name.toLowerCase().startsWith(nameLower) || nameLower.startsWith(p.name.toLowerCase()));

    if (match && match.category !== 'Bundle' && match.category !== 'Book Box') {
      const inv = match.book_stock - (match.books_purchased + match.purchased_via_bundles);
      componentInventories.push(inv);
    }
  }

  if (componentInventories.length === 0) return product.bundles_inventory;
  return Math.min(...componentInventories);
}

// Margin color coding: green >= 50%, yellow 40-49%, red < 40%
export function marginColor(percent: number): string {
  if (percent >= 50) return 'text-green-600';
  if (percent >= 40) return 'text-yellow-600';
  return 'text-red-600';
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export const CATEGORIES = ['Paperback', 'Hardcover', 'Art Pack', 'Bundle', 'Book Box', 'Omnibus'] as const;
export const STATUSES = ['Good', 'REORDER NOW', 'OUT OF STOCK', 'BUNDLE', 'TRACKING ONLY'] as const;
