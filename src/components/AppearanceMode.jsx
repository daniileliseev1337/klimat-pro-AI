import { useEffect, useMemo, useRef, useState } from "react";
import { EFFECTS, SKINS, getAllowedEffects, resetAppearance, withGlobalAppearance, withPanelOverride, withoutPanelOverride } from "../lib/appearance.js";
import AppearancePanel from "./AppearancePanel.jsx";

function Choice({ item, selected, disabled = false, onClick, previewClassName = "" }) {
  return (
    <button
      type="button"
      className={`kp-appearance-choice ${selected ? "is-selected" : ""}`}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className={`kp-appearance-choice-preview kp-appearance-surface ${previewClassName}`} aria-hidden="true">
        <i />
      </span>
      <span className="kp-appearance-choice-copy">
        <strong>{item.label}</strong>
        <small>{item.description}</small>
      </span>
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
  const panelGroups = useMemo(() => panels.reduce((groups, panel) => {
    const group = panel.group || "Панели";
    (groups[group] ||= []).push(panel);
    return groups;
  }, {}), [panels]);
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
    <div className="kp-appearance-backdrop">
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
          <div className="kp-appearance-target">
            <span>Сейчас настраивается</span>
            <strong>{targetTitle}</strong>
            <p>{activePanelId
              ? "Индивидуальный стиль только для выбранных рабочих карточек."
              : "Этот скин и эффект получают все основные карточки сайта."}</p>
          </div>
          <button type="button" aria-pressed={!activePanelId} className={`kp-appearance-global ${!activePanelId ? "is-selected" : ""}`} onClick={() => onSelectPanel?.(null)}>
            <span>◈</span><div><strong>Общий стиль</strong><small>Стандарт для всего аккаунта</small></div>
          </button>
          {activePanelId && <button type="button" className="kp-appearance-secondary" onClick={() => onClearPanel?.(activePanelId)}>Вернуть общий стиль</button>}
          <button type="button" className="kp-appearance-secondary" onClick={resetAll}>{resetArmed ? "Подтвердить сброс" : "Сбросить всё"}</button>
          <div className="kp-appearance-panel-list" aria-label="Панели для настройки">
            {Object.entries(panelGroups).map(([group, items]) => (
              <div className="kp-appearance-panel-group" key={group}>
                <span>{group}</span>
                {items.map((panel) => (
                  <button type="button" key={panel.id} aria-pressed={activePanelId === panel.id} className={activePanelId === panel.id ? "is-selected" : ""} onClick={() => onSelectPanel?.(panel.id)}>
                    <i aria-hidden="true" className={draft.panelOverrides?.[panel.id] ? "has-override" : ""} />{panel.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="kp-appearance-picker">
          <AppearancePanel panelId="appearance.preview" appearance={{ skinId: target.skinId, effectId: target.effectId, panelOverrides: {} }}>
          <div className="kp-appearance-live-preview" aria-live="polite">
            <div className="kp-appearance-preview-kicker">{targetTitle}</div>
            <div className="kp-appearance-preview-row">
              <div>
                <span>АКТИВНЫХ ПРОЕКТОВ</span>
                <strong>11</strong>
                <small>всего: 22</small>
              </div>
              <div className="kp-appearance-preview-icon">▣</div>
            </div>
            <div className="kp-appearance-preview-caption">
              {SKINS.find((skin) => skin.id === target.skinId)?.label} <b>+</b> {EFFECTS.find((effect) => effect.id === target.effectId)?.label}
            </div>
          </div>
          </AppearancePanel>
          <div className="kp-appearance-picker-heading"><span>1</span><div><h2>Скин</h2><p>Основа поверхности и рамки.</p></div></div>
          <div className="kp-appearance-choice-grid">
            {SKINS.map((skin) => <Choice key={skin.id} item={skin} selected={target.skinId === skin.id} previewClassName={`kp-skin-${skin.id}`} onClick={() => setSkin(skin.id)} />)}
          </div>

          <div className="kp-appearance-picker-heading"><span>2</span><div><h2>Эффект</h2><p>Доступны только подходящие для выбранного скина варианты.</p></div></div>
          <div className="kp-appearance-choice-grid kp-appearance-effects">
            {allowedEffects.map((effect) => <Choice key={effect.id} item={effect} selected={target.effectId === effect.id} previewClassName={`kp-skin-${target.skinId} kp-effect-${effect.id}`} onClick={() => setEffect(effect.id)} />)}
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
    </div>
  );
}
