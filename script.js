/* ============================================================================
   CASCATA FINANCEIRA — Frontend
   Pote central + 3 áreas com moedas
   ============================================================================ */

// >>> Cole aqui a URL do seu Web App após o Deploy do Apps Script <<<
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbye94J0ETXEMku1xSCWCxpxkQi8H5Y9bnt7Lt2OdS4SrMho9yvRk_Msgy5gUWHtmwBU/exec';

const DEBUG = false; // mude para true para ver console.log detalhado

// Quantidades fixas de moedas — reforçam a regra 50/30/20 visualmente
const MOEDAS_POR_AREA = {
  CENTRAL:       42,  // pote do salário total
  NECESSIDADES:  22,  // 50% (proporcional ao volume central, mas com piso visual)
  DESEJOS:       14,  // 30%
  INVESTIMENTOS: 10   // 20%
};

// Cada área tem uma mistura sutil diferente de tipos de moeda
// (proporções devem somar 1.0)
const MIX_MOEDAS = {
  CENTRAL:       { gold: 0.45, silver: 0.30, copper: 0.25 }, // mistura completa
  NECESSIDADES:  { gold: 0.25, silver: 0.35, copper: 0.40 }, // mais cobre
  DESEJOS:       { gold: 0.35, silver: 0.45, copper: 0.20 }, // mais prata
  INVESTIMENTOS: { gold: 0.65, silver: 0.25, copper: 0.10 }  // mais ouro
};

