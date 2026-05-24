/* ============================================================================
   CASCATA FINANCEIRA — Frontend
   Comunicação com Apps Script + cálculo local + orquestração das animações.
   ============================================================================ */

// >>> Cole aqui a URL do seu Web App após o Deploy do Apps Script <<<
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbye94J0ETXEMku1xSCWCxpxkQi8H5Y9bnt7Lt2OdS4SrMho9yvRk_Msgy5gUWHtmwBU/exec';

// Tempo total da animação de preenchimento (deve coincidir com --dur-fill no CSS)
const FILL_DURATION_MS = 1400;
const STAGGER_DELAY_MS = 80; // delay entre potes da mesma área

// ---------------------------------------------------------------------------
// Estado em memória
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
// Utilitários
// ---------------------------------------------------------------------------
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const fmtBRL = (n) => {
  if (!isFinite(n)) n = 0;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2
  });
};

const parseBRL = (str) => {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  // aceita "5.000,00", "5000.00", "5000"
  const limpo = String(str).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isFinite(n) ? n : 0;
};

const setStatus = (msg, tipo = 'ok') => {
  const el = $('#statusMsg');
  el.textContent = msg;
  el.classList.remove('is-error', 'is-loading');
  if (tipo === 'error')   el.classList.add('is-error');
  if (tipo === 'loading') el.classList.add('is-loading');
};

