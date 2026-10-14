import Icon from "../components/Icon"

export default function PlaceholderPage({ page }: { page: string }) {
  const report = page === "Reportes"
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#1d2d28]">{page}</h2>
        <p className="mt-1 text-sm text-[#7a817d]">
          {report
            ? "Analiza el desempeño y toma decisiones con información clara."
            : `Consulta y administra las ${page.toLowerCase()} de tu tienda.`}
        </p>
      </div>
      {report ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Productos más vendidos", "Aceite vegetal", "128 unidades"],
            ["Productos menos vendidos", "Avena instantánea", "4 unidades"],
            ["Próximos a vencer", "7 productos", "En los próximos 15 días"],
          ].map(([title, value, detail], index) => (
            <div
              key={title}
              className="rounded-2xl border border-[#e8e9e4] bg-white p-6"
            >
              <div
                className={`grid size-10 place-items-center rounded-xl ${
                  index === 2
                    ? "bg-[#ffebe0] text-[#c94c08]"
                    : "bg-[#e7f3dc] text-[#347d1c]"
                }`}
              >
                <Icon name={index === 2 ? "warning" : "chart"} />
              </div>
              <p className="mt-5 text-sm text-[#77807b]">{title}</p>
              <p className="mt-2 text-xl font-bold text-[#24352f]">{value}</p>
              <p className="mt-1 text-xs text-[#929793]">{detail}</p>
              <button className="mt-5 flex items-center gap-1 text-xs font-bold text-[#347d1c]">
                Abrir reporte <Icon name="arrow" className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-[#e8e9e4] bg-white p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-[#25342f]">Movimientos recientes</h3>
            <button className="flex items-center gap-2 rounded-xl bg-[#0a633f] px-4 py-2.5 text-sm font-semibold text-white">
              <Icon name="plus" className="size-4" /> Registrar{" "}
              {page === "Ventas" ? "venta" : "compra"}
            </button>
          </div>
          <div className="mt-10 grid place-items-center py-12 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-[#edf3ef] text-[#427562]">
              <Icon
                name={page === "Ventas" ? "sale" : "purchase"}
                className="size-6"
              />
            </div>
            <p className="mt-4 font-semibold text-[#33433d]">
              Módulo listo para operar
            </p>
            <p className="mt-1 max-w-sm text-sm text-[#858c88]">
              Aquí se mostrarán los movimientos registrados y podrás filtrarlos
              por fecha, proveedor o método de pago.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
