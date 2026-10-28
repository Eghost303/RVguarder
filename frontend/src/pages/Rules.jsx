import { useEffect, useState } from 'preact/hooks';
import { useApi, apiErrorMessage } from '../api';
import { useStore } from '../store';
import { useT } from '../i18n';
import { RuleCard } from '../components/RuleCard';
import { BUILTIN_RULES } from '../rules-data';

export function Rules() {
  const t = useT();
  const { api } = useApi();

  const rulesSearch = useStore((s) => s.rulesSearch);
  const setRulesSearch = useStore((s) => s.setRulesSearch);

  const dsh = useStore((s) => s.summary.host?.kind === 'dsh');
  const [nativeRules, setNativeRules] = useState(null);
  useEffect(() => {
    if (!dsh) return;
    let active = true;
    api('/api/dsh/policy').then((data) => {
      if (active) setNativeRules(data.rules.map((r) => ({ruleId: r.id, title: r.id, desc: r.source || '', at: [String(r.match?.operation || 'policy')], sv: r.effect === 'block' ? 'critical' : 'medium', dc: r.effect, grp: 'PMKB ' + data.version})));
    }).catch(() => {});
    return () => { active = false; };
  }, [dsh]);
  const rules = dsh ? (nativeRules || []) : BUILTIN_RULES;
  const q = (rulesSearch || '').trim().toLowerCase();
  const filtered = q
    ? rules.filter((r) =>
        (r.ruleId + r.title + r.desc + r.at.join(' ')).toLowerCase().includes(q)
      )
    : rules;

  return (
    <div class="stack-view">
      <div class="rules-header">
        <h3>
          {t('rulesTitle')} <span class="rule-count">{filtered.length}{t('rulesTotal')}</span>
        </h3>
        <input
          class="rules-search"
          id="rules-s"
          placeholder={t('rulesSearch')}
          value={rulesSearch || ''}
          onInput={(e) => setRulesSearch(e.target.value)}
        />
      </div>
      <div class="rules-grid">
        {filtered.map((r) => (
          <RuleCard key={r.ruleId} rule={r} />
        ))}
      </div>
    </div>
  );
}
