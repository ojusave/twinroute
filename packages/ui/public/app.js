const form = document.querySelector('#inspectForm');
const input = document.querySelector('#urlInput');
const inspectButton = document.querySelector('#inspectButton');
const loadingPanel = document.querySelector('#loadingPanel');
const loadingStep = document.querySelector('#loadingStep');
const resultSection = document.querySelector('#resultSection');
const serviceResults = document.querySelector('#serviceResults');
const overviewPanel = document.querySelector('#overviewPanel');
const headersPanel = document.querySelector('#headersPanel');
const jsonOutput = document.querySelector('#jsonOutput');
const copyButton = document.querySelector('#copyButton');
const sourceButton = document.querySelector('#sourceButton');
const deployButton = document.querySelector('#deployButton');
const healthButton = document.querySelector('#healthButton');
const deployPopover = document.querySelector('#deployPopover');
const serviceIdentity = document.querySelector('#serviceIdentity');
const toast = document.querySelector('#toast');
const formError = document.querySelector('#formError');

let config;
let latestResults = [];
let loadingTimer;

const frameworkLabel = (value) => value === 'hono' ? 'Hono' : 'Express';

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 2200);
}

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(`twinroute:${name}`, { detail }));
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    config = await response.json();
    serviceIdentity.textContent = `${frameworkLabel(config.framework)} · ${config.serviceName} · ${config.region}`;
    sourceButton.href = config.repositoryUrl || '#';
    deployButton.href = config.deployUrl || '#';
    if (!config.repositoryUrl) sourceButton.setAttribute('aria-disabled', 'true');
    if (!config.deployUrl) deployButton.setAttribute('aria-disabled', 'true');
  } catch {
    serviceIdentity.textContent = 'Service details unavailable';
    healthButton.querySelector('.health-dot').style.background = '#ba3d2c';
  }
}

function apiBaseFor(framework) {
  if (config?.framework === framework) return '';
  const peer = (config?.peerApiUrl || '').replace(/\/$/, '');
  if (!peer) return '';
  return /^https?:\/\//i.test(peer) ? peer : `https://${peer}`;
}

