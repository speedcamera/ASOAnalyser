import { useCallback, useEffect, useState } from 'react'
import {
  createAnnotation,
  deleteAnnotation,
  fetchAnnotations,
  updateAnnotation,
} from '../api'
import { MAX_NOTE_TEXT } from '../analyticsLimits'
import {
  formatNoteTimestamp,
  NOTE_TYPES,
  noteTypeLabel,
} from '../utils/entityKeys'

const EMPTY_FORM = {
  noteType: 'note',
  noteText: '',
  isPinned: false,
}

export default function NotesPanel({
  open,
  onClose,
  entityType,
  entityKey,
  title,
  subtitle,
}) {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)

  const loadNotes = useCallback(async () => {
    if (!entityType || !entityKey) return
    setLoading(true)
    setError('')
    try {
      const data = await fetchAnnotations({ entityType, entityKey })
      setNotes(data)
    } catch (err) {
      setError(err.message || 'Failed to load notes')
      setNotes([])
    } finally {
      setLoading(false)
    }
  }, [entityType, entityKey])

  useEffect(() => {
    if (!open) return
    setForm(EMPTY_FORM)
    setEditingId(null)
    loadNotes()
  }, [open, loadNotes])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function handleSubmit(e) {
    e.preventDefault()
    const noteText = form.noteText.trim()
    if (!noteText) {
      setError('Note text is required')
      return
    }
    if (noteText.length > MAX_NOTE_TEXT) {
      setError(`Note text must be ${MAX_NOTE_TEXT} characters or fewer`)
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        entityType,
        entityKey,
        noteType: form.noteType,
        noteText,
        isPinned: form.isPinned,
      }
      if (editingId) {
        await updateAnnotation(editingId, payload)
      } else {
        await createAnnotation(payload)
      }
      setForm(EMPTY_FORM)
      setEditingId(null)
      await loadNotes()
    } catch (err) {
      setError(err.message || 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(note) {
    setEditingId(note.id)
    setForm({
      noteType: note.noteType,
      noteText: note.noteText,
      isPinned: note.isPinned,
    })
    setError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  async function togglePin(note) {
    setError('')
    try {
      await updateAnnotation(note.id, {
        entityType: note.entityType,
        entityKey: note.entityKey,
        noteType: note.noteType,
        noteText: note.noteText,
        isPinned: !note.isPinned,
      })
      await loadNotes()
    } catch (err) {
      setError(err.message || 'Failed to update pin')
    }
  }

  async function removeNote(note) {
    if (!window.confirm('Delete this note?')) return
    setError('')
    try {
      await deleteAnnotation(note.id)
      if (editingId === note.id) cancelEdit()
      await loadNotes()
    } catch (err) {
      setError(err.message || 'Failed to delete note')
    }
  }

  return (
    <div className="notes-overlay" role="presentation" onClick={onClose}>
      <aside
        className="notes-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Notes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="notes-panel__header">
          <div>
            <h2 className="notes-panel__title">Notes</h2>
            <p className="notes-panel__entity">{title}</p>
            {subtitle ? <p className="notes-panel__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn--ghost notes-panel__close" onClick={onClose}>
            Close
          </button>
        </header>

        <form className="notes-panel__form" onSubmit={handleSubmit}>
          <div className="notes-panel__form-row">
            <label className="filter-field__label" htmlFor="note-type">
              Type
            </label>
            <select
              id="note-type"
              className="filter-select"
              value={form.noteType}
              onChange={(e) => setForm((f) => ({ ...f, noteType: e.target.value }))}
            >
              {NOTE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="notes-panel__form-row">
            <label className="filter-field__label" htmlFor="note-text">
              {editingId ? 'Edit note' : 'New note'}
            </label>
            <textarea
              id="note-text"
              className="notes-panel__textarea"
              rows={3}
              maxLength={MAX_NOTE_TEXT}
              value={form.noteText}
              onChange={(e) => setForm((f) => ({ ...f, noteText: e.target.value }))}
              placeholder="Add a timestamped note…"
            />
          </div>

          <label className="notes-panel__pin-toggle">
            <input
              type="checkbox"
              checked={form.isPinned}
              onChange={(e) => setForm((f) => ({ ...f, isPinned: e.target.checked }))}
            />
            Pin note
          </label>

          <div className="notes-panel__form-actions">
            {editingId ? (
              <button type="button" className="btn btn--ghost" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
            ) : null}
            <button type="submit" className="btn btn--upload" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update note' : 'Add note'}
            </button>
          </div>
        </form>

        {error ? <p className="notes-panel__error">{error}</p> : null}

        <div className="notes-panel__list">
          {loading ? <p className="notes-panel__empty">Loading notes…</p> : null}
          {!loading && notes.length === 0 ? (
            <p className="notes-panel__empty">No notes yet for this {entityType}.</p>
          ) : null}
          {notes.map((note) => (
            <article
              key={note.id}
              className={`notes-panel__item${note.isPinned ? ' notes-panel__item--pinned' : ''}`}
            >
              <div className="notes-panel__item-meta">
                <span className={`notes-panel__type notes-panel__type--${note.noteType}`}>
                  {noteTypeLabel(note.noteType)}
                </span>
                {note.isPinned ? <span className="notes-panel__pinned-badge">Pinned</span> : null}
                <time className="notes-panel__time" dateTime={note.createdAt}>
                  {formatNoteTimestamp(note.createdAt)}
                </time>
              </div>
              <p className="notes-panel__text">{note.noteText}</p>
              {note.updatedAt && note.updatedAt !== note.createdAt ? (
                <p className="notes-panel__updated">
                  Updated {formatNoteTimestamp(note.updatedAt)}
                </p>
              ) : null}
              <div className="notes-panel__item-actions">
                <button type="button" className="btn btn--ghost" onClick={() => startEdit(note)}>
                  Edit
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => togglePin(note)}>
                  {note.isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => removeNote(note)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </div>
  )
}
