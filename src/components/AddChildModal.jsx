import { useState } from 'react'
import { FormField, Input, Select, Button, Alert } from './ui'

const GENDERS = [
  { value: '', label: 'Prefer not to say' },
  { value: 'boy', label: 'Boy' },
  { value: 'girl', label: 'Girl' },
  { value: 'other', label: 'Other' },
]

export default function AddChildModal({ onClose, onSave }) {
  const [form, setForm] = useState({ name: '', birthday: '', gender: '' })
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const [loading, setLoading] = useState(false)

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    else if (form.name.trim().length > 50) e.name = 'Name must be 50 characters or fewer'
    if (!form.birthday) e.birthday = 'Birthday is required'
    else {
      const age = getAge(form.birthday)
      if (age < 0 || age > 18) e.birthday = 'Please enter a valid birthday'
    }
    return e
  }

  const getAge = (birthday) => {
    const today = new Date()
    const birth = new Date(birthday)
    let age = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
    return age
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setApiError('')
    setLoading(true)
    const { error } = await onSave({ name: form.name.trim(), birthday: form.birthday, gender: form.gender })
    setLoading(false)
    if (error) { setApiError(error.message); return }
    onClose()
  }

  const today = new Date().toISOString().split('T')[0]
  const minDate = new Date()
  minDate.setFullYear(minDate.getFullYear() - 18)

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(44,26,14,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(2px)'
      }}
    >
      <div style={{
        background: 'var(--warm-white)',
        borderRadius: 'var(--radius-lg)',
        padding: '28px 24px',
        width: '100%',
        maxWidth: 400,
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border)',
        animation: 'slideUp 0.2s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
            Add a child
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-muted)', lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          {apiError && <Alert type="error">{apiError}</Alert>}
          <FormField label="Child's name" id="child-name" error={errors.name}>
            <Input
              id="child-name" type="text" placeholder="First name"
              value={form.name} error={errors.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </FormField>
          <FormField label="Birthday" id="birthday" error={errors.birthday}>
            <Input
              id="birthday" type="date"
              max={today}
              min={minDate.toISOString().split('T')[0]}
              value={form.birthday} error={errors.birthday}
              onChange={e => setForm(f => ({ ...f, birthday: e.target.value }))}
            />
          </FormField>
          <FormField label="Gender (optional)" id="gender">
            <Select id="gender" value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
              {GENDERS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </Select>
          </FormField>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <Button type="button" variant="secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
            <Button type="submit" loading={loading} style={{ flex: 2 }}>Add child</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
