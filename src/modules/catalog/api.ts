import { supabase } from '../../lib/supabase';
import type { Book, BookInsert, BookUpdate } from './types';

export async function listBooks(userId: string): Promise<Book[]> {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('user_id', userId)
    .order('series', { ascending: true, nullsFirst: false })
    .order('series_position', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Book[];
}

export async function getBook(id: string): Promise<Book | null> {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Book | null;
}

export async function createBook(userId: string, input: BookInsert): Promise<Book> {
  const { data, error } = await supabase
    .from('books')
    .insert({ ...input, user_id: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data as Book;
}

export async function updateBook(id: string, patch: BookUpdate): Promise<Book> {
  const { data, error } = await supabase
    .from('books')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Book;
}

export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from('books').delete().eq('id', id);
  if (error) throw error;
}
