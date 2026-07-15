const examples = {
  valid: {
    event: 'invoice.paid',
    payload: { id: 'in_2048', amount: 4900, currency: 'USD' },
  },
  missingField: {
    event: 'invoice.paid',
    payload: { amount: 4900, currency: 'USD' },
  },
  wrongType: {
    event: 'invoice.paid',
    payload: { id: 'in_2048', amount: 'forty-nine dollars', currency: 'USD' },
  },
};

const root = document.documentElement;
const themeToggle = document.querySelector('#themeToggle');
const themeLabel = document.querySelector('#themeLabel');
const themeIcon = document.querySelector('#themeIcon');
const jsonInput = document.querySelector('#jsonInput');
const editorError = document.querySelector('#editorError');
const runButton = document.querySelector('#runButton');
const comparisonSummary = document.querySelector('#comparisonSummary');
const sourceLink = document.querySelector('#sourceLink');
const serviceName = document.querySelector('#serviceName');
const deploymentDetail = document.querySelector('#deploymentDetail');

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(`twinroute:${name}`, { detail }));
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  const next = theme === 'light' ? 'dark' : 'light';
  themeLabel.textContent = next === 'dark' ? 'Dark' : 'Light';
  themeIcon.textContent = theme === 'light' ? '◐' : '◑';
  themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
}

const savedTheme = localStorage.getItem('twinroute-theme');
const initialTheme = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(initialTheme);

themeToggle.addEventListener('click', () => {
  const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('twinroute-theme', theme);
  applyTheme(theme);
});

document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-example]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
    jsonInput.value = JSON.stringify(examples[button.dataset.example], null, 2);
    editorError.hidden = true;
    jsonInput.removeAttribute('aria-invalid');
    jsonInput.focus();
  });
});

function renderTrace(framework, trace) {
  const list = document.querySelector(`#${framework}Trace`);
  list.replaceChildren();
  for (const step of trace ?? []) {
    const item = document.createElement('li');
    if (step.status === 'failed') item.className = 'failed';
    const label = document.createElement('strong');
    const detail = document.createElement('span');
    label.textContent = step.label;
    detail.textContent = step.detail;
    item.append(label, detail);
    list.append(item);
  }
}

function renderResult(result) {
  const framework = result.framework;
  const status = document.querySelector(`#${framework}Status`);
  const response = document.querySelector(`#${framework}Response`);
  status.textContent = `HTTP ${result.status}`;
  status.className = `status-pill ${result.ok ? 'success' : 'failure'}`;
  response.textContent = JSON.stringify(result.body, null, 2);
  renderTrace(framework, result.trace);
}

async function send(framework, body) {
  try {
    const response = await fetch(`/api/${framework}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await response.json();
  } catch {
    return {
      ok: false,
      framework,
      status: 503,
      trace: [],
      body: { accepted: false, error: 'The endpoint could not be reached' },
    };
  }
}

runButton.addEventListener('click', async () => {
  let body;
  try {
    body = JSON.parse(jsonInput.value);
  } catch {
    editorError.textContent = 'Fix the JSON syntax before running the request.';
    editorError.hidden = false;
    jsonInput.setAttribute('aria-invalid', 'true');
    jsonInput.focus();
    return;
  }

  editorError.hidden = true;
  jsonInput.removeAttribute('aria-invalid');
  runButton.disabled = true;
  runButton.querySelector('span').textContent = 'Waiting for both';
  comparisonSummary.textContent = 'Express and Hono are handling the same request.';
  emit('comparison_started');

  const [express, hono] = await Promise.all([
    send('express', body),
    send('hono', body),
  ]);

  renderResult(express);
  renderResult(hono);
  if (express.ok && hono.ok) {
    const sameBody = JSON.stringify(express.body) === JSON.stringify(hono.body);
    comparisonSummary.textContent = sameBody
      ? 'Both returned HTTP 202 with the same response body.'
      : 'Both accepted the request, but their response bodies differ.';
  } else if (!express.ok && !hono.ok) {
    comparisonSummary.textContent = 'Both rejected the request with HTTP 400. Their error paths differ.';
  } else {
    comparisonSummary.textContent = 'The framework results do not match. Inspect both paths below.';
  }

  runButton.disabled = false;
  runButton.querySelector('span').textContent = 'Run through both';
  emit('comparison_completed', { expressStatus: express.status, honoStatus: hono.status });
});

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    serviceName.textContent = `${config.serviceName} · ${config.region}`;
    deploymentDetail.textContent = `Running as one service in ${config.region}`;
    sourceLink.href = config.repositoryUrl || '#';
    if (!config.repositoryUrl) sourceLink.setAttribute('aria-disabled', 'true');
  } catch {
    serviceName.textContent = 'Service details unavailable';
  }
}

sourceLink.addEventListener('click', () => emit('github_clicked'));
document.querySelector('#renderSignupLink').addEventListener('click', () => emit('render_signup_clicked'));

emit('demo_viewed');
loadConfig();
