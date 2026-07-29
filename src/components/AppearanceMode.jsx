import { useEffect, useMemo, useRef, useState } from "react";
import { EFFECTS, SKINS, getAllowedEffects, resetAppearance, withGlobalAppearance, withPanelOverride, withoutPanelOverride } from "../lib/appearance.js";

function Choice({ item, selected, disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={`kp-appearance-choice ${selected ? "is-selected" : ""}`}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
    >
      <strong>{item.label}</strong>
      <span>{item.description}</span>
    </button>
  );
}

export default function AppearanceMode({
  draft,
  activePanelId,
  panelLabel,
  panels = [],
  saving,
  saveError,
  onChange,
  onSave,
  onClose,
  onSelectPanel,
  onClearPanel,
}) {
  const [resetArmed, setResetArmed] = useState(false);
  const dialogRef = useRef(null);
  const target = activePanelId ? draft.panelOverrides?.[activePanelId] || draft : draft;
  const allowedEffects = useMemo(() => getAllowedEffects(target.skinId), [target.skinId]);
  const targetTitle = activePanelId ? `Панель: ${panelLabel || activePanelId}` : "Общий стиль";

  const setSkin = (skinId) => {
    const nextEffect = getAllowedEffects(skinId).some(({ id }) => id === target.effectId)
      ? target.effectId : "none";
    const nextPair = { skinId, effectId: nextEffect };
    onChange(activePanelId ? withPanelOverride(draft, activePanelId, nextPair) : withGlobalAppearance(draft, nextPair));
  };
  const setEffect = (effectId) => {
    const nextPair = { skinId: target.skinId, effectId };
    onChange(activePanelId ? withPanelOverride(draft, activePanelId, nextPair) : withGlobalAppearance(draft, nextPair));
  };
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusables = () => [...dialog.querySelectorAll('button:not([disabled]), textarea, [href], input:not([disabled]), select:not([disabled])')];
    const first = focusables()[0];
    first?.focus();
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => dialog.removeEventListener("keydown", trapFocus);
  }, []);
  const resetAll = () => {
    if (!resetArmed) { setResetArmed(true); return; }
    onChange(resetAppearance());
    setResetArmed(false);
  };

  return (
    <div ref={dialogRef} className="kp-appearance-mode" role="dialog" aria-modal="true" aria-label="Настройка интерфейса">
      <header className="kp-appearance-header">
        <div>
          <p>КЛИМАТ-ПРО · персонализация</p>
          <h1>Настройка интерфейса</h1>
        </div>
        <button type="button" className="kp-appearance-close" onClick={onClose} aria-label="Закрыть настройку">×</button>
      </header>

      <main className="kp-appearance-workspace">
        <aside className="kp-appearance-guide">
          <strong>{targetTitle}</strong>
          <p>{activePanelId
            ? "Эта панель переопределяет общий стиль. Можно вернуть наследование в один клик."
            : "Сначала выберите общую пару. В рабочей области нажмите «Настроить» на панели, чтобы сделать индивидуальное исключение."}</p>
          {activePanelId && <button type="button" className="kp-appearance-secondary" onClick={() => onClearPanel?.(activePanelId)}>Вернуть общий стиль</button>}
          <button type="button" className="kp-appearance-secondary" onClick={resetAll}>{resetArmed ? "Подтвердить сброс" : "Сбросить всё"}</button>
          <div className="kp-appearance-panel-list" aria-label="Панели для настройки">
            <span>Индивидуальные панели</span>
            {panels.map((panel) => (
              <button type="button" key={panel.id} className={activePanelId === panel.id ? "is-selected" : ""} onClick={() => onSelectPanel?.(panel.id)}>
                {draft.panelOverrides?.[panel.id] ? "● " : "○ "}{panel.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="kp-appearance-picker">
          <div className={`kp-appearance-live-preview kp-skin-${target.skinId} kp-effect-${target.effectId}`} aria-live="polite">
            <span>{targetTitle}</span>
            <strong>{SKINS.find((skin) => skin.id === target.skinId)?.label} + {EFFECTS.find((effect) => effect.id === target.effectId)?.label}</strong>
            <small>Предпросмотр применяется сразу, до сохранения.</small>
          </div>
          <div className="kp-appearance-picker-heading"><span>1</span><div><h2>Скин</h2><p>Основа поверхности и рамки.</p></div></div>
          <div className="kp-appearance-choice-grid">
            {SKINS.map((skin) => <Choice key={skin.id} item={skin} selected={target.skinId === skin.id} onClick={() => setSkin(skin.id)} />)}
          </div>

          <div className="kp-appearance-picker-heading"><span>2</span><div><h2>Эффект</h2><p>Доступны только подходящие для выбранного скина варианты.</p></div></div>
          <div className="kp-appearance-choice-grid kp-appearance-effects">
            {allowedEffects.map((effect) => <Choice key={effect.id} item={effect} selected={target.effectId === effect.id} onClick={() => setEffect(effect.id)} />)}
          </div>
        </section>
      </main>

      <footer className="kp-appearance-footer">
        {saveError && <span className="kp-appearance-error">{saveError}</span>}
        <span>Изменения видны сразу и сохраняются в аккаунте после подтверждения.</span>
        <div>
          <button type="button" className="kp-appearance-secondary" onClick={onClose}>Отмена</button>
          <button type="button" className="kp-appearance-primary" onClick={onSave} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить и закончить"}</button>
        </div>
      </footer>
    </div>
  );
}
