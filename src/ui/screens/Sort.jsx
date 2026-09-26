/**
 * Choosing the order.
 *
 * The strategy list is the board's index; its options panel is the only
 * thing that changes beside it. There are deliberately no tempo, energy or
 * mood strategies — Spotify withdrew that data for new apps, and offering a
 * control that quietly fails is worse than not offering it.
 */

import { useRef } from 'react'
import { STRATEGIES } from '../../sort/index.js'
import { unsupportedReason } from '../../services/capabilities.js'
import { artistsOf, formatCount, titleOf } from '../format.js'
import { CSV_STRATEGY } from '../useSorterApp.js'
import {
  Frame,
  Head,
  Lever,
  LeverRow,
  Meter,
  Notice,
  OptionRow,
  QuietLever,
} from '../components/chrome.jsx'

const CSV_FIELDS = [
  ['uri', 'Track URI or ID'],
  ['isrc', 'ISRC'],
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
]

export function SortScreen({ app }) {
  const {
    capabilitySource,
    playlist,
    tracks,
    busy,
    error,
    strategyId,
    chooseStrategy,
    options,
    setOption,
    csv,
    csvReport,
    loadCsv,
    setCsvColumn,
    setCsvOption,
    toggleSuggestion,
    setScreen,
    targetTracks,
  } = app

  const fileInput = useRef(null)
  const ready = tracks.length > 0
  const strategy = STRATEGIES.find((item) => item.id === strategyId)

  return (
    <Frame>
      <Head
        back={{ label: 'All playlists', onClick: () => setScreen('playlists') }}
        title={playlist?.name ?? 'Playlist'}
        tally={[
          { label: 'Tracks', value: formatCount(tracks.length) },
          {
            label: 'Access',
            value: playlist?.editable ? 'EDITABLE' : 'CLONE ONLY',
            tone: playlist?.editable ? 'green' : 'amber',
          },
        ]}
      />

      {busy ? (
        <div className="section">
          <p className="col-label" style={{ marginBottom: 8 }}>
            {busy.label}
          </p>
          <Meter done={busy.done} total={busy.total || 1} />
        </div>
      ) : null}

      {error ? (
        <div className="section">
          <Notice tone="red" title="Could not read this playlist">
            {error}
          </Notice>
        </div>
      ) : null}

      <div className="section split">
        <div>
          <p className="col-label" style={{ marginBottom: 10 }}>
            Order by
          </p>
          {STRATEGIES.map((item) => {
            // The open playlist's own service decides, not the toggle that
            // happens to be showing. They can disagree.
            const reason = unsupportedReason(capabilitySource, item.id)
            return (
              <button
                key={item.id}
                type="button"
                className="strategy"
                aria-pressed={strategyId === item.id}
                disabled={Boolean(reason)}
                onClick={() => chooseStrategy(item.id)}
              >
                <span className="strategy-name">{item.label}</span>
                <span className="strategy-note">{item.description}</span>
                {reason ? <span className="strategy-reason">{reason}</span> : null}
              </button>
            )
          })}
          <button
            type="button"
            className="strategy"
            aria-pressed={strategyId === CSV_STRATEGY}
            onClick={() => chooseStrategy(CSV_STRATEGY)}
          >
            <span className="strategy-name">From a CSV</span>
            <span className="strategy-note">
              Match a file's row order. Never adds or removes tracks.
            </span>
          </button>
        </div>

        <div>
          {strategyId === CSV_STRATEGY ? (
            <CsvPanel
              csv={csv}
              report={csvReport}
              fileInput={fileInput}
              onPick={loadCsv}
              onColumn={setCsvColumn}
              onOption={setCsvOption}
              onToggleSuggestion={toggleSuggestion}
            />
          ) : (
            <StrategyOptions strategy={strategy} options={options} setOption={setOption} />
          )}

          {ready ? <OrderPeek tracks={targetTracks} /> : null}
        </div>
      </div>

      <LeverRow sticky>
        <span className="spacer" />
        <Lever onClick={() => setScreen('preview')} disabled={!ready}>
          Preview the change
        </Lever>
      </LeverRow>
    </Frame>
  )
}

/** The top of the resulting order, so the choice is legible before previewing. */
function OrderPeek({ tracks }) {
  const shown = tracks.slice(0, 14)
  const rest = tracks.length - shown.length

  return (
    <div style={{ marginTop: 30 }}>
      <p className="col-label" style={{ marginBottom: 10 }}>
        How it starts
      </p>
      <div className="peek">
        {shown.map((track, index) => (
          <div className="peek-row" key={track.originalIndex}>
            <span className="peek-pos num">{index + 1}</span>
            <span style={{ minWidth: 0 }}>
              <span className="peek-title">{titleOf(track)}</span>
              <span className="peek-artist" style={{ display: 'block' }}>
                {artistsOf(track)}
              </span>
            </span>
          </div>
        ))}
        {rest > 0 ? <div className="peek-more">and {formatCount(rest)} more</div> : null}
      </div>
    </div>
  )
}

