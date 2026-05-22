import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { Category, Project, TimeEntry } from '../../types';

interface Props {
  entries: TimeEntry[];
  categories: Category[];
  projects: Project[];
}

// Compact minimal tooltip — no shadow, simple 1px border, label + value
function renderTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
      <span className="font-medium">{label ?? payload[0].name}</span>
      {': '}
      <span>{payload[0].value} min</span>
    </div>
  );
}

export function ChartsPanel({ entries, categories, projects }: Props) {
  const byCategory = aggregate(entries, (e) => e.category_id);
  const byProject = aggregate(entries, (e) => e.project_id ?? null);

  const catData = categories
    .map((c) => ({ name: c.name, minutes: Math.round((byCategory.get(c.id) ?? 0) / 60), color: c.color }))
    .filter((d) => d.minutes > 0);

  const projData = [
    ...projects.map((p) => ({ name: p.name, minutes: Math.round((byProject.get(p.id) ?? 0) / 60), color: p.color })),
    { name: '(No project)', minutes: Math.round((byProject.get(null) ?? 0) / 60), color: '#9ca3af' },
  ].filter((d) => d.minutes > 0);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left: Bar chart — Time by category */}
      <ChartCard title="Time by category">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={catData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={renderTooltip} cursor={{ fill: '#f9fafb' }} />
            <Bar dataKey="minutes" radius={[3, 3, 0, 0]}>
              {catData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Right: Donut chart — Time by project */}
      <ChartCard title="Time by project">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={projData}
              dataKey="minutes"
              nameKey="name"
              outerRadius={90}
              innerRadius={50}
              strokeWidth={2}
              stroke="#fff"
            >
              {projData.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={renderTooltip} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="mb-2 text-xs uppercase tracking-wider text-gray-500">{title}</div>
      {children}
    </div>
  );
}

function aggregate<T>(entries: TimeEntry[], keyOf: (e: TimeEntry) => T): Map<T, number> {
  const out = new Map<T, number>();
  for (const e of entries) {
    if (!e.ended_at) continue;
    const seconds = (new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 1000;
    const k = keyOf(e);
    out.set(k, (out.get(k) ?? 0) + seconds);
  }
  return out;
}
