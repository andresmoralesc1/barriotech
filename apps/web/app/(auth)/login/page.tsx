'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { LoginForm } from '@/components/auth/LoginForm'
import { RegisterForm } from '@/components/auth/RegisterForm'
import { AuthSidePanel } from '@/components/auth/AuthSidePanel'
import { useAuthForm } from '@/hooks/useAuthForm'

function AuthPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { error, setError, isLoading, setIsLoading } = useAuthForm()

  const [step, setStep] = useState<'login' | 'register'>('login')

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-gray-900/5 overflow-hidden grid grid-cols-1 lg:grid-cols-2 w-full max-w-5xl">
      {/* ── Form column ── */}
      <div className="p-8 sm:p-10">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-orange-100 rounded-2xl mb-4 overflow-hidden">
            <Image
              src="/logo.png"
              alt="BarrioTech"
              width={40}
              height={40}
              className="object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900">
            {step === 'login' ? 'Bienvenido de nuevo' : 'Crea tu cuenta'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {step === 'login'
              ? 'Ingresa para buscar vendedores cerca de ti'
              : 'Registro gratuito · Sin comisiones por venta · Publicidad opcional'}
          </p>
        </div>

        {step === 'login' ? (
          <LoginForm
            isLoading={isLoading}
            error={error}
            setError={setError}
            setIsLoading={setIsLoading}
          />
        ) : (
          <RegisterForm
            isLoading={isLoading}
            error={error}
            setError={setError}
            setIsLoading={setIsLoading}
            initialRole={(searchParams.get('role') as 'seller' | 'service' | null) ?? 'buyer'}
            redirectTo="map"
          />
        )}

        {/* Toggle */}
        <div className="mt-6 text-center">
          {step === 'login' ? (
            <p className="text-gray-600 text-sm">
              ¿No tienes cuenta?{' '}
              <button
                type="button"
                onClick={() => { setStep('register'); setError('') }}
                className="text-primary-700 font-semibold hover:underline px-2 py-1.5 -mx-2 rounded min-h-[36px] inline-flex items-center"
              >
                Regístrate gratis
              </button>
            </p>
          ) : (
            <p className="text-gray-600 text-sm">
              ¿Ya tienes cuenta?{' '}
              <button
                type="button"
                onClick={() => { setStep('login'); setError('') }}
                className="text-primary-700 font-semibold hover:underline"
              >
                Inicia sesión
              </button>
            </p>
          )}
        </div>
      </div>

      <AuthSidePanel />
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
      <Suspense fallback={
        <div className="w-full max-w-md p-8 flex items-center justify-center">
          <p className="text-gray-400">Cargando...</p>
        </div>
      }>
        <AuthPageContent />
      </Suspense>
    </div>
  )
}
