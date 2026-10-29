import { useT } from '../i18n';
import { useStore } from '../store';
import { esc } from '../i18n';

export function Toast() {
  const t = useT();
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return <div id="toast-root"><div class="toast">{esc(toast)}</div></div>;
}
