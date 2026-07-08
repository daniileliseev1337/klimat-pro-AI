Ledgers, project lists, reports. Define columns with optional `render` for rich cells (badges, money, bars).

```jsx
const rub = (n) => new Intl.NumberFormat("ru-RU").format(n);
<Table
  columns={[
    { key: "name", label: "Проект" },
    { key: "stage", label: "Стадия", render: (v, r) => <Badge color={r.color} dot size="sm">{v}</Badge> },
    { key: "value", label: "Сумма", align: "right", render: (v) => rub(v) + " ₽" },
  ]}
  rows={projects}
  onRowClick={(row) => open(row)}
/>
```

`density="compact"` tightens rows. Right-aligned columns inherit tabular numerals.
