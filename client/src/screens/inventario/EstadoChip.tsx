export default function EstadoChip({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    cerrado: 'chip chip--ok', en_captura: 'chip chip--info', borrador: 'chip', reabierto: 'chip chip--warn',
  };
  const label: Record<string, string> = {
    cerrado: 'Cerrado', en_captura: 'En captura', borrador: 'Borrador', reabierto: 'Reabierto',
  };
  return <span className={map[estado] ?? 'chip'}>{label[estado] ?? estado}</span>;
}
