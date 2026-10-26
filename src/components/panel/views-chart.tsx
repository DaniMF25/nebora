import type { DailyViews } from "@/server/modules/stats/service";

const W = 720;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/** Escala «redonda» para el eje: 1, 2, 5, 10, 20, 50… */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}

/**
 * Páginas vistas por día (web + cartas) en barras. Cada barra lleva su valor
 * como título (al pasar el ratón); la tabla por días está aparte.
 */
export function ViewsChart({ days }: { days: DailyViews[] }) {
  const values = days.map((d) => d.site + d.menu);
  const max = niceMax(Math.max(0, ...values));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const labelEvery = days.length <= 7 ? 1 : days.length <= 31 ? 5 : 15;

  return (
    <svg
      className="views-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Páginas vistas por día, del ${shortDate(days[0]!.date)} al ${shortDate(days.at(-1)!.date)}`}
    >
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
          <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="axis">
            {v}
          </text>
        </g>
      ))}
      {days.map((d, i) => {
        const v = values[i]!;
        const x = PAD.left + i * slot + (slot - barW) / 2;
        const top = y(v);
        const h = PAD.top + plotH - top;
        return (
          <g key={d.date}>
            <title>{`${shortDate(d.date)}: ${v} páginas vistas (web ${d.site}, cartas ${d.menu}, QR ${d.qr})`}</title>
            <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} className="hit" />
            {v > 0 && (
              <path
                className="bar"
                d={
                  h > 4
                    ? `M${x},${top + h} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + barW - 4} Q${x + barW},${top} ${x + barW},${top + 4} V${top + h} Z`
                    : `M${x},${top + h} V${top} H${x + barW} V${top + h} Z`
                }
              />
            )}
            {(i % labelEvery === 0 || i === days.length - 1) && (
              <text x={PAD.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="axis">
                {shortDate(d.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
