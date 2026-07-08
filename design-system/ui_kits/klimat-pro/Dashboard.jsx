/* Dashboard screen — KPI row, cashflow, expense split, projects, activity. */
function Dashboard({ onToast }) {
  const { KpiCard, Card, Badge, ProgressBar, IconButton, Avatar } = window.KlimatProDesignSystem_a56ef7;
  const I = window.Icons, D = window.KP_DATA, { AreaChart, Donut } = window.KPCharts;
  const rub = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {D.kpis.map((k) => {
          const Ic = I[k.icon];
          return <KpiCard key={k.id} label={k.label} value={k.value} unit={k.unit || ""}
            format={k.unit === "₽" ? rub : undefined} trend={k.trend} hint={k.hint}
            icon={Ic ? <Ic size={16} /> : null} />;
        })}
      </div>

      {/* cashflow + split */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14 }}>
        <Card padding={20}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)" }}>Денежный поток</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Приход и расход · последние 6 месяцев</div>
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11.5 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}><span style={{ width: 9, height: 9, borderRadius: 9, background: "var(--accent)" }} />Приход</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}><span style={{ width: 9, height: 2, background: "rgba(255,255,255,0.3)" }} />Расход</span>
            </div>
          </div>
          <AreaChart data={D.cashflow} height={208} />
        </Card>

        <Card padding={20}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)", marginBottom: 16 }}>Структура расходов</div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Donut data={D.expenseSplit} />
            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
              {D.expenseSplit.map((e) => (
                <div key={e.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: e.color, flexShrink: 0 }} />
                  <span style={{ color: "var(--text-muted)", flex: 1 }}>{e.label}</span>
                  <span style={{ color: "var(--text-strong)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{e.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* projects + activity */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14 }}>
        <Card padding={20}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)" }}>Проекты</div>
            <span style={{ fontSize: 12, color: "var(--accent-hover)", cursor: "pointer", fontWeight: 500 }}>Все 21 →</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {D.projects.map((p, i) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.9fr 96px 84px 24px", alignItems: "center", gap: 12, padding: "11px 6px", borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{p.client}</div>
                </div>
                <Badge color={p.color} dot size="sm">{p.stage}</Badge>
                <ProgressBar value={p.progress} color={p.color === "#d4af37" ? "var(--accent)" : p.color} showLabel />
                <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{rub(p.value)} ₽</span>
                <IconButton size="sm"><I.Dots size={16} /></IconButton>
              </div>
            ))}
          </div>
        </Card>

        <Card padding={20}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)", marginBottom: 14 }}>Активность</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {D.activity.map((a, i) => {
              const dot = { success: "var(--success)", danger: "var(--danger)", neutral: "var(--text-subtle)" }[a.tone];
              return (
                <div key={i} style={{ display: "flex", gap: 11, padding: "9px 0", borderTop: i ? "1px solid var(--border-subtle)" : "none" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 7, background: dot, marginTop: 6, flexShrink: 0, boxShadow: `0 0 8px -1px ${dot}` }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: "var(--text-body)" }}><span style={{ fontWeight: 600, color: "var(--text-strong)" }}>{a.who}</span> {a.what}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                      {a.amount ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--success)", fontVariantNumeric: "tabular-nums" }}>{a.amount}</span> : <span />}
                      <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>{a.when}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
window.Dashboard = Dashboard;