// ---------------------------------------------------------------------------
// Cálculo local (mesma fórmula do backend, para preview ao vivo)
// ---------------------------------------------------------------------------
function recalcularLocal(estadoBase) {
  const salario = estadoBase.salario || 0;
  ['NECESSIDADES', 'DESEJOS', 'INVESTIMENTOS'].forEach(area => {
    const a = estadoBase.areas[area];
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
  return estadoBase;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function apiGet() {
  setStatus('Carregando…', 'loading');
  try {
    const r = await fetch(WEB_APP_URL, { method: 'GET' });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Erro desconhecido');
    return data;
  } catch (err) {
    setStatus('Falha ao carregar: ' + err.message, 'error');
    throw err;
  }
}

async function apiPost(action, payload) {
  setStatus('Salvando…', 'loading');
  try {
    // text/plain evita preflight CORS no Apps Script
    const r = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
      redirect: 'follow'
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Erro desconhecido');
    setStatus('Sincronizado.', 'ok');
    return data;
  } catch (err) {
    setStatus('Falha ao salvar: ' + err.message, 'error');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  // Salário no input + pote central
  $('#salaryInput').value = estado.salario
    ? estado.salario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    : '';
  $('#centralValue').textContent = fmtBRL(estado.salario);

  // Anima preenchimento do pote central
  // (preenche 100% pois ele "contém" todo o salário)
  const central = $('#centralPot');
  requestAnimationFrame(() => {
    central.style.setProperty('--fill', estado.salario > 0 ? '85%' : '0%');
  });

  // Renderiza cada área
  ['NECESSIDADES', 'DESEJOS', 'INVESTIMENTOS'].forEach(area => {
    const dados = estado.areas[area];
    $(`#total${area}`).textContent = fmtBRL(dados.valorTotal);

    const container = $(`#pots${area}`);
    container.innerHTML = '';

    // Para escalar o preenchimento visual de cada pote, usamos o MAIOR valor
    // da área como referência de "pote cheio" (100%). Assim, todos comparam
    // visualmente entre si dentro da área. Mínimo de 10% para potes ínfimos.
    const maxValor = Math.max(...dados.potes.map(p => p.valor), 1);

    dados.potes.forEach((pote, idx) => {
      const fillPct = Math.max(10, Math.round((pote.valor / maxValor) * 95));
      const el = criarElementoPote(pote, fillPct, idx);
      container.appendChild(el);
    });
  });
}

function criarElementoPote(pote, fillPct, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'pot';
  wrap.dataset.id = pote.id;
  wrap.dataset.area = pote.area;
  wrap.style.setProperty('--fill-delay', `${idx * STAGGER_DELAY_MS}ms`);

  wrap.innerHTML = `
    <div class="pot__jar">
      <div class="pot__lip"></div>
      <div class="pot__liquid" style="--fill: 0%;">
        <svg class="pot__wave" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,20 Q150,0 300,20 T600,20 L600,40 L0,40 Z" fill="currentColor" opacity="0.6">
            <animateTransform attributeName="transform" type="translate"
              from="0 0" to="-300 0" dur="${5 + idx}s" repeatCount="indefinite" />
          </path>
          <path d="M0,25 Q150,5 300,25 T600,25 L600,40 L0,40 Z" fill="currentColor" opacity="0.95">
            <animateTransform attributeName="transform" type="translate"
              from="-300 0" to="0 0" dur="${7 + idx}s" repeatCount="indefinite" />
          </path>
        </svg>
      </div>
      ${pote.icone ? `<div class="pot__icon">${pote.icone}</div>` : ''}
      <div class="pot__shine"></div>
      <div class="pot__value-inside">${fmtBRL(pote.valor)}</div>
    </div>
    <span class="pot__label">${escapeHtml(pote.nome)}</span>
    <span class="pot__meta">
      peso <strong>${formatPeso(pote.peso)}</strong> · ${pote.pctArea.toFixed(1)}% da área
    </span>
  `;

  // Click para editar
  wrap.addEventListener('click', () => abrirModal(pote.area, pote));

  // Dispara animação após inserir no DOM
  requestAnimationFrame(() => {
    setTimeout(() => {
      const liquid = wrap.querySelector('.pot__liquid');
      liquid.style.setProperty('--fill', fillPct + '%');
      liquid.style.height = fillPct + '%';
      // Marca como preenchido após a duração da animação (mostra o valor)
      setTimeout(() => wrap.classList.add('is-filled'),
        FILL_DURATION_MS + (idx * STAGGER_DELAY_MS));
    }, idx * STAGGER_DELAY_MS);
  });

  return wrap;
}

function formatPeso(p) {
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------------------------------------------------------------------------
// Modal (adicionar / editar pote)
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

  setTimeout(() => $('#formNome').focus(), 100);
}

function fecharModal() {
  $('#modal').hidden = true;
}

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
    let resp;
    if (id) {
      resp = await apiPost('updatePote', { id, nome, area, peso, icone });
    } else {
      resp = await apiPost('addPote', { nome, area, peso, icone });
    }
    estado = resp;
    fecharModal();
    render();
  } catch (_) { /* status já atualizado */ }
}

async function excluirPote() {
  const id = $('#formId').value;
  if (!id) return;
  if (!confirm('Excluir este pote?')) return;
  try {
    const resp = await apiPost('deletePote', { id });
    estado = resp;
    fecharModal();
    render();
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Atualização do salário
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
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
  // Botões "adicionar pote"
  $$('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => abrirModal(btn.dataset.add));
  });

  // Modal: fechar
  $$('[data-close]').forEach(el => el.addEventListener('click', fecharModal));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal').hidden) fecharModal();
  });

  // Modal: submit
  $('#modalForm').addEventListener('submit', submeterModal);
  $('#formDelete').addEventListener('click', excluirPote);

  // Salário
  $('#salarySave').addEventListener('click', salvarSalario);
  $('#salaryInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') salvarSalario();
  });

  // Carrega estado inicial
  if (WEB_APP_URL.includes('COLE_AQUI')) {
    setStatus('Configure a URL do Apps Script em script.js.', 'error');
    // Modo demo: carrega exemplo offline para visualizar a interface
    estado = recalcularLocal({
      salario: 5000,
      areas: {
        NECESSIDADES: { percentual: 0.50, valorTotal: 0, somaPesos: 0, potes: [
          { id: 'demo1', nome: 'Aluguel', area: 'NECESSIDADES', peso: 3, icone: '🏠' },
          { id: 'demo2', nome: 'Mercado', area: 'NECESSIDADES', peso: 2, icone: '🛒' },
          { id: 'demo3', nome: 'Contas',  area: 'NECESSIDADES', peso: 1, icone: '💡' }
        ]},
        DESEJOS: { percentual: 0.30, valorTotal: 0, somaPesos: 0, potes: [
          { id: 'demo4', nome: 'Lazer',        area: 'DESEJOS', peso: 2, icone: '🎭' },
          { id: 'demo5', nome: 'Restaurantes', area: 'DESEJOS', peso: 1, icone: '🍽️' }
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
    setStatus('Pronto.', 'ok');
    render();
  } catch (_) { /* status já tratado */ }
}

document.addEventListener('DOMContentLoaded', init);
