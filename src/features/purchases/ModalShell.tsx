import {
  useEffect,
  useId,
  useRef,
  type PointerEvent,
  type ReactNode,
} from "react"
import Icon from "../../components/Icon"

export default function ModalShell({
  title,
  description,
  onClose,
  children,
  size = "purchase",
  restoreFocusSelector,
  className = "",
}: {
  title: string
  description: string
  onClose: () => void
  children: ReactNode
  size?: "purchase" | "product" | "name" | "sale" | "receipt"
  restoreFocusSelector?: string
  className?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdropStart = useRef(false)
  const id = useId()

  useEffect(() => {
    const dialog = dialogRef.current!
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    dialog
      .querySelector<HTMLElement>("select:not(:disabled), input:not(:disabled)")
      ?.focus()
    document.body.style.overflow = "hidden"
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected && trigger !== document.body) trigger.focus()
      else if (restoreFocusSelector)
        document.querySelector<HTMLElement>(restoreFocusSelector)?.focus()
    }
  }, [])

  function isBackdrop(event: PointerEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return (
      event.target === event.currentTarget &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
  }

  return (
    <dialog
      ref={dialogRef}
      className={`purchase-dialog catalog-dialog-${size} ${className}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
          ),
        ).filter(
          (control) =>
            control.getClientRects().length > 0 && !control.closest("[inert]"),
        )
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onPointerDown={(event) => {
        backdropStart.current = isBackdrop(event)
      }}
      onPointerUp={(event) => {
        if (backdropStart.current && isBackdrop(event)) onClose()
        backdropStart.current = false
      }}
      onPointerCancel={() => {
        backdropStart.current = false
      }}
    >
      <div className="purchase-form">
        <header className="purchase-modal-header">
          <div className="min-w-0">
            <span className="purchase-eyebrow">MiAbarrote · Villa Verde</span>
            <h2 id={`${id}-title`}>{title}</h2>
            <p id={`${id}-description`} className="purchase-description">
              {description}
            </p>
          </div>
          <button
            type="button"
            className="purchase-close"
            onClick={onClose}
            aria-label={`Cerrar ${title.toLowerCase()}`}
          >
            <Icon name="close" className="size-5" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
