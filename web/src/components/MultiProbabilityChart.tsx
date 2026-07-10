'use client';

import { useEffect, useState, useRef } from 'react';

const COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4',
];

interface HistoryPoint {
  timestamp: string;
  probabilities: Record<string, number>;
}

interface OutcomeInfo {
  id: string;
  label: string;
}

interface Props {
  marketId: string;
  outcomes: { id: string; label: string; probability: number }[];
}

const CHART_H = 200;
const ML = 10;
const MR = 50;
const MT = 14;
const MB = 26;

export default function MultiProbabilityChart({ marketId, outcomes }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [apiOutcomes, setApiOutcomes] = useState<OutcomeInfo[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) setWidth(containerRef.current.offsetWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch(`/api/markets/${marketId}/probability-history`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setApiOutcomes(d.data.outcomes);
          setHistory(d.data.history);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [marketId]);

  // Placeholder while measuring container
  if (!width) {
    return <div ref={containerRef} style={{ height: CHART_H }} />;
  }

  const CW = width - ML - MR;
  const CH = CHART_H - MT - MB;

  // Fall back to a flat 24h line if no history yet
  const chartHistory: HistoryPoint[] =
    history.length >= 1
      ? history
      : [
          {
            timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            probabilities: Object.fromEntries(outcomes.map(o => [o.id, o.probability])),
          },
          {
            timestamp: new Date().toISOString(),
            probabilities: Object.fromEntries(outcomes.map(o => [o.id, o.probability])),
          },
        ];

  const chartOutcomes: OutcomeInfo[] =
    apiOutcomes.length > 0 ? apiOutcomes : outcomes.map(o => ({ id: o.id, label: o.label }));

  // Y range — pad a little and snap to 5 % multiples
  const allProbs = chartHistory.flatMap(d => Object.values(d.probabilities).map(p => p * 100));
  const rawMin = Math.min(...allProbs);
  const rawMax = Math.max(...allProbs);
  const pad = Math.max(4, (rawMax - rawMin) * 0.15);
  const minP = Math.max(0, Math.floor((rawMin - pad) / 5) * 5);
  const maxP = Math.min(100, Math.ceil((rawMax + pad) / 5) * 5);
  const pRange = maxP - minP || 1;

  // Time range
  const times = chartHistory.map(d => new Date(d.timestamp).getTime());
  const minT = times[0];
  const maxT = times[times.length - 1];
  const tRange = maxT - minT || 1;

  const xS = (t: number) => ML + ((t - minT) / tRange) * CW;
  const yS = (pct: number) => MT + CH - ((pct - minP) / pRange) * CH;

  // Horizontal grid lines
  const gridStep = pRange <= 15 ? 2 : 5;
  const gridLines: number[] = [];
  for (let p = Math.ceil(minP / gridStep) * gridStep; p <= maxP; p += gridStep) {
    gridLines.push(p);
  }

  // X-axis labels
  const diffMs = maxT - minT;
  const diffDays = diffMs / 86_400_000;
  const numLabels = diffDays < 0.1 ? 2 : diffDays < 1 ? 3 : diffDays < 14 ? 4 : 5;
  const xLabels: { x: number; label: string }[] = [];
  for (let i = 0; i <= numLabels; i++) {
    const t = minT + (i / numLabels) * diffMs;
    const d = new Date(t);
    const label =
      diffDays < 1
        ? d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
    xLabels.push({ x: xS(t), label });
  }

  // Step-function SVG path: H to next x, then V to new y
  function buildPath(outcomeId: string): string {
    const pts = chartHistory
      .filter(d => outcomeId in d.probabilities)
      .map(d => ({
        x: xS(new Date(d.timestamp).getTime()),
        y: yS(d.probabilities[outcomeId] * 100),
      }));
    if (!pts.length) return '';
    let p = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      p += ` H ${pts[i].x.toFixed(1)} V ${pts[i].y.toFixed(1)}`;
    }
    p += ` H ${(ML + CW).toFixed(1)}`;
    return p;
  }

  const currentProbs = chartHistory[chartHistory.length - 1]?.probabilities ?? {};

  return (
    <div ref={containerRef} className="w-full">
      {loading && (
        <div className="flex items-center gap-1.5 text-cream/20 text-[10px] px-5 pb-1">
          <div className="w-2.5 h-2.5 border border-cream/20 border-t-cream/40 rounded-full animate-spin" />
          Cargando historial...
        </div>
      )}
      <svg width={width} height={CHART_H} style={{ display: 'block', overflow: 'visible' }}>
        {/* Grid */}
        {gridLines.map(p => (
          <g key={p}>
            <line
              x1={ML}
              y1={yS(p).toFixed(1)}
              x2={ML + CW}
              y2={yS(p).toFixed(1)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
              strokeDasharray="3 5"
            />
            <text
              x={ML + CW + 7}
              y={yS(p)}
              dominantBaseline="middle"
              fill="rgba(255,255,255,0.28)"
              fontSize="11"
            >
              {p}%
            </text>
          </g>
        ))}

        {/* Lines — reversed so lower-index outcomes render on top */}
        {[...chartOutcomes].reverse().map((o, ri) => {
          const i = chartOutcomes.length - 1 - ri;
          const color = COLORS[i % COLORS.length];
          const path = buildPath(o.id);
          if (!path) return null;
          const curPct =
            (currentProbs[o.id] ?? outcomes.find(x => x.id === o.id)?.probability ?? 0) * 100;
          const endY = yS(curPct);

          return (
            <g key={o.id}>
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                opacity="0.9"
              />
              <circle
                cx={ML + CW}
                cy={endY.toFixed(1)}
                r="3.5"
                fill={color}
                stroke="#141418"
                strokeWidth="1.5"
              />
            </g>
          );
        })}

        {/* X-axis baseline */}
        <line
          x1={ML}
          y1={MT + CH}
          x2={ML + CW}
          y2={MT + CH}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
        />

        {/* X-axis labels */}
        {xLabels.map((lbl, i) => (
          <text
            key={i}
            x={Math.min(Math.max(lbl.x, ML), ML + CW)}
            y={CHART_H - 6}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            fill="rgba(255,255,255,0.2)"
            fontSize="10"
          >
            {lbl.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
