export default function HistoryToggle({
  active,
  onToggle,
  openLabel = 'Consultar anteriores',
  closeLabel = 'Volver a actuales',
}: {
  active: boolean;
  onToggle: () => void;
  openLabel?: string;
  closeLabel?: string;
}) {
  return <button
    type="button"
    className={active ? 'btn btn-secondary btn-sm history-toggle is-active' : 'btn btn-ghost btn-sm history-toggle'}
    aria-pressed={active}
    onClick={onToggle}
  >
    {active ? closeLabel : openLabel}
  </button>;
}
