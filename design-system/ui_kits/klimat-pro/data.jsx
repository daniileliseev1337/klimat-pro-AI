/* Fake but plausible domain data for the Klimat Pro kit — a Russian ОВиК /
   engineering studio's personal work center. window.KP_DATA */
window.KP_DATA = {
  user: { name: "Даниил Елисеев", role: "Главный инженер", initials: "ДЕ" },

  kpis: [
    { id: "balance", label: "Баланс месяца", value: 842500, unit: "₽", trend: 12.4, icon: "Wallet", hint: "к прошлому месяцу" },
    { id: "active", label: "Активные проекты", value: 14, trend: 7.7, icon: "Folder", hint: "из 21 всего" },
    { id: "receivable", label: "Дебиторка", value: 318000, unit: "₽", trend: -4.2, icon: "Clock", hint: "к получению" },
    { id: "tasks", label: "Задачи на неделю", value: 27, trend: 3.0, icon: "Check2", hint: "8 закрыто сегодня" },
  ],

  // monthly cashflow — приход / расход (тыс. ₽)
  cashflow: [
    { m: "Янв", in: 640, out: 410 }, { m: "Фев", in: 720, out: 455 },
    { m: "Мар", in: 690, out: 520 }, { m: "Апр", in: 880, out: 470 },
    { m: "Май", in: 940, out: 560 }, { m: "Июн", in: 1240, out: 398 },
  ],

  expenseSplit: [
    { label: "Подряд", value: 42, color: "#d4af37" },
    { label: "Материалы", value: 27, color: "#6ee7a8" },
    { label: "Зарплаты", value: 19, color: "#93c5fd" },
    { label: "Прочее", value: 12, color: "#f8a3a3" },
  ],

  projects: [
    { id: 1, name: "Корпус B · ОВиК", client: "ООО «Стройинвест»", stage: "В работе", color: "#d4af37", progress: 65, due: "12 июл", value: 1850000 },
    { id: 2, name: "ТЦ «Меридиан» · вентиляция", client: "Меридиан Девелопмент", stage: "Проектирование", color: "#93c5fd", progress: 32, due: "28 июл", value: 3200000 },
    { id: 3, name: "Складской комплекс K2", client: "Логистик-Сити", stage: "Сдан", color: "#2dd4bf", progress: 100, due: "сдан", value: 980000 },
    { id: 4, name: "Бизнес-центр «Высота»", client: "АО «Капитал»", stage: "Согласование", color: "#f3d77b", progress: 48, due: "05 авг", value: 2640000 },
    { id: 5, name: "Жилой дом, ул. Лесная 14", client: "ИП Соколов", stage: "Просрочен", color: "#f8a3a3", progress: 71, due: "19 июн", value: 720000 },
  ],

  tasks: [
    { id: 1, title: "Согласовать спецификацию по Корпусу B", project: "Корпус B · ОВиК", priority: "Высокий", done: false, due: "Сегодня" },
    { id: 2, title: "Выставить счёт «Меридиан Девелопмент»", project: "ТЦ «Меридиан»", priority: "Высокий", done: false, due: "Сегодня" },
    { id: 3, title: "Проверить расчёт воздухообмена K2", project: "Складской комплекс K2", priority: "Средний", done: true, due: "Вчера" },
    { id: 4, title: "Заказать оборудование для «Высоты»", project: "БЦ «Высота»", priority: "Средний", done: false, due: "Завтра" },
    { id: 5, title: "Закрыть акт по жилому дому", project: "ул. Лесная 14", priority: "Низкий", done: false, due: "26 июн" },
    { id: 6, title: "Подготовить КП для нового клиента", project: "—", priority: "Средний", done: false, due: "27 июн" },
  ],

  activity: [
    { who: "Анна Кузнецова", what: "оплатила счёт №2041", amount: "+ 420 000 ₽", when: "14 мин", tone: "success" },
    { who: "Система", what: "дедлайн «Лесная 14» просрочен", amount: null, when: "1 ч", tone: "danger" },
    { who: "Михаил О.", what: "загрузил чертежи по Корпусу B", amount: null, when: "3 ч", tone: "neutral" },
    { who: "Меридиан", what: "подписал договор", amount: "+ 3 200 000 ₽", when: "вчера", tone: "success" },
  ],
};
