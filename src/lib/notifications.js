// Центр уведомлений: чтение/отметка прочитанным + Realtime-подписка.
// RLS отдаёт только свои строки (select по auth.uid()), поэтому фильтр по user_id
// в запросах не обязателен; для Realtime-канала фильтруем по user_id ради трафика.

export async function fetchNotifications(client, limit = 30) {
  const { data, error } = await client
    .from('notifications')
    .select('id, type, title, body, url, read, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function getUnreadCount(client) {
  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('read', false)
  if (error) throw error
  return count || 0
}

export async function markRead(client, id) {
  const { error } = await client
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function markAllRead(client) {
  const { error } = await client
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('read', false)
  if (error) throw error
}

// Realtime: INSERT (новое уведомление) и UPDATE (read-синхронизация между устройствами).
// Возвращает cleanup-функцию (removeChannel).
export function subscribeNotifications(client, userId, { onInsert, onUpdate }) {
  const channel = client
    .channel('notifications')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => { if (onInsert) onInsert(payload.new) })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => { if (onUpdate) onUpdate(payload.new) })
    .subscribe()
  return () => { client.removeChannel(channel) }
}
