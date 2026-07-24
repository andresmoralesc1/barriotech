'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store/useStore'

interface Props {
  isLoading: boolean
  error: string
  setError: (msg: string) => void
  setIsLoading: (b: boolean) => void
}

/**
 * Login form — email/phone identifier + password. Submitting POSTs to
 * /api/auth/login; on success we set the user in the global store and
 * route by role (seller → /dashboard, buyer → /map).
 *
 * The identifier field stays type="text" so iOS doesn't reset the
 * cursor when we toggle inputMode between email/tel as the user types.
 * inputMode + autoComplete give the OS enough hint for the right
 * virtual keyboard.
 */
export function LoginForm({ isLoading, error, setError, setIsLoading }: Props) {
  const router = useRouter()
  const setUser = useStore((s) => s.setUser)
  const setJustLoggedOut = useStore((s) => s.setJustLoggedOut)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isIdentifierEmail = identifier.includes('@')
  const identifierInputMode = isIdentifierEmail ? 'email' : 'tel'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    if (!identifier || !password) {
      setError('Completa todos los campos')
      setIsLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })

      let data
      try {
        data = await res.json()
      } catch {
        setError('No pudimos procesar la respuesta. Intenta de nuevo.')
        setIsLoading(false)
        return
      }

      if (!res.ok) {
        setError(data.error || 'Credenciales inválidas')
        setIsLoading(false)
        return
      }

      setJustLoggedOut(false)
      setUser({
        ...data.user,
        // Sprint 7 B-AUTH-1 (2026-07-23): defense in depth — fall back to
        // top-level emailVerified for older API responses that don't yet
        // include the flag inside the user object. LoginForm already gets
        // the right field today, but the fallback makes the contract
        // explicit so future refactors don't break the EmailVerifyBanner.
        emailVerified: data.user.emailVerified ?? data.emailVerified ?? false,
      })
      if (data.user.role === 'seller') {
        router.push('/dashboard')
      } else {
        router.push('/map')
      }
    } catch {
      setError('No pudimos conectarnos. Revisa tu internet e intenta de nuevo.')
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Email o teléfono</label>
        <input
          type="text"
          inputMode={identifierInputMode}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="tu@email.com o 300 123 4567"
          disabled={isLoading}
          className="w-full px-4 py-3 min-h-[44px] border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-700">Contraseña</label>
          <Link
            href="/forgot-password"
            className="text-sm text-primary-700 hover:text-primary-800 hover:underline font-medium px-2 py-2.5 -mx-2 rounded min-h-[44px] inline-flex items-center"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={isLoading}
            autoComplete="current-password"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-red-700 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {!error && (!identifier || !password) && (
        <p className="text-xs text-gray-500">Ingresa tu email o teléfono y tu contraseña.</p>
      )}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        isLoading={isLoading}
        disabled={isLoading || !identifier || !password}
      >
        {isLoading ? 'Ingresando...' : 'Iniciar Sesión'}
      </Button>
    </form>
  )
}
