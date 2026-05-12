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

function safeExt(file: File): string {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  return ext.replace(/[^a-z0-9]/g, '') || 'png';
}

// Cover upload — one image per book, replaces any previous file for that
// book. Files live under <user_id>/<book_id>.<ext> in the public
// book-covers bucket; per-user folder access is enforced by RLS.
export async function uploadBookCover(
  userId: string,
  bookId: string,
  file: File,
): Promise<string> {
  // Clear any prior cover for this book (any extension)
  const { data: existing } = await supabase.storage
    .from('book-covers')
    .list(userId);
  if (existing && existing.length > 0) {
    const stale = existing
      .filter(f => f.name.startsWith(`${bookId}.`))
      .map(f => `${userId}/${f.name}`);
    if (stale.length > 0) {
      await supabase.storage.from('book-covers').remove(stale);
    }
  }

  const path = `${userId}/${bookId}.${safeExt(file)}`;
  const { error } = await supabase.storage
    .from('book-covers')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('book-covers').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeBookCover(userId: string, bookId: string): Promise<void> {
  const { data: existing } = await supabase.storage
    .from('book-covers')
    .list(userId);
  if (!existing) return;
  const paths = existing
    .filter(f => f.name.startsWith(`${bookId}.`))
    .map(f => `${userId}/${f.name}`);
  if (paths.length > 0) {
    await supabase.storage.from('book-covers').remove(paths);
  }
}
