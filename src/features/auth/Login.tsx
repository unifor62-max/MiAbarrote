import { useState, type FormEvent } from "react"
import Icon from "../../components/Icon"

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("admin@miabarmote.com")
  const [password, setPassword] = useState("demo123")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError("Ingresa tu usuario y contraseña para continuar.")
      return
    }
    onLogin()
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7faf3]">
      <div className="absolute -left-24 -top-24 size-80 rounded-full bg-[#9bda67]/20 blur-2xl" />
      <div className="absolute bottom-10 left-[38%] size-40 rounded-full bg-[#ff6b0b]/10 blur-2xl" />
      <div className="grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden items-center justify-center px-12 lg:flex">
          <div className="relative z-10 max-w-xl">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#d8e8ce] bg-white/80 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-[#39721f] shadow-sm">
              <span className="size-2 rounded-full bg-[#69bb20]" />
              Tu tienda, siempre bajo control
            </div>
            <img
              src="/assets/miabarmote-logo.png"
              alt="MiAbarmote Villa Verde"
              className="mx-auto w-full max-w-md object-contain drop-shadow-[0_24px_30px_rgba(16,74,42,0.12)]"
            />
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center bg-[#063e2b] px-5 py-10 sm:px-10 lg:rounded-l-[3.5rem]">
          <div className="absolute right-0 top-0 size-72 rounded-full bg-[#64b624]/10 blur-3xl" />
          <div className="absolute bottom-0 left-0 size-64 rounded-full bg-[#1397d5]/8 blur-3xl" />
          <div className="relative z-10 w-full max-w-md">
            <img
              src="/assets/miabarmote-logo.png"
              alt="MiAbarmote Villa Verde"
              className="mx-auto mb-6 w-44 object-contain lg:hidden"
            />
            <div className="mb-9">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9bd56c]">
                <span className="size-1.5 rounded-full bg-[#78c53b]" /> Acceso
                seguro
              </span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-white">
                Bienvenido de nuevo
              </h2>
              <p className="mt-2 text-sm text-white/55">
                Ingresa tus datos para acceder al sistema.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-white/75">
                  Usuario o correo electrónico
                </span>
                <span className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/8 px-4 py-3.5 transition focus-within:border-[#83cc49] focus-within:bg-white/10">
                  <Icon name="user" className="size-5 text-[#8fca69]" />
                  <input
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value)
                      setError("")
                    }}
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                    placeholder="usuario@tienda.com"
                  />
                </span>
              </label>
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-white/75">
                  Contraseña
                </span>
                <span className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/8 px-4 py-3.5 transition focus-within:border-[#83cc49] focus-within:bg-white/10">
                  <Icon name="lock" className="size-5 text-[#8fca69]" />
                  <input
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError("")
                    }}
                    type={showPassword ? "text" : "password"}
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                    placeholder="Ingresa tu contraseña"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-white/40 transition hover:text-white"
                    aria-label={
                      showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    <Icon name="eye" className="size-5" />
                  </button>
                </span>
              </label>
              {error && (
                <p className="rounded-lg bg-[#ff6b0b]/15 px-3 py-2 text-xs font-medium text-[#ffb17c]">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#69b926] px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(105,185,38,0.24)] transition hover:bg-[#78c936]"
              >
                Iniciar sesión <Icon name="arrow" className="size-4" />
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  )
}
