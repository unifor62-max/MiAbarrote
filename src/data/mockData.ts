import type { IconName } from "../components/Icon"

export const navItems: { label: string; icon: IconName }[] = [
  { label: "Inicio", icon: "home" },
  { label: "Ventas", icon: "sale" },
  { label: "Compras", icon: "purchase" },
  { label: "Inventario", icon: "box" },
  { label: "Reportes", icon: "chart" },
]

export const products = [
  {
    name: "Aceite vegetal 900 ml",
    category: "Abarrotes",
    stock: 34,
    price: 38.5,
    status: "Disponible",
  },
  {
    name: "Arroz grano largo 1 kg",
    category: "Granos",
    stock: 52,
    price: 28,
    status: "Disponible",
  },
  {
    name: "Leche entera 1 L",
    category: "Lácteos",
    stock: 8,
    price: 25.5,
    status: "Stock bajo",
  },
  {
    name: "Atún en agua 140 g",
    category: "Enlatados",
    stock: 21,
    price: 22,
    status: "Disponible",
  },
  {
    name: "Yogur natural 1 L",
    category: "Lácteos",
    stock: 6,
    price: 42,
    status: "Por vencer",
  },
  {
    name: "Frijol negro 1 kg",
    category: "Granos",
    stock: 3,
    price: 35,
    status: "Stock bajo",
  },
]

export const transactions = [
  {
    id: "V-1048",
    time: "10:32",
    products: "5 productos",
    amount: "Bs 286,50",
    method: "Efectivo",
  },
  {
    id: "V-1047",
    time: "10:18",
    products: "2 productos",
    amount: "Bs 98,00",
    method: "Tarjeta",
  },
  {
    id: "V-1046",
    time: "09:54",
    products: "8 productos",
    amount: "Bs 412,80",
    method: "Efectivo",
  },
  {
    id: "V-1045",
    time: "09:31",
    products: "3 productos",
    amount: "Bs 156,00",
    method: "Transferencia",
  },
]
