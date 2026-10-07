import { useState } from 'react'
import { na } from '../utils/display'
import { formatCurrency, formatNumber, formatPercent } from '../utils/format'
import CampaignBudgetHistory from './CampaignBudgetHistory'
import GoalManagementPanel from './GoalManagementPanel'

export default function CampaignDetailDrawer({ open, campaign, onClose, onOpenNotes }) {
  const [goalsOpen, setGoalsOpen] = useState(false)
  
  if (!open || !campaign) return null

  return (
    <div className="notes-overlay" role="presentation" onClick={onClose}>
      <aside
        className="campaign-detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Campaign details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="campaign-detail-drawer__header">
          <div>
            <p className="campaign-detail-drawer__eyebrow">Campaign details</p>
            <h2 className="campaign-detail-drawer__title">{campaign.campaign_name}</h2>
            {campaign.app_name ? (
              <p className="campaign-detail-drawer__subtitle">App · {campaign.app_name}</p>
            ) : null}
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="campaign-detail-drawer__body">
          <dl className="campaign-detail-drawer__meta">
            <div>
              <dt>Segment</dt>
              <dd>
                <span className={`segment-pill segment-pill--${campaign.segmentKey}`}>
                  {campaign.segment}
                </span>
              </dd>
            </div>
            <div>
              <dt>App ID</dt>
              <dd>{campaign.app_id || campaign.app_key || 'N/A'}</dd>
            </div>
          </dl>

          <dl className="campaign-detail-drawer__stats">
            <div>
              <dt>Spend</dt>
              <dd>{na(campaign.spend, formatCurrency)}</dd>
            </div>
            <div>
              <dt>Installs</dt>
              <dd>{na(campaign.installs, (v) => formatNumber(v, 0))}</dd>
            </div>
            <div>
              <dt>CPA</dt>
              <dd>{na(campaign.cpa, formatCurrency)}</dd>
            </div>
            <div>
              <dt>Taps</dt>
              <dd>{na(campaign.taps, (v) => formatNumber(v, 0))}</dd>
            </div>
            <div>
              <dt>CR</dt>
              <dd>{na(campaign.cr, formatPercent)}</dd>
            </div>
            <div>
              <dt>Daily Budget</dt>
              <dd>{na(campaign.daily_budget, formatCurrency)}</dd>
            </div>
          </dl>

          <CampaignBudgetHistory
            appId={campaign.app_id}
            campaignName={campaign.campaign_name}
          />

          <div className="campaign-detail-drawer__actions">
            <button
              type="button"
              className="btn btn--upload"
              onClick={() => onOpenNotes?.(campaign)}
            >
              Notes
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setGoalsOpen(true)}
            >
              Set Goal
            </button>
          </div>
        </div>
      </aside>

      <GoalManagementPanel
        open={goalsOpen}
        entityType="campaign"
        entityKey={campaign.entity_key}
        entityName={campaign.campaign_name}
        onClose={() => setGoalsOpen(false)}
      />
    </div>
  )
}