const COIN_STAGGER  = 50;   // ms entre moedas
const COIN_JITTER   = 60;   // jitter aleatório

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let estado = {
  salario: 0,
  areas: {
    NECESSIDADES:  { percentual: 0.50, valorTotal: 0, somaPesos: 0, potes: [] },
    DESEJOS:       { percentual: 0.30, valorTotal: 0, somaPesos: 0, potes: [] },
    INVESTIMENTOS: { percentual: 0.20, valorTotal: 0, somaPesos: 0, potes: [] }
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

const fmtBRL = (n) => (isFinite(n) ? n : 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2
});

const parseBRL = (str) => {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const limpo = String(str).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isFinite(n) ? n : 0;
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const setStatus = (msg, tipo = 'ok') => {
  const el = $('#statusMsg');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('is-error', 'is-loading');
  if (tipo === 'error')   el.classList.add('is-error');
  if (tipo === 'loading') el.classList.add('is-loading');
};

const randomBetween = (a, b) => a + Math.random() * (b - a);

// Pick ponderado: dado { gold: 0.5, silver: 0.3, copper: 0.2 }, devolve uma chave
function pickPonderado(pesos) {
  const r = Math.random();
  let acc = 0;
  for (const [k, p] of Object.entries(pesos)) {
    acc += p;
    if (r <= acc) return k;
  }
  return Object.keys(pesos)[0];
}

// ---------------------------------------------------------------------------
// Cálculo local (preview ao vivo, mesma fórmula do backend)
// ---------------------------------------------------------------------------
function recalcularLocal(base) {
  const salario = base.salario || 0;
  ['NECESSIDADES', 'DESEJOS', 'INVESTIMENTOS'].forEach(area => {
    const a = base.areas[area];
    const valorArea = salario * a.percentual;
    const soma = a.potes.reduce((s, p) => s + (Number(p.peso) || 0), 0);
    a.valorTotal = Math.round(valorArea * 100) / 100;
    a.somaPesos = soma;
    a.potes = a.potes.map(p => {
      const peso = Number(p.peso) || 0;
      const frac = soma > 0 ? peso / soma : 0;
      const valor = frac * valorArea;
      return {
        ...p,
        valor: Math.round(valor * 100) / 100,
        pctArea: Math.round(frac * 10000) / 100,
        pctSalario: salario > 0 ? Math.round((valor / salario) * 10000) / 100 : 0
      };
    });
  });
  return base;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function apiGet() {
  setStatus('Carregando', 'loading');
  try {
    const r = await fetch(WEB_APP_URL, { method: 'GET' });
    const data = await r.json();
    if (DEBUG) console.log('[apiGet]', data);
    if (!data.ok) throw new Error(data.error || 'Erro desconhecido');
    setStatus('Pronto');
    return data;
  } catch (err) {
    setStatus('Falha ao carregar: ' + err.message, 'error');
    console.error('[apiGet] erro:', err);
    throw err;
  }
}

async function apiPost(action, payload) {
  setStatus('Salvando', 'loading');
  try {
    const r = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
      body: JSON.stringify({ action, payload }),
      redirect: 'follow'
    });
    const data = await r.json();
    if (DEBUG) console.log('[apiPost]', action, payload, '→', data);
    if (!data.ok) throw new Error(data.error || 'Erro desconhecido');
    setStatus('Sincronizado');
    return data;
  } catch (err) {
    setStatus('Falha ao salvar: ' + err.message, 'error');
    console.error('[apiPost] erro:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MOEDAS
// ---------------------------------------------------------------------------
/**
 * Distribui moedas em camadas horizontais empilhadas dentro do pote.
 */
function calcularLayoutMoedas(quantidade, areaKey) {
  const layout = [];
  const moedasPorCamada = quantidade > 30 ? 7 : 5;
  const alturaCamada = quantidade > 30 ? 11 : 9;
  const margemLateralPct = 12;
  const mix = MIX_MOEDAS[areaKey] || MIX_MOEDAS.CENTRAL;

  for (let i = 0; i < quantidade; i++) {
    const camada = Math.floor(i / moedasPorCamada);
    const posNaCamada = i % moedasPorCamada;

    const larguraUtil = 100 - 2 * margemLateralPct;
    const xBase = margemLateralPct + (posNaCamada + 0.5) * (larguraUtil / moedasPorCamada);
    const xJitter = randomBetween(-6, 6);
    const x = Math.max(margemLateralPct - 2, Math.min(100 - margemLateralPct + 2, xBase + xJitter));

    layout.push({
      x:     x,
      y:     6 + camada * alturaCamada + randomBetween(-2, 2),
      rot:   randomBetween(-180, 180),
      delay: i * COIN_STAGGER + randomBetween(0, COIN_JITTER),
      layer: camada * 10 + (i % 3),
      tipo:  pickPonderado(mix),
      size:  Math.random() < 0.15 ? 'coin--sm' : (Math.random() < 0.15 ? 'coin--lg' : '')
    });
  }
  return layout;
}

function renderMoedas(jarEl, quantidade, areaKey, delayBase = 0) {
  const container = jarEl.querySelector('.jar__coins');
  if (!container) return;
  container.innerHTML = '';

  const layout = calcularLayoutMoedas(quantidade, areaKey);

  layout.forEach((pos) => {
    const coin = document.createElement('div');
    coin.className = `coin coin--${pos.tipo} ${pos.size}`.trim();
    coin.style.setProperty('--rot', pos.rot + 'deg');
    coin.style.setProperty('--delay', (delayBase + pos.delay) + 'ms');
    coin.style.left = `calc(${pos.x}% - 11px)`;
    coin.style.bottom = pos.y + 'px';
    coin.style.zIndex = pos.layer;
    container.appendChild(coin);
  });
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
function render() {
  try {
    // --- Pote central + salário ---
    $('#salaryInput').value = estado.salario
      ? estado.salario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      : '';
    $('#centralValue').textContent = fmtBRL(estado.salario);

    const centralEl = document.querySelector('[data-jar="CENTRAL"]');
    if (centralEl) {
      if (estado.salario > 0) {
        renderMoedas(centralEl, MOEDAS_POR_AREA.CENTRAL, 'CENTRAL', 0);
      } else {
        centralEl.querySelector('.jar__coins').innerHTML = '';
      }
    }

    // Áreas começam a ser preenchidas DEPOIS que o pote central termina
    // (efeito de cascata visual: o líquido desce, distribui, enche os 3)
    const cascadeDelay = 900;

    // --- 3 áreas ---
    ['NECESSIDADES', 'DESEJOS', 'INVESTIMENTOS'].forEach(area => {
      const dados = estado.areas[area];
      if (!dados) {
        console.warn('Sem dados para área:', area);
        return;
      }

      const totalEl = document.getElementById('total' + area);
      if (totalEl) totalEl.textContent = fmtBRL(dados.valorTotal);

      const jarEl = document.querySelector(`[data-jar="${area}"]`);
      if (jarEl) {
        if (dados.valorTotal > 0) {
          renderMoedas(jarEl, MOEDAS_POR_AREA[area], area, cascadeDelay);
        } else {
          jarEl.querySelector('.jar__coins').innerHTML = '';
        }
      }

      const sub = document.getElementById('pots' + area);
      if (!sub) { console.warn('Container não encontrado: pots' + area); return; }
      sub.innerHTML = '';

      (dados.potes || [])
        .slice()
        .sort((a, b) => b.valor - a.valor)
        .forEach(p => sub.appendChild(criarLinhaPote(p)));
    });
  } catch (err) {
    console.error('[render] erro:', err);
    setStatus('Erro no render: ' + err.message, 'error');
  }
}

function criarLinhaPote(pote) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sub-row';
  btn.dataset.id = pote.id;

  const icone = pote.icone && String(pote.icone).trim()
    ? `<span class="sub-row__icon">${escapeHtml(pote.icone)}</span>`
    : `<span class="sub-row__icon"><span class="sub-row__icon--blank"></span></span>`;

  // Defensivo: garante que pctArea existe
  const pctArea = (typeof pote.pctArea === 'number') ? pote.pctArea : 0;
  const peso    = Number(pote.peso) || 0;
  const valor   = Number(pote.valor) || 0;

  btn.innerHTML = `
    ${icone}
    <span class="sub-row__main">
      <span class="sub-row__name">${escapeHtml(pote.nome || '(sem nome)')}</span>
      <span class="sub-row__meta">peso ${formatPeso(peso)} · ${pctArea.toFixed(1)}% da área</span>
    </span>
    <span class="sub-row__value">${fmtBRL(valor)}</span>
  `;

  btn.addEventListener('click', () => abrirModal(pote.area, pote));
  return btn;
}

function formatPeso(p) {
  return Number.isInteger(p) ? String(p) : Number(p).toFixed(1);
}

// ---------------------------------------------------------------------------
// MODAL
// ---------------------------------------------------------------------------
function abrirModal(area, pote = null) {
  const modal = $('#modal');
  modal.hidden = false;
  modal.dataset.area = area; // permite CSS colorir baseado na área
  $('#formArea').value = area;
  $('#modalSubtitle').textContent = area.charAt(0) + area.slice(1).toLowerCase();

  if (pote) {
    $('#modalTitle').textContent = 'Editar pote';
    $('#formId').value = pote.id;
    $('#formNome').value = pote.nome || '';
    $('#formPeso').value = pote.peso;
    $('#formIcone').value = pote.icone || '';
    $('#formDelete').hidden = false;
  } else {
    $('#modalTitle').textContent = 'Novo pote';
    $('#formId').value = '';
    $('#formNome').value = '';
    $('#formPeso').value = '1';
    $('#formIcone').value = '';
    $('#formDelete').hidden = true;
  }

  setTimeout(() => $('#formNome').focus(), 120);
}

function fecharModal() { $('#modal').hidden = true; }

async function submeterModal(e) {
  e.preventDefault();
  const id    = $('#formId').value;
  const nome  = $('#formNome').value.trim();
  const peso  = parseFloat($('#formPeso').value);
  const area  = $('#formArea').value;
  const icone = $('#formIcone').value.trim();

  if (!nome) { alert('Informe um nome.'); return; }
  if (!isFinite(peso) || peso <= 0) { alert('Peso deve ser positivo.'); return; }

  try {
    const resp = id
      ? await apiPost('updatePote', { id, nome, area, peso, icone })
      : await apiPost('addPote',    { nome, area, peso, icone });

    if (DEBUG) console.log('[submeter] resposta:', resp);

    estado = resp;
    fecharModal();
    render();
  } catch (err) {
    // Status já foi atualizado no apiPost; também loga aqui
    console.error('[submeterModal] falha:', err);
  }
}

async function excluirPote() {
  const id = $('#formId').value;
  if (!id || !confirm('Excluir este pote?')) return;
  try {
    const resp = await apiPost('deletePote', { id });
    estado = resp;
    fecharModal();
    render();
  } catch (err) {
    console.error('[excluirPote] falha:', err);
  }
}

// ---------------------------------------------------------------------------
// SALÁRIO
// ---------------------------------------------------------------------------
async function salvarSalario() {
  const valor = parseBRL($('#salaryInput').value);
  if (valor < 0) { alert('Valor inválido.'); return; }
  try {
    const resp = await apiPost('updateConfig', { SALARIO_BASE: valor });
    estado = resp;
    render();
  } catch (err) {
    console.error('[salvarSalario] falha:', err);
  }
}

// ---------------------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------------------
async function init() {
  $$('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => abrirModal(btn.dataset.add));
  });
  $$('[data-close]').forEach(el => el.addEventListener('click', fecharModal));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal').hidden) fecharModal();
  });
  $('#modalForm').addEventListener('submit', submeterModal);
  $('#formDelete').addEventListener('click', excluirPote);
  $('#salarySave').addEventListener('click', salvarSalario);
  $('#salaryInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') salvarSalario();
  });

  if (WEB_APP_URL.includes('COLE_AQUI')) {
    setStatus('Configure a URL do Apps Script em script.js', 'error');
    estado = recalcularLocal({
      salario: 5000,
      areas: {
        NECESSIDADES: { percentual: 0.50, valorTotal: 0, somaPesos: 0, potes: [
          { id: 'demo1', nome: 'Aluguel',         area: 'NECESSIDADES', peso: 3, icone: '🏠' },
          { id: 'demo2', nome: 'Mercado',         area: 'NECESSIDADES', peso: 2, icone: '🛒' },
          { id: 'demo3', nome: 'Contas básicas',  area: 'NECESSIDADES', peso: 1, icone: '💡' }
        ]},
        DESEJOS: { percentual: 0.30, valorTotal: 0, somaPesos: 0, potes: [
          { id: 'demo4', nome: 'Lazer',         area: 'DESEJOS', peso: 2, icone: '🎭' },
          { id: 'demo5', nome: 'Restaurantes',  area: 'DESEJOS', peso: 1, icone: '🍽️' }
        ]},
        INVESTIMENTOS: { percentual: 0.20, valorTotal: 0, somaPesos: 0, potes: [
          { id: 'demo6', nome: 'Reserva',       area: 'INVESTIMENTOS', peso: 2, icone: '🛟' },
          { id: 'demo7', nome: 'Aposentadoria', area: 'INVESTIMENTOS', peso: 3, icone: '🌱' }
        ]}
      }
    });
    render();
    return;
  }

  try {
    estado = await apiGet();
    render();
  } catch (err) {
    console.error('[init] falha ao carregar estado:', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
