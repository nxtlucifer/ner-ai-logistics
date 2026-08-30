import { useState, type FormEvent } from 'react'

import { ApiError, NetworkError } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Button, Field } from '../components/ui'

export default function LoginPage() {
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSubmitting) return // double-submit guard
    setIsSubmitting(true)
    setError(null)
    try {
      await login(identifier.trim(), password)
    } catch (err) {
      // The backend deliberately returns one message for unknown-user and
      // wrong-password, so this cannot be made more specific - and must not be.
      if (err instanceof NetworkError) {
        setError('Cannot reach the backend. Is it running on port 8000?')
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Sign in failed. Please try again.')
      }
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-slate-100">NER Fleet Intelligence</h1>
        <p className="mt-1 text-xs uppercase tracking-wide text-amber-400">
          Manager sign in
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        >
          <Field
            label="Email or phone"
            name="identifier"
            value={identifier}
            onChange={setIdentifier}
            required
            autoComplete="username"
            placeholder="manager@fleet.example"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="current-password"
          />

          {error ? (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          ) : null}

          <Button type="submit" busy={isSubmitting} disabled={!identifier || !password}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-xs leading-relaxed text-slate-600">
          No account yet? Create one on the server with{' '}
          <code className="text-slate-500">python scripts/create_user.py</code>.
          Driver accounts are created from the Drivers page.
        </p>
      </div>
    </div>
  )
}
