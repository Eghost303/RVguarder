import { useEffect } from 'preact/hooks';
import { useStore } from '../store';
import { useT, esc } from '../i18n';
import { SkillCard } from '../components/SkillCard';
import { useApi, apiErrorMessage } from '../api';

export function Skills() {
  const t = useT();
  const { fetchSummary } = useApi();

  const summary = useStore((s) => s.summary);
  const rulesSearch = useStore((s) => s.rulesSearch);
  const setRulesSearch = useStore((s) => s.setRulesSearch);
  const setSummary = useStore((s) => s.setSummary);
  const showToast = useStore((s) => s.showToast);

  useEffect(() => {
    fetchSummary().then(setSummary).catch((error) => showToast(apiErrorMessage(error, t('error_default'))));
  }, []);

  if (summary.host?.kind === 'dsh') return <section class="card">{t("DSH 插件由宿主 profile 管理。")}</section>;

  const items = (summary.skills || {}).items || [];
  const q = (rulesSearch || '').trim().toLowerCase();
  const filtered = q
    ? items.filter((s) =>
        (s.name + ' ' + (s.description || '') + ' ' + (s.permissions || []).join(' '))
          .toLowerCase()
          .includes(q)
      )
    : items;

  return (
    <div class="stack-view">
      <div class="rules-header">
        <h3>
          {t('skillsTitle')} <span class="rule-count">{filtered.length}</span>
        </h3>
        <input
          class="rules-search"
          id="skills-s"
          placeholder={t("搜索 skill…")}
          value={rulesSearch || ''}
          onInput={(e) => setRulesSearch(e.target.value)}
        />
      </div>
      {filtered.length > 0 ? (
        <div class="skills-grid">
          {filtered.map((s) => (
            <SkillCard key={s.name} skill={s} />
          ))}
        </div>
      ) : (
        <div class="empty">{t('skillsEmpty')}</div>
      )}
    </div>
  );
}
