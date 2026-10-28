import { useT } from '../i18n';
import { useStore } from '../store';
import { esc } from '../i18n';
import { useApi, apiErrorMessage } from '../api';

export function SkillCard({ skill }) {
  const t = useT();
  const { upsertSkill, fetchSummary } = useApi();

  const showToast = useStore((s) => s.showToast);
  const setSummary = useStore((s) => s.setSummary);
  const enabled = !!skill.enabled;

  const handleToggle = async () => {
    const target = !enabled;
    try {
      await upsertSkill(skill.name, target);
      showToast(target ? t("✅ 已启用 skill") : t("⏸ 已停用 skill"));
      const s = await fetchSummary();
      setSummary(s);
    } catch (error) {
      showToast(apiErrorMessage(error));
    }
  };

  return (
    <article class="skill-card">
      <div class="skill-head">
        <div class="skill-name">
          <strong>{esc(skill.name)}</strong>
          <span class="skill-desc">{esc(skill.description || '')}</span>
        </div>
        <button
          class={'skill-toggle ' + (enabled ? 'on' : 'off')}
          data-skill={esc(skill.name)}
          data-enabled={enabled ? '1' : '0'}
          onClick={handleToggle}
        >
          {enabled ? t("已启用") : t("已停用")}
        </button>
      </div>
      {(skill.permissions || []).length > 0 && (
        <div class="skill-perms">
          {skill.permissions.slice(0, 8).map((p) => (
            <span class="tl-tag" key={p}>{esc(p)}</span>
          ))}
        </div>
      )}
    </article>
  );
}
