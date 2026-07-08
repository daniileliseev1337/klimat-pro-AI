/* Analytics screen — revenue bars, expense donut, channel breakdown, KPIs. */
function Analytics({ onToast }) {
  const { Card, KpiCard, BarChart, Sparkline, Badge, Tabs, Table, ProgressBar } = window.KlimatProDesignSystem_a56ef7;
  const { Donut } = window.KPCharts;
  const D = window.KP_DATA;
  const rub = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n));
  const [range, setRange] = React.useState("6м");

  const revenue = D.cashflow.map((c) => ({ label: c.m, value: c.in }));
  const margin = D.cashflow.map((c) => Math.round(((c.in - c.out) / c.in) * 100));

  const channels = [
    { id: 1, name: "Прямые клиенты", share: 46, value: 4200000, color: "#d4af37" },
    { id: 2, name: "Подряд / субподряд", share: 31, value: 2840000, color: "#6ee7a8" },
    { id: 3, name: "Тендеры", share: 14, value: 1280000, color: "#93c5fd" },
    { id: 4, name: "Рекомендации", share: 9, value: 820000, color: "#f8a3a3" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <KpiCard label="Выручка · YTD" value={9140000} unit="₽" format={rub} trend={18.2} />
        <KpiCard label="Средний чек" value={1640000} unit="₽" format={rub} trend={6.4} />
        <KpiCard label="Маржа" value={34} unit="%" trend={2.1} animate={false} />
        <KpiCard label="Конверсия КП" value={42} unit="%" trend={-1.8} animate={false} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 14 }}>
        <Card padding={20}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)" }}>Выручка по месяцам</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>тыс. ₽ · приход</div>
            </div>
            <Tabs variant="segmented" value={range} onChange={setRange} items={["3м", "6м", "Год"]} />
          </div>
          <BarChart data={revenue} height={200} format={(n) => n} />
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>Маржинальность</span>
            <Sparkline data={margin} width={160} height={30} color="var(--success)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--success)" }}>{margin[margin.length - 1]}%</span>
          </div>
        </Card>

        <Card padding={20}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)", marginBottom: 16 }}>Структура расходов</div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Donut data={D.expenseSplit} />
            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
              {D.expenseSplit.map((e) => (
                <div key={e.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: e.color }} />
                  <span style={{ color: "var(--text-muted)", flex: 1 }}>{e.label}</span>
                  <span style={{ color: "var(--text-strong)", fontWeight: 600 }}>{e.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card padding={20}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)", marginBottom: 6 }}>Каналы привлечения</div>
        <Table columns={[
          { key: "name", label: "Канал", render: (v, r) => <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}><span style={{ width: 8, height: 8, borderRadius: 8, background: r.color }} />{v}</span> },
          { key: "share", label: "Доля", width: 200, render: (v, r) => <ProgressBar value={v} color={r.color === "#d4af37" ? "var(--accent)" : r.color} showLabel /> },
          { key: "value", label: "Выручка", align: "right", render: (v) => <span style={{ fontWeight: 600 }}>{rub(v)} ₽</span> },
        ]} rows={channels} />
      </Card>
    </div>
  );
}
window.Analytics = Analytics;
