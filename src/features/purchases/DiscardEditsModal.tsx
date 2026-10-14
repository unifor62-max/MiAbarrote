import ModalShell from "./ModalShell"

export default function DiscardEditsModal({
  onContinue,
  onDiscard,
}: {
  onContinue: () => void
  onDiscard: () => void
}) {
  return (
    <ModalShell
      title="Cambios sin confirmar"
      description="Tienes cambios pendientes en Detalle producto. Si sales, se descartará el borrador."
      size="name"
      onClose={onContinue}
    >
      <footer className="purchase-modal-footer catalog-modal-footer">
        <div className="purchase-footer-actions">
          <button
            type="button"
            autoFocus
            className="purchase-button purchase-button-secondary"
            onClick={onContinue}
          >
            Continuar editando
          </button>
          <button
            type="button"
            className="purchase-button purchase-button-primary"
            onClick={onDiscard}
          >
            Descartar y salir
          </button>
        </div>
      </footer>
    </ModalShell>
  )
}
