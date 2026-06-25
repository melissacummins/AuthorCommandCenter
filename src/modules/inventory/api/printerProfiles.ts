import { supabase } from '../../../lib/supabase';

export type PrinterStatus = 'active' | 'current' | 'rejected';

export interface PrinterProfile {
  id: string;
  user_id: string;
  printer: string;
  status: PrinterStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

export async function getPrinterProfiles(): Promise<PrinterProfile[]> {
  const { data, error } = await supabase
    .from('printer_profiles')
    .select('*')
    .order('printer');
  if (error) throw error;
  return (data || []) as PrinterProfile[];
}

export async function upsertPrinterProfile(printer: string, patch: Partial<Pick<PrinterProfile, 'status' | 'notes'>>): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('printer_profiles')
    .upsert({ user_id, printer, status: 'active', ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,printer' });
  if (error) throw error;
}

export async function deletePrinterProfile(printer: string): Promise<void> {
  const user_id = await getUserId();
  const { error } = await supabase
    .from('printer_profiles')
    .delete()
    .eq('user_id', user_id)
    .eq('printer', printer);
  if (error) throw error;
}
