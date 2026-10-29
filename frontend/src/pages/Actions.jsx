import { useStore } from '../store';
import { useT } from '../i18n';
import { ActionCard } from '../components/ActionCard';

const STATUSES = [
  'pending_approval', 'approved', 'executing',
  'executed', 'rejected', 'blocked', 'failed', 'unknown_result',
  'proposed', 'allow',
];

function matchesFilter(item, filter) {
  // 结果未知是 execution_state，不是 status；单独作为一个筛选项。
  if (filter === 'unknown_result') return item.execution_state === 'unknown';
  return item.status === filter;
}

export function Actions() {
  const t = useT();
  const summary = useStore((s) => s.summary);
  const actionFilter = useStore((s) => s.actionFilter);
  const setActionFilter = useStore((s) => s.setActionFilter);
  const pages = useStore((s) => s.pages);
  const setPage = useStore((s) => s.setPage);
  const pageSize = useStore((s) => s.pageSize);

  const items = (summary.actions || {}).items || [];
  const filtered = items.filter((i) => matchesFilter(i, actionFilter));
  const total = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(Math.max(pages.actions || 1, 1), total);
  const page = filtered.slice((cur - 1) * pageSize, cur * pageSize);

  return (
    <div class="stack-view">
      <div class="rules-header">
        <h3>
          {t('actions')} <span class="rule-count">{filtered.length}</span>
        </h3>
      </div>
      <div class="action-filters">
        {STATUSES.map((s) => (
          <button
            key={s}
            class={'filter-chip' + (actionFilter === s ? ' active' : '')}
            data-f={s}
            onClick={() => setActionFilter(s)}
          >
            {t('status_' + s)}
          </button>
        ))}
      </div>
      <div class="approval-list">
        {page.length > 0 ? (
          page.map((item) => <ActionCard key={item.action_id} item={item} />)
        ) : (
          <div class="empty">{t('noActions')}</div>
        )}
      </div>
      {total > 1 && (
        <div class="pager">
          <button
            class="pager-btn"
            data-key="actions"
            data-n="0"
            disabled={cur <= 1}
            onClick={() => setPage('actions', -1)}
          >
            {t('prevPage')}
          </button>
          <span class="pager-info">
            {t('pageInfo').replace('{current}', cur).replace('{total}', total)}
          </span>
          <button
            class="pager-btn"
            data-key="actions"
            data-n="1"
            disabled={cur >= total}
            onClick={() => setPage('actions', 1)}
          >
            {t('nextPage')}
          </button>
        </div>
      )}
    </div>
  );
}
