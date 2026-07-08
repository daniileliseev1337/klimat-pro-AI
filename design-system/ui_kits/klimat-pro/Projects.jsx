/* Projects screen — filterable table, sparkline trend, row menu, detail modal. */
function Projects({ onToast }) {
  const { Card, Table, Badge, ProgressBar, Sparkline, Button, Input, Tabs, IconButton, DropdownMenu, Modal, Avatar } = window.KlimatProDesignSystem_a56ef7;
  const I = window.Icons, D = window.KP_DATA;
  const rub = (n) => new Intl.NumberFormat("ru-RU").format(n);

  const enriched = D.projects.map((p) => ({ ...p, trend: [3, 4, 4, 6, 5, 7, Math.round(p.progress / 12)] }));
  const [stage, setStage] = React.useState("Все");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(null);

  const stages = ["Все", "В работе", "Проектирование", "Согласование", "Сдан", "Просрочен"];
  const shown = enriched.filter((p) =>
    (stage === "Все" || p.stage === stage) && p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 260 }}>
          <Input placeholder="Поиск проекта…" value={q} onChange={(e) => setQ(e.target.value)} icon={<I.Search size={16} />} />
        </div>
        <div style={{ flex: 1 }} />
        <Button icon={<I.Plus size={15} />} onClick={() => onToast?.("Черновик проекта создан")}>Новый проект</Button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <Tabs value={stage} onChange={setStage} items={stages.map((s) => ({ value: s, label: s, count: s === "Все" ? enriched.length : enriched.filter((p) => p.stage === s).length }))} />
      </div>

      <Card padding={16}>
        <Table
          onRowClick={(row) => setOpen(row)}
          columns={[
            { key: "name", label: "Проект", render: (v, r) => (
              <div><div style={{ fontWeight: 500, color: "var(--text-strong)" }}>{v}</div><div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{r.client}</div></div>
            ) },
            { key: "stage", label: "Стадия", render: (v, r) => <Badge color={r.color} dot size="sm">{v}</Badge> },
            { key: "trend", label: "Динамика", width: 90, render: (v, r) => <Sparkline data={v} color={r.color === "#d4af37" ? "var(--accent)" : r.color} width={78} height={26} /> },
            { key: "progress", label: "Готовность", width: 140, render: (v, r) => <ProgressBar value={v} color={r.color === "#d4af37" ? "var(--accent)" : r.color} showLabel /> },
            { key: "due", label: "Срок", align: "right", render: (v, r) => <span style={{ color: r.stage === "Просрочен" ? "var(--danger)" : "var(--text-muted)", fontSize: 13 }}>{v}</span> },
            { key: "value", label: "Сумма", align: "right", render: (v) => <span style={{ fontWeight: 600 }}>{rub(v)} ₽</span> },
            { key: "_m", label: "", width: 40, render: (_, r) => (
              <DropdownMenu trigger={<IconButton size="sm"><I.Dots size={16} /></IconButton>} items={[
                { label: "Открыть", icon: <I.Folder size={15} />, onClick: () => setOpen(r) },
                { label: "Выставить счёт", icon: <I.Wallet size={15} />, onClick: () => onToast?.("Счёт по «" + r.name + "»") },
                { divider: true },
                { label: "Архивировать", icon: <I.Trash size={15} />, danger: true, onClick: () => onToast?.("Проект архивирован") },
              ]} />
            ) },
          ]}
          rows={shown}
        />
      </Card>

      <Modal open={!!open} onClose={() => setOpen(null)} width={520} title={open ? open.name : ""}
        actions={<><Button variant="ghost" onClick={() => setOpen(null)}>Закрыть</Button><Button onClick={() => { onToast?.("Изменения сохранены"); setOpen(null); }}>Сохранить</Button></>}>
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Badge color={open.color} dot>{open.stage}</Badge>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{open.client}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[["Сумма договора", rub(open.value) + " ₽"], ["Срок сдачи", open.due], ["Готовность", open.progress + "%"], ["Дебиторка", rub(Math.round(open.value * 0.2)) + " ₽"]].map(([l, v]) => (
                <div key={l} style={{ padding: "12px 14px", background: "var(--black-800)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-subtle)", fontWeight: 600 }}>{l}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-strong)", marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{v}</div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Прогресс по этапам</div>
              <ProgressBar value={open.progress} color={open.color === "#d4af37" ? "var(--accent)" : open.color} height={8} showLabel />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
              <Avatar name={D.user.name} size="sm" /><span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Ответственный · {D.user.name}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
window.Projects = Projects;
