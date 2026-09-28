import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_PAIRS, useSettings } from '../context/SettingsContext';
import { isNotificationCondition, NOTIFICATION_PERIODS, notificationRuleSummary } from '../lib/notificationRules';
import type { CurrencyPair, NotificationCondition, NotificationPeriod, NotificationRule, NotificationRuleStatus } from '../types';

interface NotificationSubscriptionsProps {
  notificationStatuses?: Record<string, NotificationRuleStatus>;
}

interface RuleEditor {
  pair: CurrencyPair;
  rule?: NotificationRule;
  opener: HTMLButtonElement;
}

interface FocusTarget {
  pair: CurrencyPair;
  ruleId?: string;
  opener?: HTMLButtonElement;
}

function NotificationRuleDialog({ editor, onCancel, onSave }: {
  editor: RuleEditor;
  onCancel: () => void;
  onSave: (condition: NotificationCondition) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<NotificationCondition['type']>(editor.rule?.type ?? 'low');
  const [period, setPeriod] = useState<NotificationPeriod>(editor.rule?.period ?? 'day');
  const [comparison, setComparison] = useState<NotificationCondition['comparison']>(editor.rule?.comparison ?? 'none');
  // Keep the input as text until validation; never round small exchange rates.
  const [value, setValue] = useState(editor.rule?.value == null ? '' : String(editor.rule.value));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    typeRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const candidate = { type, period: type === 'low' ? period : null, comparison, value: comparison === 'none' ? null : Number(value) };
  const condition = isNotificationCondition(candidate) ? candidate : null;
  const needsValue = comparison !== 'none';
  const pairName = t(`overview.pair.${editor.pair}`);
  const [base, quote] = pairName.split('/');

  return (
    <dialog
      ref={dialogRef}
      className="subscription-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-intro`}
      onCancel={event => { event.preventDefault(); onCancel(); }}
    >
      <form noValidate onSubmit={event => {
        event.preventDefault();
        if (condition) onSave(condition);
        else valueRef.current?.focus();
      }}>
        <h2 id={`${id}-title`}>{t(`settings.notifications.${editor.rule ? 'editTitle' : 'addTitle'}`)}</h2>
        <p className="subscription-dialog-intro" id={`${id}-intro`}>
          {pairName} · {t(`settings.notifications.${editor.rule ? 'editIntro' : 'addIntro'}`)}
        </p>
        <div className="subscription-field">
          <label htmlFor={`${id}-type`}>{t('settings.notifications.conditionType')}</label>
          <select id={`${id}-type`} ref={typeRef} value={type} onChange={event => {
            const next = event.target.value as NotificationCondition['type'];
            setType(next);
            if (next === 'price' && comparison === 'none') setComparison('below');
          }}>
            <option value="low">{t('settings.notifications.lowType')}</option>
            <option value="price">{t('settings.notifications.priceType')}</option>
          </select>
        </div>
        {type === 'low' && (
          <div className="subscription-field">
            <label htmlFor={`${id}-period`}>{t('settings.notifications.periodLabel')}</label>
            <select id={`${id}-period`} value={period} aria-describedby={`${id}-period-hint`} onChange={event => setPeriod(event.target.value as NotificationPeriod)}>
              {NOTIFICATION_PERIODS.map(item => <option key={item} value={item}>{t(`settings.notifications.periods.${item}`)}</option>)}
            </select>
            <small id={`${id}-period-hint`}>{t(`settings.notifications.periodHints.${period}`)}</small>
          </div>
        )}
        <div className="subscription-field">
          <label htmlFor={`${id}-comparison`}>{t(`settings.notifications.${type === 'low' ? 'constraintLabel' : 'directionLabel'}`)}</label>
          <select id={`${id}-comparison`} value={comparison} onChange={event => setComparison(event.target.value as NotificationCondition['comparison'])}>
            {type === 'low' && <option value="none">{t('settings.notifications.noConstraint')}</option>}
            <option value="below">{t(`settings.notifications.${type === 'low' ? 'alsoBelow' : 'belowOption'}`)}</option>
            <option value="above">{t(`settings.notifications.${type === 'low' ? 'alsoAbove' : 'aboveOption'}`)}</option>
          </select>
        </div>
        {needsValue && (
          <div className="subscription-field">
            <label htmlFor={`${id}-value`}>{t('settings.notifications.valueLabel')}</label>
            <input
              id={`${id}-value`}
              ref={valueRef}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
              value={value}
              onChange={event => setValue(event.target.value)}
              placeholder={t('settings.notifications.valuePlaceholder')}
              aria-invalid={!condition}
              aria-describedby={`${id}-unit ${id}-error`}
            />
            <small id={`${id}-unit`}>{t('settings.notifications.valueUnit', { base, quote })}</small>
            <div className="subscription-error" id={`${id}-error`} role="alert">{!condition ? t('settings.notifications.invalidValue') : ''}</div>
          </div>
        )}
        <div className="subscription-preview" role="status" aria-live="polite">
          {condition ? <>{notificationRuleSummary(condition, t)} {t('settings.notifications.independentHint')}</> : t('settings.notifications.incompleteHint')}
        </div>
        <div className="subscription-dialog-actions">
          <button className="subscription-button" type="button" onClick={onCancel}>{t('settings.notifications.cancel')}</button>
          <button className="subscription-button primary" type="submit" disabled={!condition}>{t('settings.notifications.save')}</button>
        </div>
      </form>
    </dialog>
  );
}

export default function NotificationSubscriptions({ notificationStatuses = {} }: NotificationSubscriptionsProps) {
  const { t } = useTranslation();
  const { state, dispatch } = useSettings();
  const titleId = useId();
  const [editor, setEditor] = useState<RuleEditor | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButtons = useRef(new Map<CurrencyPair, HTMLButtonElement>());
  const pairButtons = useRef(new Map<CurrencyPair, HTMLButtonElement>());
  const pendingFocus = useRef<FocusTarget | null>(null);

  // Wait for saved/deleted rows and the dialog cleanup before restoring focus.
  useEffect(() => {
    const target = pendingFocus.current;
    if (editor || !target) return;
    pendingFocus.current = null;
    const button = target.opener?.isConnected ? target.opener
      : (target.ruleId ? editButtons.current.get(target.ruleId) : undefined)
        ?? addButtons.current.get(target.pair) ?? pairButtons.current.get(target.pair);
    button?.focus();
  }, [editor, state.notificationRules, state.notificationPairs]);

  function cancelEditor() {
    if (!editor) return;
    pendingFocus.current = { pair: editor.pair, opener: editor.opener };
    setEditor(null);
  }

  function saveCondition(condition: NotificationCondition) {
    if (!editor) return;
    const rule: NotificationRule = {
      ...condition,
      id: editor.rule?.id ?? crypto.randomUUID(),
      pair: editor.pair,
      enabled: editor.rule?.enabled ?? true,
    };
    dispatch({ type: 'saveNotificationRule', rule });
    pendingFocus.current = { pair: rule.pair, ruleId: rule.id };
    setEditor(null);
  }

  const selectedPairs = ALL_PAIRS.filter(pair => state.notificationPairs.includes(pair));
  const selectedRules = state.notificationRules.filter(rule => selectedPairs.includes(rule.pair));
  const active = selectedRules.filter(rule => rule.enabled).length;
  const hint = !state.notification ? 'paused' : selectedPairs.length === 0 ? 'empty' : active === 0 ? 'noActive' : 'activeHint';

  return (
    <div className="settings-group notification-subscriptions">
      <div className="settings-group-title" id={titleId}>{t('settings.notifications.title')}</div>
      <div className="settings-group-desc">{t('settings.notifications.desc')}</div>
      <div className="subscription-storage-note">{t('settings.notifications.storageHint')}</div>
      <div className="pair-chips" role="group" aria-labelledby={titleId}>
        {ALL_PAIRS.map(pair => {
          const checked = state.notificationPairs.includes(pair);
          return (
            <button
              key={pair}
              ref={node => { if (node) pairButtons.current.set(pair, node); else pairButtons.current.delete(pair); }}
              type="button"
              className={`pair-chip${checked ? ' checked' : ''}`}
              aria-pressed={checked}
              aria-label={t(`overview.pair.${pair}`)}
              onClick={() => dispatch({ type: 'toggleNotificationPair', pair })}
            >
              <span className="pair-chip-check" aria-hidden="true">{checked ? '✓' : ''}</span>
              <span>{t(`overview.pair.${pair}`)}</span>
            </button>
          );
        })}
      </div>
      <div className="notification-status" role="status" aria-live="polite">
        {t('settings.notifications.count', { n: selectedPairs.length })}{' '}
        {t('settings.notifications.ruleCount', { total: selectedRules.length, active })}{' '}
        {t(`settings.notifications.${hint}`)}
      </div>
      <div className="subscription-cards">
        {selectedPairs.length === 0 && (
          <div className="subscription-empty">{t('settings.notifications.emptyTitle')}<br />{t('settings.notifications.emptyHint')}</div>
        )}
        {selectedPairs.map(pair => {
          const pairName = t(`overview.pair.${pair}`);
          const [base, quote] = pairName.split('/');
          const rules = selectedRules.filter(rule => rule.pair === pair);
          return (
            <article key={pair} className="subscription-card" aria-label={t('settings.notifications.cardLabel', { pair: pairName })}>
              <header className="subscription-card-header">
                <div>
                  <h3 className="subscription-card-title">{pairName}</h3>
                  <div className="subscription-unit">{pair} · {t('settings.notifications.pairUnit', { base, quote })}</div>
                </div>
                <span className="subscription-count">{t('settings.notifications.ruleCount', { total: rules.length, active: rules.filter(rule => rule.enabled).length })}</span>
              </header>
              {rules.length === 0 && <div className="subscription-empty">{t('settings.notifications.noRules')}</div>}
              {rules.map(rule => {
                const title = rule.type === 'low' ? t(`settings.notifications.periods.${rule.period}`)
                  : t('settings.notifications.priceTitle', { price: t(`settings.notifications.${rule.comparison}`, { value: rule.value }) });
                const status = notificationStatuses[rule.id];
                const paused = !rule.enabled || !state.notification;
                const statusKey = !rule.enabled ? 'rulePaused' : !state.notification ? 'allPaused' : status?.state ?? 'waiting';
                const actionLabel = (action: string) => t('settings.notifications.actionLabel', { action, pair: pairName, condition: notificationRuleSummary(rule, t) });
                return (
                  <div key={rule.id} className="subscription-rule">
                    <div className="subscription-rule-info">
                      <div className="subscription-rule-title">{title}</div>
                      <div className="subscription-rule-summary">{notificationRuleSummary(rule, t)}</div>
                      <div className={`subscription-rule-state${paused ? ' paused' : ''}`} role="status" aria-live="polite">
                        {t(`settings.notifications.states.${statusKey}`)}
                      </div>
                      {rule.type === 'low' && status?.from && status.to && (
                        <div className="subscription-rule-summary">
                          {t('settings.notifications.coverage', { from: status.from, to: status.to })}
                          {status.low !== undefined && Number.isFinite(status.low) && status.low > 0
                            ? <> · {t('settings.notifications.observedLow', { value: status.low })}</> : null}
                        </div>
                      )}
                    </div>
                    <div className="subscription-actions">
                      <button
                        type="button"
                        className="subscription-button"
                        ref={node => { if (node) editButtons.current.set(rule.id, node); else editButtons.current.delete(rule.id); }}
                        aria-label={actionLabel(t('settings.notifications.edit'))}
                        onClick={event => setEditor({ pair, rule, opener: event.currentTarget })}
                      >{t('settings.notifications.edit')}</button>
                      <button
                        type="button"
                        className="subscription-button"
                        aria-label={actionLabel(t(`settings.notifications.${rule.enabled ? 'pause' : 'enable'}`))}
                        onClick={() => dispatch({ type: 'toggleNotificationRule', id: rule.id })}
                      >{t(`settings.notifications.${rule.enabled ? 'pause' : 'enable'}`)}</button>
                      <button
                        type="button"
                        className="subscription-button danger"
                        aria-label={actionLabel(t('settings.notifications.delete'))}
                        onClick={() => {
                          pendingFocus.current = { pair };
                          dispatch({ type: 'deleteNotificationRule', id: rule.id });
                        }}
                      >{t('settings.notifications.delete')}</button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className="subscription-button subscription-add"
                ref={node => { if (node) addButtons.current.set(pair, node); else addButtons.current.delete(pair); }}
                aria-label={t('settings.notifications.addLabel', { pair: pairName })}
                onClick={event => setEditor({ pair, opener: event.currentTarget })}
              >+ {t('settings.notifications.addTitle')}</button>
            </article>
          );
        })}
      </div>
      <details className="subscription-notes">
        <summary>{t('settings.notifications.notesTitle')}</summary>
        <ul>
          {['structure', 'trigger', 'ranges', 'data', 'delivery', 'switch'].map(note => <li key={note}>{t(`settings.notifications.notes.${note}`)}</li>)}
        </ul>
      </details>
      {editor && <NotificationRuleDialog editor={editor} onCancel={cancelEditor} onSave={saveCondition} />}
    </div>
  );
}
