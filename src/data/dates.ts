const bolivianDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/La_Paz",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function bolivianDay(fecha = new Date().toISOString()): string {
  const parts = bolivianDayFormatter.formatToParts(new Date(fecha))
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

/** Arithmetic on civil days: midnight UTC avoids browser timezone shifts. */
export function addCivilDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10)
}

export function civilDaysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86400000,
  )
}
