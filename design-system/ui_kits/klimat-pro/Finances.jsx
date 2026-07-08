/* Finances screen — balance hero, cashflow, transactions ledger. */
function Finances({ onToast }) {
  const { Card, Badge, Button, KpiCard, Tabs } = window.KlimatProDesignSystem_a56ef7;
  const I = window.Icons, D = window.KP_DATA, { AreaChart } = window.KPCharts;
  const rub = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n));
  const [range, setRange] = React.useState("6м");

  const ledger = [
    { date: "24 июн", who: "Меридиан Девелопмент", note: "Аванс по договору №2051", amt: 1600000, in: true },
    { date: "22 июн", who: "Поставка «ВентТорг»", note: "Оборудование, Корпус B", amt: 274000, in: false },
    { date: "21 июн", who: "ООО «Стройинвест»", note: "Оплата этапа · ОВиК", amt: 620000, in: true },
    { date: "19 июн", who: "Зарплата · бригада", note: "Июнь, 1-я половина", amt: 318000, in: false },
    { date: "18 июн", who: "Логистик-Сити", note: "Финальный платёж K2", amt: 980000, in: true },
    { date: "16 июн", who: "Аренда офиса", note: "Июнь", amt: 85000, in: false },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 14 }}>
        <Card gold padding={22}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-subtle)", fontWeight: 600 }}>Свободный остаток</div>
          <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.022em", color: "var(--text-strong)", marginTop: 10, fontVariantNumeric: "tabular-nums" }}>
            {rub(842500)} <span style={{ fontSize: 24, color: "var(--text-subtle)" }}>₽</span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <Button size="sm" icon={<I.Plus size={15} />}>Внести</Button>
            <Button size="sm" variant="ghost">Перевод</Button>
          </div>
        </Card>
        <KpiCard label="Приход · июнь" value={1240000} unit="₽" format={rub} trend={31.9} icon={<I.ArrowUp size={16} />} />
        <KpiCard label="Расход · июнь" value={398000} unit="₽" format={rub} trend={-28.9} icon={<I.ArrowDown size={16} />} />
      </div>

      <Card padding={20}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)" }}>Динамика</div>
          <Tabs variant="segmented" value={range} onChange={setRange} items={["3м", "6м", "Год"]} />
        </div>
        <AreaChart data={D.cashflow} height={220} width={920} />
      </Card>

      <Card padding={20}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-strong)" }}>Операции</div>
          <span style={{ fontSize: 12, color: "var(--accent-hover)", cursor: "pointer", fontWeight: 500 }}>Выгрузить ▾</span>
        </div>
        <div>
          {ledger.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr auto", alignItems: "center", gap: 14, padding: "13px 4px", borderTop: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 12, color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }}>{t.date}</span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{t.who}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>{t.note}</div>
              </div>
              <span style={{ fontSize: 14.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: t.in ? "var(--success)" : "var(--text-body)" }}>
                {t.in ? "+ " : "− "}{rub(t.amt)} ₽
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
window.Finances = Finances;