async function inspect(framework, url) {
  const base = apiBaseFor(framework);
  if (!base && config?.framework !== framework) {
    return { ok: false, framework, code: 'REMOTE_FAILURE', message: `${frameworkLabel(framework)} peer is not configured.` };
  }
  try {
    const response = await fetch(`${base}/api/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return await response.json();
  } catch {
    return { ok: false, framework, code: 'REMOTE_FAILURE', message: `${frameworkLabel(framework)} could not be reached.` };
  }
}

function beginLoading(mode) {
  resultSection.hidden = true;
  loadingPanel.hidden = false;
  inspectButton.disabled = true;
  const label = mode === 'compare' ? 'Express and Hono' : frameworkLabel(mode);
  let elapsed = 0;
  loadingStep.textContent = `Waiting for ${label}`;
  loadingTimer = window.setInterval(() => {
    elapsed += 1;
    loadingStep.textContent = `Waiting for ${label} · ${elapsed}s`;
  }, 1000);
}

function endLoading() {
  window.clearInterval(loadingTimer);
  loadingPanel.hidden = true;
  inspectButton.disabled = false;
}

function renderServiceCard(result) {
  const card = create('article', 'service-card');
  const name = create('div', 'service-name');
  const strong = create('strong');
  const dot = create('i', `framework-dot ${result.framework === 'hono' ? 'hono-dot' : 'express-dot'}`);
  strong.append(dot, document.createTextNode(frameworkLabel(result.framework)));
  name.append(strong, create('span', '', result.ok ? `${result.durationMs}ms observation` : result.code));
  card.append(name);

  if (!result.ok) {
    card.append(create('p', 'service-error', result.message));
    return card;
  }

  const metrics = create('div', 'service-metrics');
  const values = [
    ['Status', String(result.status)],
    ['Redirects', String(result.redirects.length)],
    ['Bytes', new Intl.NumberFormat().format(result.size)],
  ];
  for (const [label, value] of values) {
    const metric = create('div', 'metric');
    metric.append(create('span', '', label), create('strong', '', value));
    metrics.append(metric);
  }
  card.append(metrics);
  return card;
}

function renderOverview(results) {
  overviewPanel.replaceChildren();
  const success = results.find((result) => result.ok);
  if (!success) {
    overviewPanel.append(create('p', 'empty-note', 'No report was produced. Correct the URL or try again.'));
    return;
  }

  const grid = create('div', 'overview-grid');
  const summary = create('div', 'page-summary');
  summary.append(
    create('span', 'summary-label', 'Page identity'),
    create('h3', '', success.metadata.title || 'Untitled document'),
    create('p', '', success.metadata.description || 'No meta description was returned.'),
    create('span', 'final-url', success.finalUrl),
  );

  const preview = create('div', 'preview');
  preview.append(
    create('div', 'preview-url', new URL(success.finalUrl).hostname),
    create('div', 'preview-title', success.metadata.title || 'Untitled document'),
    create('p', 'preview-description', success.metadata.description || 'No description available for this result.'),
  );
  grid.append(summary, preview);
  overviewPanel.append(grid);

  const redirectSection = create('div', 'redirects');
  redirectSection.append(create('span', 'summary-label', 'Redirect path'));
  if (success.redirects.length === 0) {
    redirectSection.append(create('p', 'empty-note', 'Direct response. No redirects observed.'));
  } else {
    const list = create('ol', 'redirect-list');
    success.redirects.forEach((hop) => {
      const item = create('li');
      item.append(create('span', '', String(hop.status)), create('div', '', `${hop.url} → ${hop.location}`));
      list.append(item);
    });
    redirectSection.append(list);
  }
  overviewPanel.append(redirectSection);
}

function renderHeaders(results) {
  headersPanel.replaceChildren();
  const successes = results.filter((result) => result.ok);
  if (!successes.length) {
    headersPanel.append(create('p', 'empty-note', 'No headers were returned.'));
    return;
  }
  const table = create('table', 'headers-table');
  const body = document.createElement('tbody');
  const headerNames = Object.keys(successes[0].headers);
  for (const name of headerNames) {
    const row = document.createElement('tr');
    row.append(create('th', '', name));
    const values = successes.map((result) => `${frameworkLabel(result.framework)}: ${result.headers[name] || 'not sent'}`);
    const cell = create('td', successes.every((result) => !result.headers[name]) ? 'missing' : '', values.join(' · '));
    row.append(cell);
    body.append(row);
  }
  table.append(body);
  headersPanel.append(table);
}

function renderResults(results) {
  latestResults = results;
  serviceResults.replaceChildren(...results.map(renderServiceCard));
  renderOverview(results);
  renderHeaders(results);
  jsonOutput.textContent = JSON.stringify(results.length === 1 ? results[0] : results, null, 2);
  resultSection.hidden = false;

  const complete = results.some((result) => result.ok);
  const inputFailure = results.find((result) => !result.ok && ['INVALID_URL', 'BLOCKED_DESTINATION'].includes(result.code));
  formError.hidden = !inputFailure;
  formError.textContent = inputFailure?.message || '';
  input.setAttribute('aria-describedby', inputFailure ? 'safetyNote formError' : 'safetyNote');
  input.setAttribute('aria-invalid', String(Boolean(inputFailure)));
  if (inputFailure) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  emit('inspection_completed', {
    mode: results.length === 2 ? 'compare' : results[0]?.framework,
    resultClass: complete ? 'success' : 'failure',
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  const mode = new FormData(form).get('mode');
  formError.hidden = true;
  beginLoading(mode);
  emit('inspection_started', { mode });
  const frameworks = mode === 'compare' ? ['express', 'hono'] : [mode];
  const results = await Promise.all(frameworks.map((framework) => inspect(framework, url)));
  endLoading();
  renderResults(results);
});

document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.example;
    input.focus();
  });
});

document.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[role="tab"]').forEach((item) => item.setAttribute('aria-selected', String(item === tab)));
    document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = true; });
    document.querySelector(`#${tab.dataset.tab}Panel`).hidden = false;
    if (tab.dataset.tab === 'difference') emit('comparison_opened');
  });
  tab.addEventListener('keydown', async (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(tab);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
});

healthButton.addEventListener('click', () => {
  const expanded = healthButton.getAttribute('aria-expanded') === 'true';
  healthButton.setAttribute('aria-expanded', String(!expanded));
  deployPopover.hidden = expanded;
});

document.addEventListener('click', (event) => {
  if (!healthButton.contains(event.target) && !deployPopover.contains(event.target)) {
    healthButton.setAttribute('aria-expanded', 'false');
    deployPopover.hidden = true;
  }
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(latestResults.length === 1 ? latestResults[0] : latestResults, null, 2));
  showToast('Report JSON copied');
});

sourceButton.addEventListener('click', () => emit('github_clicked'));
deployButton.addEventListener('click', () => emit('blueprint_deploy_clicked'));
document.querySelector('#renderSignupLink').addEventListener('click', () => emit('render_signup_clicked'));

emit('demo_viewed');
loadConfig();
