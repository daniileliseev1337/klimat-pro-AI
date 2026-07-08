/* Tasks screen — add a task, toggle done, filter. Interactive. */
function Tasks({ onToast }) {
  const { Card, Badge, Button, Input, Tabs } = window.KlimatProDesignSystem_a56ef7;
  const I = window.Icons, D = window.KP_DATA;
  const [tasks, setTasks] = React.useState(D.tasks);
  const [filter, setFilter] = React.useState("Все");
  const [draft, setDraft] = React.useState("");

  const pri = { "Высокий": "danger", "Средний": "warning", "Низкий": "neutral" };
  const toggle = (id) => setTasks((t) => t.map((x) => x.id === id ? { ...x, done: !x.done } : x));
  const add = () => {
    if (!draft.trim()) return;
    setTasks((t) => [{ id: Date.now(), title: draft.trim(), project: "—", priority: "Средний", done: false, due: "Сегодня" }, ...t]);
    setDraft(""); onToast?.("Задача добавлена");
  };
  const shown = tasks.filter((t) => filter === "Все" ? true : filter === "Открытые" ? !t.done : t.done);
  const openCount = tasks.filter((t) => !t.done).length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16, alignItems: "start" }}>
      <Card padding={20}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)" }}>Задачи <span style={{ color: "var(--text-subtle)", fontWeight: 400 }}>· {openCount} открыто</span></div>
          <Tabs variant="segmented" value={filter} onChange={setFilter} items={["Все", "Открытые", "Готово"]} />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Input placeholder="Новая задача…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} icon={<I.Plus size={16} />} />
          <Button onClick={add}>Добавить</Button>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {shown.map((t, i) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
              <button onClick={() => toggle(t.id)} style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: "pointer",
                border: t.done ? "none" : "1.5px solid var(--border-strong)",
                background: t.done ? "var(--accent)" : "transparent",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: "var(--text-on-gold)", transition: "all var(--dur-fast)",
              }}>{t.done && <I.Check2 size={12} strokeWidth={3} />}</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: t.done ? "var(--text-subtle)" : "var(--text-strong)", textDecoration: t.done ? "line-through" : "none", fontWeight: 500 }}>{t.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{t.project}</div>
              </div>
              <Badge tone={pri[t.priority]} size="sm">{t.priority}</Badge>
              <span style={{ fontSize: 11.5, color: "var(--text-subtle)", width: 56, textAlign: "right" }}>{t.due}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card gold padding={20}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--accent)", marginBottom: 12 }}>
          <I.Flame size={18} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)" }}>Фокус дня</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
          2 задачи с высоким приоритетом на сегодня. Закрой счёт «Меридиан» до 16:00 — аванс ждёт подтверждения.
        </div>
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 12 }}>
          {[["Закрыто сегодня", "8"], ["Просрочено", "1"], ["На неделю", "27"]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--text-muted)" }}>{l}</span>
              <span style={{ color: "var(--text-strong)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
window.Tasks = Tasks;