function StrategyOptions({ strategy, options, setOption }) {
  if (!strategy) return null

  return (
    <div>
      <p className="col-label" style={{ marginBottom: 10 }}>
        {strategy.label} options
      </p>

      {strategy.options.length === 0 ? (
        <p className="prose">This one takes no options.</p>
      ) : null}

      <div style={{ display: 'grid', gap: 20 }}>
        {strategy.options.map((option) =>
          option.type === 'select' ? (
            <OptionRow
              key={option.id}
              label={option.label}
              value={options[option.id] ?? option.default}
              onChange={(value) => setOption(option.id, value)}
              choices={option.choices}
            />
          ) : (
            <div key={option.id}>
              <label className="field-label" htmlFor={`opt-${option.id}`}>
                {option.label}
              </label>
              <input
                id={`opt-${option.id}`}
                className="field"
                style={{ maxWidth: 320 }}
                value={options[option.id] ?? ''}
                onChange={(event) => setOption(option.id, event.target.value)}
                placeholder="Any word — the same word always shuffles the same way"
              />
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function CsvPanel({ csv, report, fileInput, onPick, onColumn, onOption, onToggleSuggestion }) {
  return (
    <div>
      <p className="col-label" style={{ marginBottom: 10 }}>
        CSV order
      </p>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onPick(file)
          event.target.value = ''
        }}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <QuietLever onClick={() => fileInput.current?.click()}>
          {csv ? 'Choose another file' : 'Choose a CSV'}
        </QuietLever>
        {csv ? <span className="row-sub num">{csv.fileName}</span> : null}
      </div>

      {!csv ? (
        <p className="prose" style={{ marginTop: 16 }}>
          The file sets the order only. Rows that match nothing are reported;
          tracks the file never mentions move to the bottom, keeping their
          relative order.
        </p>
      ) : null}

      {csv ? (
        <>
          <div style={{ display: 'grid', gap: 14, marginTop: 24 }}>
            <p className="col-label">
              Columns {csv.hasHeader ? '· detected from the header' : '· no header found'}
            </p>
            {CSV_FIELDS.map(([field, label]) => (
              <div
                key={field}
                style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <label
                  className="field-label"
                  htmlFor={`csv-${field}`}
                  style={{ minWidth: '14ch', marginBottom: 0 }}
                >
                  {label}
                </label>
                <select
                  id={`csv-${field}`}
                  className="field"
                  style={{ maxWidth: 260 }}
                  value={csv.columns[field] ?? ''}
                  onChange={(event) =>
                    onColumn(field, event.target.value === '' ? null : Number(event.target.value))
                  }
                >
                  <option value="">Not in this file</option>
                  {csv.headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22 }}>
            <OptionRow
              label="Tracks the file does not mention"
              value={csv.unmatchedPosition}
              onChange={(value) => onOption('unmatchedPosition', value)}
              choices={[
                { value: 'bottom', label: 'To the bottom' },
                { value: 'top', label: 'To the top' },
              ]}
            />
          </div>

          {report ? <CsvReport report={report} /> : null}

          {report?.suggestions?.length ? (
            <SuggestionReview
              suggestions={report.suggestions}
              accepted={csv.accepted ?? []}
              onToggle={onToggleSuggestion}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/**
 * Near-miss rows. These are never applied on their own — the matcher only
 * proposes them, and nothing moves until one is accepted here.
 */
function SuggestionReview({ suggestions, accepted, onToggle }) {
  return (
    <div style={{ marginTop: 26 }}>
      <p className="col-label" style={{ marginBottom: 10 }}>
        Needs review · {suggestions.length}
      </p>
      <p className="prose" style={{ fontSize: 'var(--fs-sub)', marginTop: 0, marginBottom: 12 }}>
        Close matches the file did not name exactly. Accept one and it takes its
        place in the CSV order; leave it and that track keeps its slot.
      </p>

      <div className="peek">
        {suggestions.map((suggestion) => {
          const isAccepted = accepted.includes(suggestion.rowIndex)
          return (
            <div className="suggestion" key={suggestion.rowIndex}>
              <div style={{ minWidth: 0 }}>
                <span className="peek-title">{suggestion.title || '(no title)'}</span>
                <span className="peek-artist" style={{ display: 'block' }}>
                  {suggestion.artist}
                </span>
                <span className="suggestion-target">
                  matches <strong>{titleOf(suggestion.track)}</strong> ·{' '}
                  {artistsOf(suggestion.track)}
                </span>
              </div>

              <div className="suggestion-actions">
                <span className="chip">{Math.round(suggestion.score * 100)}%</span>
                <button
                  type="button"
                  className="option"
                  aria-pressed={isAccepted}
                  onClick={() => onToggle(suggestion.rowIndex)}
                >
                  {isAccepted ? 'Accepted' : 'Accept'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CsvReport({ report }) {
  const { counts } = report
  const rows = [
    ['CSV rows', counts.csvRows, null],
    ['Playlist tracks', counts.playlistTracks, null],
    ['Matched', counts.matched, counts.matched > 0 ? 'green' : null],
    ['Needs review', counts.needsReview, counts.needsReview > 0 ? 'amber' : null],
    ['CSV rows with no match', counts.unmatchedRows, counts.unmatchedRows > 0 ? 'amber' : null],
    ['Tracks not in the CSV', counts.unmatchedTracks, counts.unmatchedTracks > 0 ? 'amber' : null],
    ['Duplicate CSV rows', counts.duplicateRows, counts.duplicateRows > 0 ? 'amber' : null],
  ]

  return (
    <div style={{ marginTop: 26 }}>
      <p className="col-label" style={{ marginBottom: 10 }}>
        Reconciliation
      </p>
      <div style={{ border: '1px solid var(--rule)' }}>
        {rows.map(([label, value, tone]) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              padding: '9px 14px',
              borderBottom: '1px solid var(--rule-soft)',
            }}
          >
            <span className="row-sub">{label}</span>
            <span className="num" style={{ color: tone ? `var(--${tone})` : 'var(--flap)' }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {counts.matched > 0 ? (
        <p className="prose" style={{ fontSize: 'var(--fs-sub)', marginTop: 10 }}>
          Matched by URI {report.counts.byTier.uri} · ISRC {report.counts.byTier.isrc} · title and
          artist {report.counts.byTier.titleArtist + report.counts.byTier.titleAnyArtist}
        </p>
      ) : null}
    </div>
  )
}
