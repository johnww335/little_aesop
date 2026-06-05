import { supabase } from '../lib/supabase'

export const MAX_CHILDREN = 10

export async function getChildren(userId) {
  const { data, error } = await supabase
    .from('children')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  return { data, error }
}

export async function createChild(userId, { name, birthday, gender }) {
  // enforce limit
  const { data: existing, error: countErr } = await supabase
    .from('children')
    .select('id')
    .eq('user_id', userId)
  if (countErr) return { data: null, error: countErr }
  if (existing.length >= MAX_CHILDREN) {
    return { data: null, error: { message: `You can have a maximum of ${MAX_CHILDREN} child profiles.` } }
  }
  const { data, error } = await supabase
    .from('children')
    .insert([{ user_id: userId, name, birthday, gender }])
    .select()
    .single()
  return { data, error }
}

export async function deleteChild(childId, userId) {
  const { error } = await supabase
    .from('children')
    .delete()
    .eq('id', childId)
    .eq('user_id', userId)
  return { error }
}

export function calculateAge(birthday) {
  const today = new Date()
  const birth = new Date(birthday)
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--
  return age
}

export function getAvatarEmoji(gender, name) {
  const boyEmojis = ['🦁', '🐻', '🐯', '🦊', '🐸']
  const girlEmojis = ['🦋', '🐱', '🦄', '🐰', '🦉']
  const neutralEmojis = ['🐼', '🐨', '🐙', '🦕', '🐳']
  const list = gender === 'boy' ? boyEmojis : gender === 'girl' ? girlEmojis : neutralEmojis
  const idx = name.charCodeAt(0) % list.length
  return list[idx]
}
