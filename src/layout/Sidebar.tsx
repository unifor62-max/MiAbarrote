import { useEffect, useRef } from "react"
import Icon from "../components/Icon"
import { navItems } from "../data/mockData"

export default function Sidebar({
  active,
  setActive,
  open,
  setOpen,
  onLogout,
}: {
  active: string
  setActive: (value: string) => void
  open: boolean
  setOpen: (value: boolean) => void
  onLogout: () => void
}) {
  const sidebar = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const desktop = window.matchMedia("(min-width: 1024px)")
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButton.current?.focus()

    function closeOnDesktop() {
      if (desktop.matches) setOpen(false)
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
      } else if (event.key === "Tab") {
        const controls = sidebar.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        )
        const first = controls?.[0]
        const last = controls?.[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    closeOnDesktop()
    desktop.addEventListener("change", closeOnDesktop)
    document.addEventListener("keydown", handleKeydown)
    return () => {
      desktop.removeEventListener("change", closeOnDesktop)
      document.removeEventListener("keydown", handleKeydown)
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [open, setOpen])

  return (
    <aside
      ref={sidebar}
      id="app-sidebar"
      aria-label="Menú principal"
      className={`fixed inset-y-0 left-0 z-40 w-64 max-w-[calc(100vw-2rem)] flex-col bg-[#06452f] text-white transition-transform duration-300 lg:max-w-none lg:translate-x-0 ${
        open ? "flex translate-x-0" : "hidden -translate-x-full lg:flex"
      }`}
    >
      <div className="flex h-20 shrink-0 items-center justify-between border-b border-white/10 px-6">
        <div className="flex items-center gap-4">
          <div className="relative size-15 overflow-hidden rounded-full bg-white">
            <img
              src="/assets/miabarmote-logo.png"
              alt=""
              className="absolute -left-[-8px] -top-[-5px] w-[44px] max-w-none"
            />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide">MiAbarrote</p>
            <p className="text-xs text-white/55">Villa Verde</p>
          </div>
        </div>
        <button
          ref={closeButton}
          type="button"
          className="grid min-h-11 min-w-11 place-items-center text-white/60 lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Cerrar menú"
        >
          <Icon name="close" />
        </button>
      </div>
      <nav aria-label="Módulos" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-7">
        <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
          Operación
        </p>
        {navItems.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-current={active === item.label ? "page" : undefined}
            onClick={() => {
              setActive(item.label)
              setOpen(false)
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${
              active === item.label
                ? "bg-white text-[#06452f] shadow-sm"
                : "text-white/70 hover:bg-white/8 hover:text-white"
            }`}
          >
            <Icon name={item.icon} className="size-[19px]" />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-3 border-t border-white/10 px-5 py-5">
        <div className="grid size-9 place-items-center rounded-full bg-[#e7f3dc] text-xs font-bold text-[#06452f]">
          LM
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Laura Méndez</p>
          <p className="text-xs text-white/45">Administradora</p>
        </div>
        <button
          onClick={onLogout}
          className="grid size-8 place-items-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <Icon name="logout" className="size-4" />
        </button>
      </div>
    </aside>
  )
}
