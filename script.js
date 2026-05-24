/* ============================================================================
   CASCATA FINANCEIRA — Frontend
   Geração de moedas + comunicação com Apps Script.
   ============================================================================ */

// >>> Cole aqui a URL do seu Web App após o Deploy do Apps Script <<<
const WEB_APP_URL = 'https://script.google.com/macros/s/COLE_AQUI_SUA_URL/exec';

// Quantidades fixas de moedas por área — reforçam visualmente a regra 50/30/20.
// O front mostra sempre essa proporção; só os valores em R$ é que mudam.
const MOEDAS_POR_AREA = {
  NECESSIDADES: 25,
  DESEJOS:      15,
  INVESTIMENTOS: 10
};

// Duração da queda de cada moeda (deve casar com @keyframes coin-drop no CSS)
const COIN_FALL_MS  = 850;
const COIN_STAGGER  = 60;   // delay entre moedas
const COIN_JITTER   = 80;   // jitter aleatório para evitar perfeição mecânica

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
  // aceita "5.000,00", "5000.00", "5000"
  const limpo = String(str).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isFinite(n) ? n : 0;
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const setStatus = (msg, tipo = 'ok') => {
  const el = $('#statusMsg');
  el.textContent = msg;
  el.classList.remove('is-error', 'is-loading');
  if (tipo === 'error')   el.classList.add('is-error');
  if (tipo === 'loading') el.classList.add('is-loading');
};

const randomBetween = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------------------------------------------------------------------------
// Cálculo local (mesma fórmula do backend)
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
    if (!data.ok) throw new Error(data.error || 'Erro');
    setStatus('Pronto');
    return data;
  } catch (err) {
    setStatus('Falha: ' + err.message, 'error');
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
    if (!data.ok) throw new Error(data.error || 'Erro');
    setStatus('Sincronizado');
    return data;
  } catch (err) {
    setStatus('Falha: ' + err.message, 'error');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GERAÇÃO DE MOEDAS
// ---------------------------------------------------------------------------
/**
 * Calcula posição de cada moeda em camadas horizontais empilhadas.
 * Retorna array de { x, y, rot, delay, layer, tipo, size }.
 */
function calcularLayoutMoedas(quantidade) {
  const layout = [];
  const moedasPorCamada = 5;
  const alturaCamada = 9;    // px de altura entre camadas
  const margemLateralPct = 12; // % de margem nas laterais do pote

  for (let i = 0; i < quantidade; i++) {
    const camada = Math.floor(i / moedasPorCamada);
    const posNaCamada = i % moedasPorCamada;

    // Posição X: distribui na largura útil + jitter
    const larguraUtil = 100 - 2 * margemLateralPct;
    const xBase = margemLateralPct + (posNaCamada + 0.5) * (larguraUtil / moedasPorCamada);
    const xJitter = randomBetween(-6, 6);

    const x = Math.max(margemLateralPct - 2, Math.min(100 - margemLateralPct + 2, xBase + xJitter));

    layout.push({
      x:     x,                                    // % horizontal dentro do pote
      y:     6 + camada * alturaCamada + randomBetween(-2, 2), // px do fundo
      rot:   randomBetween(-180, 180),             // rotação inicial
      delay: i * COIN_STAGGER + randomBetween(0, COIN_JITTER),
      layer: camada * 10 + (i % 3),                // z-index para empilhamento
      tipo:  pick(['gold', 'silver', 'copper', 'gold', 'gold', 'silver']), // mais ouro
      size:  pick(['', '', '', 'coin--sm', 'coin--lg']) // maioria normal
    });
  }
  return layout;
}

function renderMoedas(jarEl, quantidade) {
  const container = jarEl.querySelector('.jar__coins');
  // Limpa moedas anteriores
  container.innerHTML = '';

  const layout = calcularLayoutMoedas(quantidade);

  layout.forEach((pos) => {
    const coin = document.createElement('div');
    coin.className = `coin coin--${pos.tipo} ${pos.size}`.trim();
    coin.style.setProperty('--rot', pos.rot + 'deg');
    coin.style.setProperty('--delay', pos.delay + 'ms');
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
  // Salário
  $('#salaryInput').value = estado.salario
    ? estado.salario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    : '';

  // Cada área
  ['NECESSIDADES', 'DESEJOS', 'INVESTIMENTOS'].forEach(area => {
    const dados = estado.areas[area];

    // Total da área no header
    $(`#total${area}`).textContent = fmtBRL(dados.valorTotal);

    // Jar: gera moedas se houver dinheiro, caso contrário esvazia
    const jarEl = document.querySelector(`[data-jar="${area}"]`);
    if (dados.valorTotal > 0) {
      renderMoedas(jarEl, MOEDAS_POR_AREA[area]);
    } else {
      jarEl.querySelector('.jar__coins').innerHTML = '';
    }

    // Sub-lista
    const sub = $(`#pots${area}`);
    sub.innerHTML = '';
    dados.potes
      .slice()
      .sort((a, b) => b.valor - a.valor) // maiores primeiro
      .forEach(p => sub.appendChild(criarLinhaPote(p)));
  });
}

function criarLinhaPote(pote) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sub-row';
  btn.dataset.id = pote.id;

  const iconeHtml = pote.icone
    ? `<span class="sub-row__icon">${escapeHtml(pote.icone)}</span>`
    : `<span class="sub-row__icon-blank-wrap"><span class="sub-row__icon--blank"></span></span>`;

  btn.innerHTML = `
    ${iconeHtml}
    <span class="sub-row__main">
      <span class="sub-row__name">${escapeHtml(pote.nome)}</span>
      <span class="sub-row__meta">peso ${formatPeso(pote.peso)} · ${pote.pctArea.toFixed(1)}% da área</span>
    </span>
    <span class="sub-row__value">${fmtBRL(pote.valor)}</span>
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
  $('#modal').hidden = false;
  $('#formArea').value = area;
  $('#modalSubtitle').textContent = area.charAt(0) + area.slice(1).toLowerCase();

  if (pote) {
    $('#modalTitle').textContent = 'Editar pote';
    $('#formId').value = pote.id;
    $('#formNome').value = pote.nome;
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
    estado = resp;
    fecharModal();
    render();
  } catch (_) {}
}

async function excluirPote() {
  const id = $('#formId').value;
  if (!id || !confirm('Excluir este pote?')) return;
  try {
    const resp = await apiPost('deletePote', { id });
    estado = resp;
    fecharModal();
    render();
  } catch (_) {}
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
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------------------
async function init() {
  // Listeners
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

  // Carrega
  if (WEB_APP_URL.includes('COLE_AQUI')) {
    setStatus('Configure a URL do Apps Script em script.js', 'error');
    // Demo offline
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
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', init);
