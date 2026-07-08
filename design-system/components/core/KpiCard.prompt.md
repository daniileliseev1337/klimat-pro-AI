The dashboard's headline metric. The figure animates up on mount like an exchange ticker; `trend` adds a colored delta with arrow.

```jsx
import { Wallet } from "lucide-react";
const rub = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

<KpiCard label="Баланс" value={2480000} format={rub} unit="₽" trend={12.4} icon={<Wallet size={16} />} />
<KpiCard label="Активные проекты" value={18} trend={-3.0} hint="за месяц" />
```

Props: `label`, `value`, `format`, `unit`, `trend` (signed %), `hint`, `icon`, `animate`. Wears glass + the gold ingot edge by default.
