import { supabase } from '../../../lib/supabase';
import type { PurchaseOrder, Vendor } from '../../../lib/types';

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export interface POLineItem {
  product_id: string;
  product_name: string;
  quantity: number;
}

export interface CreatePOInput {
  invoice_number: string;
  vendor: string;
  order_date: string;
  expected_dispatch: string;
  expected_arrival: string;
  items: POLineItem[];
}

export interface ConfirmArrivalInput {
  good_quantity: number;
  add_to_inventory: number;
  scratch_dent_quantity: number;
  scratch_dent_product_id: string | null;
  save_scratch_dent_as_default: boolean;
  notes: string;
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPurchaseOrder(input: CreatePOInput): Promise<void> {
  const userId = await getUserId();

  const rows = input.items.map(item => ({
    user_id: userId,
    product_id: item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    order_date: input.order_date,
    expected_dispatch: input.expected_dispatch,
    expected_arrival: input.expected_arrival,
    po_number: input.invoice_number,
    vendor: input.vendor,
    status: 'pending',
  }));

  const { error } = await supabase.from('purchase_orders').insert(rows);
  if (error) throw error;
}

export async function confirmArrival(id: string, input: ConfirmArrivalInput): Promise<void> {
  const { data: po, error: fetchErr } = await supabase
    .from('purchase_orders')
    .select('product_id, product_name, quantity')
    .eq('id', id)
    .single();
  if (fetchErr || !po) throw new Error('Purchase order not found');

  const totalReceived = input.good_quantity + input.scratch_dent_quantity;
  const userId = await getUserId();

  // Update the PO status
  const { error: updateErr } = await supabase
    .from('purchase_orders')
    .update({
      status: 'arrived',
      actual_quantity: totalReceived,
      scratch_dent_quantity: input.scratch_dent_quantity,
      scratch_dent_product_id: input.scratch_dent_product_id,
      added_to_inventory: input.add_to_inventory,
      actual_arrival: new Date().toISOString().split('T')[0],
      notes: input.notes,
    })
    .eq('id', id);
  if (updateErr) throw updateErr;

  // Save scratch & dent product as default for the main product
  if (input.save_scratch_dent_as_default && input.scratch_dent_product_id && po.product_id) {
    await supabase
      .from('products')
      .update({
        default_scratch_dent_product_id: input.scratch_dent_product_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', po.product_id);
  }

  // Add to main product inventory (may be less than received for component orders)
  if (input.add_to_inventory > 0 && po.product_id) {
    const inventoryNote = input.add_to_inventory < input.good_quantity
      ? `PO arrival: ${input.good_quantity} received, ${input.add_to_inventory} added to inventory${input.notes ? ' — ' + input.notes : ''}`
      : `PO arrival: ${input.add_to_inventory} good units${input.notes ? ' — ' + input.notes : ''}`;
    await addToInventory(
      po.product_id,
      input.add_to_inventory,
      userId,
      inventoryNote
    );
  }

  // Add scratch & dent quantity to the S&D product inventory
  if (input.scratch_dent_quantity > 0 && input.scratch_dent_product_id) {
    await addToInventory(
      input.scratch_dent_product_id,
      input.scratch_dent_quantity,
      userId,
      `PO arrival (scratch & dent from ${po.product_name}): ${input.scratch_dent_quantity} units${input.notes ? ' — ' + input.notes : ''}`
    );
  }
}

// Edits an already-arrived PO. Computes the deltas from the previously
// stored values and applies them to inventory — so shrinking a received
// quantity subtracts from inventory, growing it adds, and changing which
// S&D product the damaged copies went into moves them correctly.
export async function editArrival(id: string, input: ConfirmArrivalInput): Promise<void> {
  const { data: po, error: fetchErr } = await supabase
    .from('purchase_orders')
    .select('product_id, product_name, actual_quantity, scratch_dent_quantity, scratch_dent_product_id, added_to_inventory')
    .eq('id', id)
    .single();
  if (fetchErr || !po) throw new Error('Purchase order not found');

  const userId = await getUserId();
  const oldAdded = po.added_to_inventory || 0;
  const oldScratch = po.scratch_dent_quantity || 0;
  const oldScratchProduct = po.scratch_dent_product_id;

  const newTotal = input.good_quantity + input.scratch_dent_quantity;

  // 1) Main-product delta
  if (po.product_id) {
    const mainDelta = input.add_to_inventory - oldAdded;
    if (mainDelta !== 0) {
      await addToInventory(
        po.product_id,
        mainDelta,
        userId,
        `PO arrival edit: ${mainDelta > 0 ? '+' : ''}${mainDelta} unit${Math.abs(mainDelta) === 1 ? '' : 's'} (was ${oldAdded}, now ${input.add_to_inventory})${input.notes ? ' — ' + input.notes : ''}`
      );
    }
  }

  // 2) Scratch & dent — if the target product changed, reverse the whole old
  //    amount from the old S&D product and add the new amount to the new one.
  //    If it stayed the same, apply the delta.
  const newScratchProduct = input.scratch_dent_quantity > 0 ? input.scratch_dent_product_id : null;
  if (oldScratchProduct && oldScratchProduct !== newScratchProduct && oldScratch !== 0) {
    await addToInventory(
      oldScratchProduct,
      -oldScratch,
      userId,
      `PO arrival edit: reversed ${oldScratch} S&D unit${oldScratch === 1 ? '' : 's'} (target changed)`
    );
  }
  if (newScratchProduct && oldScratchProduct !== newScratchProduct) {
    if (input.scratch_dent_quantity > 0) {
      await addToInventory(
        newScratchProduct,
        input.scratch_dent_quantity,
        userId,
        `PO arrival edit (scratch & dent from ${po.product_name}): +${input.scratch_dent_quantity} unit${input.scratch_dent_quantity === 1 ? '' : 's'}`
      );
    }
  } else if (oldScratchProduct === newScratchProduct && newScratchProduct) {
    const scratchDelta = input.scratch_dent_quantity - oldScratch;
    if (scratchDelta !== 0) {
      await addToInventory(
        newScratchProduct,
        scratchDelta,
        userId,
        `PO arrival edit (scratch & dent from ${po.product_name}): ${scratchDelta > 0 ? '+' : ''}${scratchDelta} unit${Math.abs(scratchDelta) === 1 ? '' : 's'}`
      );
    }
  }

  // 3) Update the PO row itself
  const { error: updateErr } = await supabase
    .from('purchase_orders')
    .update({
      actual_quantity: newTotal,
      scratch_dent_quantity: input.scratch_dent_quantity,
      scratch_dent_product_id: newScratchProduct,
      added_to_inventory: input.add_to_inventory,
      notes: input.notes,
    })
    .eq('id', id);
  if (updateErr) throw updateErr;

  // 4) Optional: save S&D product as default
  if (input.save_scratch_dent_as_default && newScratchProduct && po.product_id) {
    await supabase
      .from('products')
      .update({
        default_scratch_dent_product_id: newScratchProduct,
        updated_at: new Date().toISOString(),
      })
      .eq('id', po.product_id);
  }
}

async function addToInventory(productId: string, quantity: number, userId: string, source: string) {
  const { data: product } = await supabase
    .from('products')
    .select('book_inventory, book_stock, category, bundles_inventory')
    .eq('id', productId)
    .single();
  if (!product) return;

  const isBundle = product.category === 'Bundle' || product.category === 'Book Box';
  const currentInventory = isBundle ? (product.bundles_inventory || 0) : (product.book_inventory || 0);
  const newInventory = currentInventory + quantity;

  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (isBundle) {
    updateFields.bundles_inventory = newInventory;
  } else {
    updateFields.book_inventory = newInventory;
    updateFields.book_stock = (product.book_stock || 0) + quantity;
  }

  await supabase.from('products').update(updateFields).eq('id', productId);

  await supabase.from('inventory_orders').insert({
    user_id: userId,
    product_id: productId,
    type: quantity < 0 ? 'subtract' : 'add',
    inventory_type: isBundle ? 'bundle' : 'book',
    quantity: Math.abs(quantity),
    previous_value: currentInventory,
    new_value: newInventory,
    source: 'Purchase Order',
    notes: source,
  });
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
  if (error) throw error;
}

// Get total pending quantities per product (for showing "incoming" in product table)
export async function getPendingByProduct(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('product_id, quantity')
    .eq('status', 'pending');
  if (error) throw error;

  const pending = new Map<string, number>();
  for (const po of data || []) {
    if (po.product_id) {
      pending.set(po.product_id, (pending.get(po.product_id) || 0) + po.quantity);
    }
  }
  return pending;
}

// Get recent PO notes for a specific product (for showing in product detail)
export interface DefectStats {
  totalReceived: number;
  totalDamaged: number;
  defectRate: number;
  orderCount: number;
}

export async function getDefectStatsForProduct(productId: string): Promise<DefectStats> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('actual_quantity, scratch_dent_quantity')
    .eq('product_id', productId)
    .eq('status', 'arrived')
    .not('actual_quantity', 'is', null);
  if (error) throw error;
  const rows = data || [];
  let totalReceived = 0;
  let totalDamaged = 0;
  for (const r of rows) {
    totalReceived += r.actual_quantity || 0;
    totalDamaged += r.scratch_dent_quantity || 0;
  }
  const defectRate = totalReceived > 0 ? (totalDamaged / totalReceived) * 100 : 0;
  return { totalReceived, totalDamaged, defectRate, orderCount: rows.length };
}

export async function getNotesForProduct(productId: string): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .or(`product_id.eq.${productId},scratch_dent_product_id.eq.${productId}`)
    .not('notes', 'is', null)
    .not('notes', 'eq', '')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data || []).filter(po => po.notes && po.notes.trim().length > 0);
}

// ---- Vendors ----

export async function getVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

export async function addVendor(name: string): Promise<Vendor> {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('vendors')
    .insert({ user_id: userId, name: name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVendor(id: string): Promise<void> {
  const { error } = await supabase.from('vendors').delete().eq('id', id);
  if (error) throw error;
}
