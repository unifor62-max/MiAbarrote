import Icon, { type IconName } from "./Icon"

export default function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
  trend,
}: {
  label: string
  value: string
  detail?: string
  icon: IconName
  tone: string
  trend?: string
}) {
  return (
    <div className="metric-card min-w-0 rounded-2xl border border-[#e8e9e4] bg-white p-5 shadow-[0_1px_2px_rgba(27,48,40,0.03)]">
      <div className="flex items-start justify-between">
        <div className={`grid size-10 place-items-center rounded-xl ${tone}`}>
          <Icon name={icon} className="size-5" />
        </div>
        {trend && (
          <span className="flex items-center gap-1 text-xs font-semibold text-[#31845e]">
            <Icon name="trend" className="size-3.5" /> {trend}
          </span>
        )}
      </div>
      <p className="mt-5 text-sm font-medium text-[#747c77]">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-[#1d2d28]">
        {value}
      </p>
      <p className="mt-2 text-xs text-[#9a9f9c]">{detail}</p>
    </div>
  )
}
