import { useState, useRef, useEffect } from 'react'
import { updateCampaignSegment } from '../api'

const SEGMENTS = [
  { value: 'Brand', label: 'Brand' },
  { value: 'Generic', label: 'Generic' },
  { value: 'Discovery', label: 'Discovery' },
  { value: 'Competitor', label: 'Competitor' },
  { value: 'Other', label: 'Other' },
]

export default function EditableSegmentPill({ campaignId, segment, segmentKey, onUpdate }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState(null)
  const dropdownRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false)
        setError(null)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleSelect = async (newSegment) => {
    if (newSegment === segment || !campaignId) {
      setIsOpen(false)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      await updateCampaignSegment(campaignId, newSegment)
      setIsOpen(false)
      if (onUpdate) {
        onUpdate(newSegment)
      }
    } catch (err) {
      setError(err.message || 'Failed to update segment')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="editable-segment-pill" ref={dropdownRef}>
      <button
        type="button"
        className={`segment-pill segment-pill--${segmentKey} segment-pill--editable`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSaving || !campaignId}
        title={campaignId ? 'Click to change segment' : 'Campaign not found'}
      >
        {segment}
        <svg
          className="segment-pill__chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="segment-dropdown">
          {SEGMENTS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segment-dropdown__item ${option.value === segment ? 'segment-dropdown__item--active' : ''}`}
              onClick={() => handleSelect(option.value)}
              disabled={isSaving}
            >
              {option.label}
              {option.value === segment && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M11.6667 3.5L5.25 9.91667L2.33333 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
          {error && (
            <div className="segment-dropdown__error">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
