One gold action per view — `primary` is loud on purpose; everything else is `ghost`.

```jsx
import { Plus } from "lucide-react";

<Button variant="primary" icon={<Plus size={15} />}>Новый проект</Button>
<Button variant="ghost">Отмена</Button>
<Button variant="danger" size="sm">Удалить</Button>
```

Variants: `primary` (gold fill, black ink) · `secondary` (gold-tinted outline) · `ghost` (hairline) · `danger` (rose) · `subtle` (text-only). Sizes `sm | md | lg`. `loading` shows a spinner; `full` stretches to width.
