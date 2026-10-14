import PurchaseDetails from "./PurchaseDetails"
import ProductDetails from "./ProductDetails"
import SupplierDetails from "./SupplierDetails"
import SupplierModal from "../features/purchases/SupplierModal"
import SupplierToast from "../features/purchases/SupplierToast"
import { useCallback, useState } from "react"
import Icon, { type IconName } from "../components/Icon"
import {
  formatMoney,
  type PurchaseDraft,
  type PurchaseState,
  type ProductDraft,
  type NamedCatalog,
  type ProductEditDraft,
  type ProveedorDraft,
  type PurchaseFeedback,
} from "../data/purchases"
import PurchaseModal from "../features/purchases/PurchaseModal"
import CatalogModal, {
  type CatalogModalKind,
} from "../features/purchases/CatalogModal"
const cards: {
  title: string
  icon: IconName
  tone: string
}[] = [
  { title: "Detalle compra", icon: "purchase", tone: "green" },
  { title: "Detalle producto", icon: "box", tone: "orange" },
  { title: "Detalle proveedores", icon: "user", tone: "blue" },
]
export default function Purchases({
  feedback,
  state,
  onSave,
  onProduct,
  onName,
  onDelete,
  onEdit,
  onDirtyChange,
  onSupplierCreate,
  onSupplierEdit,
}: {
  feedback: PurchaseFeedback
  state: PurchaseState
  onEdit: (draft: ProductEditDraft) => void
  onDirtyChange: (dirty: boolean) => void
  onDelete: (id: number) => void
  onSave: (draft: PurchaseDraft) => void
  onProduct: (draft: ProductDraft) => void
  onName: (catalog: NamedCatalog, nombre: string) => void
  onSupplierCreate: (draft: ProveedorDraft) => void
  onSupplierEdit: (id: number, draft: ProveedorDraft) => void
}) {
  const [modal, setModal] =
    useState<"purchase" | "supplier" | CatalogModalKind | null>(null)
  const [view, setView] =
    useState<"menu" | "purchase" | "product" | "supplier">("menu")
  const [notice, setNotice] = useState("")
  const [supplierNotice, setSupplierNotice] = useState("")
  const closeSupplierNotice = useCallback(() => setSupplierNotice(""), [])
  const closePurchaseNotice = useCallback(() => setNotice(""), [])
  if (view === "supplier")
    return (
      <SupplierDetails
        state={state}
        onSave={onSupplierEdit}
        onBack={() => {
          setView("menu")
          requestAnimationFrame(() =>
            document.getElementById("supplier-details-trigger")?.focus(),
          )
        }}
      />
    )
  if (view === "product")
    return (
      <ProductDetails
        state={state}
        onSave={onEdit}
        onDirtyChange={onDirtyChange}
        onBack={() => {
          setView("menu")
          requestAnimationFrame(() =>
            document.getElementById("product-details-trigger")?.focus(),
          )
        }}
      />
    )
  if (view === "purchase")
    return (
      <PurchaseDetails
        state={state}
        onDelete={onDelete}
        onBack={() => {
          setView("menu")
          requestAnimationFrame(() =>
            document.getElementById("purchase-details-trigger")?.focus(),
          )
        }}
      />
    )
  return (
    <div className="purchases-page">
      <div>
        <h2 className="text-2xl font-bold">Compras</h2>
        <p className="purchase-description">
          Consulta y administra las compras de tu tienda.
        </p>
      </div>
      <section className="purchase-workspace" aria-label="Gestión de compras">
        <div className="purchase-actions">
          <button
            id="register-purchase-trigger"
            type="button"
            className="purchase-button purchase-button-primary"
            onClick={() => {
              setNotice("")
              setModal("purchase")
            }}
          >
            <Icon name="plus" className="size-4 shrink-0" /> Registrar compra
          </button>
          {([
            ["product", "Nuevo producto"],
            ["category", "Nueva categoría"],
            ["supplier", "Nuevo proveedor"],
          ] as const).map(([kind, label]) => (
            <button
              key={label}
              type="button"
              className={
                "purchase-button purchase-button-secondary" +
                (kind === "product" ? " purchase-button-new-product" : "")
              }
              onClick={() => {
                setNotice("")
                setModal(kind)
              }}
            >
              <Icon name="plus" className="size-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
        <div className="purchase-cards">
          {cards.map((card) => (
            <button
              id={
                card.title === "Detalle compra"
                  ? "purchase-details-trigger"
                  : card.title === "Detalle producto"
                    ? "product-details-trigger"
                    : "supplier-details-trigger"
              }
              key={card.title}
              type="button"
              className={`purchase-card purchase-card-${card.tone}`}
              onClick={
                card.title === "Detalle compra"
                  ? () => setView("purchase")
                  : card.title === "Detalle producto"
                    ? () => setView("product")
                    : () => {
                        setSupplierNotice("")
                        setView("supplier")
                      }
              }
            >
              <span className="purchase-card-icon">
                <Icon name={card.icon} className="size-8" />
              </span>
              <span>{card.title}</span>
            </button>
          ))}
        </div>
      </section>
      {modal === "purchase" && (
        <PurchaseModal
          feedback={feedback}
          state={state}
          onClose={() => setModal(null)}
          onSave={onSave}
          onSuccess={(total) => {
            setModal(null)
            setNotice(
              `Compra registrada por ${formatMoney(total)}. ${state.compras.length} compras en esta demostración.`,
            )
          }}
        />
      )}
      <SupplierToast message={notice} onClose={closePurchaseNotice} />
      <SupplierToast message={supplierNotice} onClose={closeSupplierNotice} />
      {modal === "supplier" && (
        <SupplierModal
          onClose={() => setModal(null)}
          onSave={(draft) => {
            onSupplierCreate(draft)
            setModal(null)
            setSupplierNotice(`Proveedor agregado: ${draft.nombre}.`)
          }}
        />
      )}
      {modal && modal !== "purchase" && modal !== "supplier" && (
        <CatalogModal
          kind={modal}
          state={state}
          onClose={() => setModal(null)}
          onProduct={(draft) => {
            onProduct(draft)
            setModal(null)
            setNotice(
              `Producto agregado: ${draft.nombre.trim()}. Disponible en Compras e Inventario.`,
            )
          }}
          onName={(catalog, nombre) => {
            onName(catalog, nombre)
            setModal(null)
            setNotice(`Categoría agregada: ${nombre.trim()}.`)
          }}
        />
      )}
    </div>
  )
}
