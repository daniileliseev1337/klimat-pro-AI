import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchNotifications, getUnreadCount, markRead, markAllRead, subscribeNotifications,
} from "../lib/notifications";

// относительное время «N мин/ч/дн назад»
function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "только что";
  const m = Math.floor(s / 60); if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24); return `${d} дн назад`;
}

export default function NotificationBell({ client, userId, onNavigate, showToast }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);

  const refreshCount = useCallback(async () => {
    try { setUnread(await getUnreadCount(client)); } catch (e) { /* бейдж не критичен */ }
  }, [client]);

  const loadList = useCallback(async () => {
    try { setItems(await fetchNotifications(client)); }
    catch (e) { if (showToast) showToast("Не удалось загрузить уведомления", "error"); }
  }, [client, showToast]);

  // первичный счётчик + Realtime (INSERT/UPDATE)
  useEffect(() => {
    if (!userId) return;
    refreshCount();
    const unsub = subscribeNotifications(client, userId, {
      onInsert: (row) => {
        setItems((prev) => [row, ...prev].slice(0, 50));
        setUnread((n) => n + 1);
      },
      onUpdate: (row) => {
        setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, ...row } : it)));
        refreshCount();
      },
    });
    return unsub;
  }, [client, userId, refreshCount]);

  // открытие панели → подгрузить ленту (refetch также чинит пропуски после reconnect)
  useEffect(() => { if (open) loadList(); }, [open, loadList]);

  // клик вне → закрыть
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const onItemClick = async (it) => {
    if (!it.read) {
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, read: true } : x)));
      setUnread((n) => Math.max(0, n - 1));
      try { await markRead(client, it.id); } catch (e) { /* не блокируем навигацию */ }
    }
    setOpen(false);
    if (it.url && it.url !== "/" && onNavigate) onNavigate(it.url);
  };

  const onMarkAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try { await markAllRead(client); }
    catch (e) { if (showToast) showToast("Не удалось отметить всё", "error"); refreshCount(); }
  };

  const btnStyle = {
    position: "relative", fontSize: 12, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
    fontWeight: 500, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
    color: "#9b9ca4", display: "flex", alignItems: "center", gap: 6, transition: "all 0.18s", fontFamily: "inherit",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={btnStyle}
        title="Уведомления"
        onMouseOver={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseOut={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      >
        <Bell size={13} strokeWidth={2.2} />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, padding: "0 4px",
            borderRadius: 8, background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "absolute", right: 0, top: "calc(100% + 8px)", width: 360, maxHeight: 460,
              overflowY: "auto", zIndex: 80, background: "#101012",
              border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12,
              boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)",
              position: "sticky", top: 0, background: "#101012",
            }}>
              <span style={{ color: "#f7f8f8", fontWeight: 600, fontSize: 14 }}>Уведомления</span>
              <button
                onClick={onMarkAll}
                disabled={unread === 0}
                style={{
                  fontSize: 11, padding: "4px 8px", borderRadius: 6, fontFamily: "inherit",
                  cursor: unread === 0 ? "default" : "pointer",
                  background: "transparent", border: "1px solid rgba(212,175,55,0.30)",
                  color: unread === 0 ? "#62646b" : "#e8c860",
                }}
              >Прочитать всё</button>
            </div>

            {items.length === 0 ? (
              <div style={{ padding: "28px 14px", textAlign: "center", color: "#62646b", fontSize: 13 }}>
                Нет уведомлений
              </div>
            ) : (
              items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onItemClick(it)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "11px 14px",
                    background: it.read ? "transparent" : "rgba(212,175,55,0.06)",
                    border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    {!it.read && <span style={{
                      marginTop: 5, width: 7, height: 7, borderRadius: 4, background: "#e8c860", flexShrink: 0,
                    }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: it.read ? "#b6b8bf" : "#f7f8f8", fontSize: 13,
                        fontWeight: it.read ? 400 : 600, lineHeight: 1.35,
                      }}>{it.body}</div>
                      <div style={{ color: "#62646b", fontSize: 11, marginTop: 3 }}>{timeAgo(it.created_at)}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
