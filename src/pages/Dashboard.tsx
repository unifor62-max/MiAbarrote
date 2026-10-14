import Icon from "../components/Icon"
import MetricCard from "../components/MetricCard"
import { transactions } from "../data/mockData"

export default function Dashboard({
  onNavigate,
}: {
  onNavigate: (value: string) => void
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-[#477665]">
            Miércoles, 18 de junio
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-[#1d2d28]">
            Buenos días, Laura
          </h2>
          <p className="mt-1 text-sm text-[#7a817d]">
            Este es el resumen de tu tienda hasta ahora.
          </p>
        </div>
        <button className="flex items-center gap-2 self-start rounded-xl border border-[#dfe2dc] bg-white px-4 py-2.5 text-sm font-medium text-[#4e5955]">
          <Icon name="calendar" className="size-4" /> Hoy{" "}
          <Icon name="chevron" className="size-3.5" />
        </button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          trend="8.4%"
          label="Ventas de hoy"
          value="Bs 4.286,50"
          detail="Comparado con Bs 3.954 ayer"
          icon="sale"
          tone="bg-[#e7f3dc] text-[#347d1c]"
        />
        <MetricCard
          label="Transacciones"
          trend="8.4%"
          value="48"
          detail="Ticket promedio de Bs 89,30"
          icon="purchase"
          tone="bg-[#fff0e5] text-[#c94c08]"
        />
        <MetricCard
          label="Total en caja"
          trend="8.4%"
          value="6.000,00"
          detail="18 categorías registradas"
          icon="box"
          tone="bg-[#e5f4fa] text-[#087ba8]"
        />
        <MetricCard
          label="Ganancia"
          trend="8.4%"
          value="Bs 1.200,80"
          icon="chart"
          tone="bg-[#edf6e6] text-[#4b8b21]"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="rounded-2xl border border-[#e8e9e4] bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-[#25342f]">Ventas de la semana</h3>
              <p className="mt-1 text-xs text-[#8a918d]">
                Ingresos diarios acumulados
              </p>
            </div>
            <button className="text-xs font-semibold text-[#347d1c]">
              Ver reporte
            </button>
          </div>
          <div className="mt-8 flex h-52 items-end gap-3 border-b border-[#eceee9] px-1 sm:gap-5">
            {[52, 68, 45, 82, 63, 91, 74].map((height, index) => (
              <div
                key={index}
                className="group flex h-full flex-1 flex-col items-center justify-end gap-2"
              >
                <div
                  className="relative w-full max-w-10 rounded-t-md bg-[#b9dba5] transition hover:bg-[#58a918]"
                  style={{ height: `${height}%` }}
                >
                  {index === 5 && (
                    <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-md bg-[#06452f] px-2 py-1 text-[9px] font-semibold text-white">
                      $5.1k
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-medium text-[#8d938f]">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#e8e9e4] bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-[#25342f]">
                Alertas de inventario
              </h3>
              <p className="mt-1 text-xs text-[#8a918d]">
                Requieren tu atención
              </p>
            </div>
            <span className="rounded-full bg-[#fbebe6] px-2.5 py-1 text-xs font-bold text-[#bc5e4d]">
              7 alertas
            </span>
          </div>
          <div className="mt-5 space-y-1">
            {[
              [
                "Leche entera 1 L",
                "Quedan 8 unidades",
                "Stock bajo",
                "bg-[#fff1da] text-[#a86b23]",
              ],
              [
                "Yogur natural 1 L",
                "Vence en 3 días",
                "Por vencer",
                "bg-[#ffebe0] text-[#bd5b49]",
              ],
              [
                "Frijol negro 1 kg",
                "Quedan 3 unidades",
                "Stock bajo",
                "bg-[#fff1da] text-[#a86b23]",
              ],
            ].map(([name, detail, status, color]) => (
              <div
                key={name}
                className="flex items-center gap-3 border-b border-[#f0f1ed] py-3.5 last:border-0"
              >
                <div
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${color}`}
                >
                  <Icon name="warning" className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#34413c]">
                    {name}
                  </p>
                  <p className="mt-0.5 text-xs text-[#929793]">{detail}</p>
                </div>
                <span
                  className={`hidden rounded-full px-2 py-1 text-[10px] font-semibold sm:block ${color}`}
                >
                  {status}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => onNavigate("Inventario")}
            className="mt-3 flex w-full items-center justify-center gap-1 py-2 text-xs font-bold text-[#347d1c]"
          >
            Ver todo el inventario <Icon name="arrow" className="size-3.5" />
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-[#e8e9e4] bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[#25342f]">Ventas recientes</h3>
            <p className="mt-1 text-xs text-[#8a918d]">
              Últimas transacciones registradas
            </p>
          </div>
          <button
            onClick={() => onNavigate("Ventas")}
            className="text-xs font-semibold text-[#347d1c]"
          >
            Ver todas
          </button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-[#e9ebe6] text-[10px] uppercase tracking-wider text-[#979c99]">
                <th className="pb-3 font-semibold">Folio</th>
                <th className="pb-3 font-semibold">Hora</th>
                <th className="pb-3 font-semibold">Detalle</th>
                <th className="pb-3 font-semibold">Método</th>
                <th className="pb-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((sale) => (
                <tr
                  key={sale.id}
                  className="border-b border-[#f0f1ed] text-sm last:border-0"
                >
                  <td className="py-3.5 font-semibold text-[#2d5145]">
                    {sale.id}
                  </td>
                  <td className="py-3.5 text-[#77807b]">{sale.time}</td>
                  <td className="py-3.5 text-[#55615c]">{sale.products}</td>
                  <td className="py-3.5">
                    <span className="rounded-full bg-[#f1f3ef] px-2.5 py-1 text-xs text-[#626c67]">
                      {sale.method}
                    </span>
                  </td>
                  <td className="py-3.5 text-right font-bold text-[#273630]">
                    {sale.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
