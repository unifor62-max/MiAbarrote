import DiscardEditsModal from "./features/purchases/DiscardEditsModal"
import { useCallback, useReducer, useState } from "react"
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
import { createPOSAppState, posReducer } from "./data/sales"
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [active, setActive] = useState("Inicio")
  const [menuOpen, setMenuOpen] = useState(false)
  const [pos, dispatch] = useReducer(posReducer, undefined, createPOSAppState)
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
            } else if (target === "logout") setIsAuthenticated(false)
            else setActive(target)
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
          onSell={(draft) =>
            dispatch({
              type: "sale/register",
              draft,
              fecha: new Date().toISOString(),
            })
          }
        />
      )}
    </div>
  )
}
