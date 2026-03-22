import { getEntries, getPointer, getFullEntries, jumpTo, setHistoryChangeListener } from './history.js';
import { showHistoryDiff, clearHistoryDiff, computeDiff, getDiffSummary } from './history-diff.js';
import { populateCalibration, populateApartmentInfo } from './ui-calibration.js';

// ─── HISTORY PANEL ───

export function initHistoryPanel() {
  setHistoryChangeListener(renderHistory);
}

export function historyIcon(label) {
  const l = label.toLowerCase();
  if (l.includes('kalibrering') || l.includes('mål')) return '📐';
  if (l.includes('vegg') || l.includes('wall')) return '🧱';
  if (l.includes('vindu') || l.includes('window')) return '🪟';
  if (l.includes('dør') || l.includes('door')) return '🚪';
  if (l.includes('tak') || l.includes('ceiling') || l.includes('roof')) return '⛺';
  if (l.includes('terrasse') || l.includes('terrace')) return '☀️';
  if (l.includes('møbel') || l.includes('furniture')) return '🪑';
  if (l.includes('rom') || l.includes('room')) return '📦';
  if (l.includes('trapp') || l.includes('stair')) return '🪜';
  if (l.includes('protrusion') || l.includes('bjelke')) return '🔲';
  if (l.includes('config') || l.includes('update')) return '⚙️';
  return '✏️';
}

export function renderHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;

  const entries = getEntries();
  const section = document.getElementById('history-section');
  if (entries.length === 0) {
    container.innerHTML = '<div class="history-empty">Ingen endringer ennå</div>';
    if (section) section.style.display = 'none';
    return;
  }
  // Show history section when there are entries
  if (section) section.style.display = '';

  const pointer = getPointer();
  const fullEntries = getFullEntries();
  const undoCount = pointer + 1;
  const redoCount = Math.max(0, entries.length - pointer - 2);
  let html = `<div class="history-counter">${undoCount} angre${redoCount > 0 ? ` · ${redoCount} gjør om` : ''}</div>`;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const isActive = i === pointer;
    const isFuture = i > pointer;
    const cls = `history-entry${isActive ? ' active' : ''}${isFuture ? ' future' : ''}`;
    const ago = timeAgo(e.timestamp);
    const icon = historyIcon(e.label);

    // Compute change count badge
    let badge = '';
    if (i > 0 && fullEntries[i] && fullEntries[i - 1]) {
      try {
        const diff = computeDiff(fullEntries[i].config, fullEntries[i - 1].config);
        const count = getDiffSummary(diff);
        if (count > 0) badge = `<span class="h-diff-count">${count}</span>`;
      } catch (_) { /* ignore */ }
    }

    html += `<div class="${cls}" data-index="${i}"><span class="h-icon">${icon}</span><span class="h-label">${e.label}</span>${badge}<span class="h-time">${ago}</span></div>`;
  }
  container.innerHTML = html;

  // Click handlers — jump to history state and show 3D diff overlay
  container.querySelectorAll('.history-entry').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = parseInt(el.dataset.index);
      if (window.eidos) {
        // Get configs for diff BEFORE jumping (entries include full configs)
        const fullEntries = getFullEntries();
        const prevConfig = idx > 0 ? fullEntries[idx - 1].config : null;
        const currentConfig = fullEntries[idx].config;

        await jumpTo(idx, () => window.eidos.rebuild());

        // Show 3D diff overlay if there's a previous state to compare against
        if (prevConfig) {
          showHistoryDiff(currentConfig, prevConfig);
        } else {
          clearHistoryDiff();
        }

        populateCalibration();
        populateApartmentInfo();
      }
    });
  });

  // Auto-open section when history exists
  if (section && !section.classList.contains('open') && entries.length > 0) {
    section.classList.add('open');
  }
}

export function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'nå';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}t`;
}
