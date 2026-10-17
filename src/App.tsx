import DiscardEditsModal from "./features/purchases/DiscardEditsModal"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import Icon from "./components/Icon"
import Login from "./features/auth/Login"
import SaleModal from "./features/sales/SaleModal"
import Sidebar from "./layout/Sidebar"
import Dashboard from "./pages/Dashboard"
import Inventory from "./pages/Inventory"
import PlaceholderPage from "./pages/PlaceholderPage"
import Purchases from "./pages/Purchases"
import Sales from "./pages/Sales"
import Reports from "./pages/Reports"
import SupplierToast from "./features/purchases/SupplierToast"
import {
  createPOSAppState,
  posReducer,
  registerSale,
  type SaleDraftRow,
} from "./data/sales"
import type { SalePaymentDraft } from "./data/payments"
import PaymentNotifications from "./features/payments/PaymentNotifications"
import { getPaymentListener } from "./features/payments/PaymentWebhookListener"
import { desktopScanner } from "./features/scanner/DesktopScanner"
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [active, setActive] = useState("Inicio")
  const [menuOpen, setMenuOpen] = useState(false)
  const [pos, dispatch] = useReducer(posReducer, undefined, createPOSAppState)
  const posRef = useRef(pos)
  posRef.current = pos
  const confirming = useRef(false)
  useEffect(() => {
    const listener = getPaymentListener()
    if (isAuthenticated) {
      listener.start()
      void desktopScanner.resume()
    }
    return () => {
      listener.stop()
      desktopScanner.stop()
    }
  }, [isAuthenticated])
  async function sell(
    draft: SaleDraftRow[],
    payment: SalePaymentDraft,
    owner: string,
    commitId: string,
  ) {
    if (confirming.current || !posRef.current.saleOpen)
      throw new Error("Ya se está procesando esta venta.")
    confirming.current = true
    try {
      const base = posRef.current
      const next = registerSale(
        base,
        draft,
        new Date().toISOString(),
        undefined,
        payment,
      )
      dispatch({ type: "sale/beginConfirm" })
      if (payment.notificacion)
        await getPaymentListener().transition(
          payment.notificacion,
          "consume",
          owner,
          commitId,
        )
      dispatch({ type: "sale/commitPrepared", base, next })
    } catch (error) {
      dispatch({ type: "sale/confirmError", error: "" })
      throw error
    } finally {
      confirming.current = false
    }
  }
  const closeSaleNotice = useCallback(
    () => dispatch({ type: "sale/clearNotice" }),
    [],
  )
  const [dirtyProducts, setDirtyProducts] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  )
  function navigate(target: string) {
    if (target === active) return
    if (dirtyProducts) setPendingNavigation(target)
    else if (target === "logout") {
      void desktopScanner.disconnect()
      setMenuOpen(false)
      setIsAuthenticated(false)
    } else setActive(target)
  }
  function openSale() {
    if (dirtyProducts) setPendingNavigation("register-sale")
    else {
      setActive("Ventas")
      setMenuOpen(false)
      dispatch({ type: "sale/open" })
    }
  }
  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />
  }
  return (
    <div className="min-h-screen bg-[#f8faf4] font-sans text-[#23342e]">
      <PaymentNotifications />
      <Sidebar
        active={active}
        setActive={navigate}
        open={menuOpen}
        setOpen={setMenuOpen}
        onLogout={() => navigate("logout")}
      />
      {menuOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label="Cerrar menú"
        />
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#dfe6dc] bg-[#f8faf4]/95 px-5 py-3 backdrop-blur-sm lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={menuOpen}
            aria-controls="app-sidebar"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d8e3d4] bg-white px-3 text-sm font-semibold text-[#06452f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#488f02]"
          >
            <Icon name="menu" />
            <span>Menú</span>
          </button>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#06452f]">MiAbarrote</p>
            <p className="truncate text-xs text-[#617367]">{active}</p>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-5 md:p-8">
          {active === "Inicio" ? (
            <Dashboard onNavigate={navigate} />
          ) : active === "Inventario" ? (
            <Inventory
              state={pos.inventario}
              transferFeedback={pos.transferFeedback}
              onTransfer={(draft) =>
                dispatch({
                  type: "inventory/transfer",
                  draft,
                  fecha: new Date().toISOString(),
                })
              }
              feedback={pos.adjustmentFeedback}
              onAdjustment={(draft) =>
                dispatch({
                  type: "inventory/adjust",
                  draft,
                  fecha: new Date().toISOString(),
                })
              }
              onMinimumChange={(productoId, almacenId, minimum) =>
                dispatch({
                  type: "inventory/setMinimum",
                  productoId,
                  almacenId,
                  minimum,
                })
              }
            />
          ) : active === "Ventas" ? (
            <Sales
              state={pos}
              saleSequence={pos.saleSequence}
              onNewSale={openSale}
            />
          ) : active === "Compras" ? (
            <Purchases
              feedback={pos.purchaseFeedback}
              state={pos.inventario}
              onSupplierCreate={(draft) =>
                dispatch({ type: "supplier/append", draft })
              }
              onSupplierEdit={(id, draft) =>
                dispatch({ type: "supplier/edit", id, draft })
              }
              onDirtyChange={setDirtyProducts}
              onEdit={(draft) => dispatch({ type: "product/edit", draft })}
              onDelete={(id) => dispatch({ type: "purchase/delete", id })}
              onProduct={(draft) => dispatch({ type: "product/append", draft })}
              onName={(catalog, nombre) =>
                dispatch({ type: "catalog/append", catalog, nombre })
              }
              onSave={(draft) => dispatch({ type: "purchase/append", draft })}
            />
          ) : active === "Reportes" ? (
            <Reports state={pos} />
          ) : (
            <PlaceholderPage page={active} />
          )}
        </main>
      </div>
      <button
        onClick={openSale}
        className="fixed bottom-5 right-5 z-20 grid size-14 place-items-center rounded-2xl bg-[#0a633f] text-white shadow-lg sm:hidden"
        aria-label="Nueva venta"
      >
        <Icon name="plus" />
      </button>
      {pendingNavigation && (
        <DiscardEditsModal
          onContinue={() => {
            setPendingNavigation(null)
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLElement>(
                  ".product-edit-table input, .product-edit-table select",
                )
                ?.focus(),
            )
          }}
          onDiscard={() => {
            const target = pendingNavigation
            setPendingNavigation(null)
            setDirtyProducts(false)
            setMenuOpen(false)
            if (target === "register-sale") {
              setActive("Ventas")
              dispatch({ type: "sale/open" })
            } else if (target === "logout") {
              void desktopScanner.disconnect()
              setIsAuthenticated(false)
            } else setActive(target)
          }}
        />
      )}
      <SupplierToast
        key={pos.saleSequence}
        message={pos.saleNotice}
        onClose={closeSaleNotice}
      />
      {pos.saleOpen && (
        <SaleModal
          inventario={pos.inventario}
          error={pos.saleError}
          onClose={() => dispatch({ type: "sale/close" })}
          onSell={sell}
        />
      )}
    </div>
  )
}
