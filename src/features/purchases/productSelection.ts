/** Keep selections visible in arrival order; filters apply only to the rest. */
export function prioritizedProducts<T extends { id: number }>(
  catalog: readonly T[],
  selectedIds: readonly number[],
  matches: (product: T) => boolean,
): T[] {
  const selected = new Set(selectedIds)
  const byId = new Map(catalog.map((product) => [product.id, product]))
  return [
    ...[...selected].flatMap((id) => {
      const product = byId.get(id)
      return product ? [product] : []
    }),
    ...catalog.filter(
      (product) => !selected.has(product.id) && matches(product),
    ),
  ]
}

interface CodedProduct {
  codigo_barra: string
  paqueteId: number | null
}
interface CodedPackage {
  id: number
  codigo_barra: string | null
}
export function matchesProductCode(
  product: CodedProduct,
  packages: readonly CodedPackage[],
  query: string,
) {
  const value = query.trim().toLowerCase()
  return (
    product.codigo_barra.toLowerCase().includes(value) ||
    !!packages
      .find((pack) => pack.id === product.paqueteId)
      ?.codigo_barra?.toLowerCase()
      .includes(value)
  )
}
