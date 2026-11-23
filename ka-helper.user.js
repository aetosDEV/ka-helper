// ==UserScript==
// @name         KA Helper — Auto Responder
// @namespace    https://github.com/aetosDEV/ka-helper
// @version      4.0.0
// @description  Encontra e submete a resposta correta automaticamente
// @author       ENI
// @match        https://*.khanacademy.org/*
// @match        https://khanacademy.org/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /* ══════════════════════════════════════════
       DETECÇÃO DE PÁGINA
    ══════════════════════════════════════════ */
    const isVideo    = () => /\/v\//.test(location.pathname);
    const hasWidget  = () => !!(
        $('[data-exercise-name]')         ||
        $('[class*="exercise-renderer"]') ||
        $('[class*="perseus"]')           ||
        $('div.perseus-root')             ||
        $('[class*="ExerciseCard"]')      ||
        /\/e\//.test(location.pathname)
    );
    const shouldShow = () => !isVideo() && hasWidget();

    /* ══════════════════════════════════════════
       REACT FIBER — SCAN COMPLETO DA ÁRVORE
    ══════════════════════════════════════════ */
    function getRootFiber() {
        const roots = [
            document.getElementById('root'),
            document.querySelector('[data-reactroot]'),
            document.querySelector('#app'),
            document.body
        ];
        for (const c of roots) {
            if (!c) continue;
            const k = Object.keys(c).find(k =>
                k.startsWith('__reactFiber') ||
                k.startsWith('__reactInternalInstance')
            );
            if (k) return c[k];
        }
        return null;
    }

    // Dados Perseus descobertos na última varredura
    let pData = { radioChoices: null, numericAnswer: null, expressionForms: null };

    function scanFiber(node, depth = 500) {
        if (!node || depth <= 0) return;
        try {
            const props = node.memoizedProps || {};

            // Radio / múltipla escolha — choices[] com correct:true
            if (Array.isArray(props.choices) && props.choices.some(c => c && 'correct' in c))
                pData.radioChoices = props.choices;

            // Numeric input — answers[] com status:'correct'
            if (Array.isArray(props.answers) && props.answers.some(a => a?.status === 'correct'))
                pData.numericAnswer = props.answers.find(a => a.status === 'correct');

            // Expression widget — answerForms[]
            if (Array.isArray(props.answerForms) && props.answerForms.length)
                pData.expressionForms = props.answerForms;

            // State hooks (algumas versões guardam choices no estado)
            let hook = node.memoizedState;
            while (hook) {
                const ms = hook.memoizedState;
                if (ms && Array.isArray(ms.choices) && ms.choices.some(c => c && 'correct' in c))
                    pData.radioChoices = ms.choices;
                hook = hook.next;
            }
        } catch (_) {}

        scanFiber(node.child,   depth - 1);
        scanFiber(node.sibling, depth - 1);
    }

    function refreshData() {
        pData = { radioChoices: null, numericAnswer: null, expressionForms: null };
        const root = getRootFiber();
        if (root) scanFiber(root);
    }

    /* ══════════════════════════════════════════
       PREENCHER INPUT COM EVENTO REACT
    ══════════════════════════════════════════ */
    function fillInput(input, value) {
        try {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, String(value));
            ['input', 'change'].forEach(ev =>
                input.dispatchEvent(new Event(ev, { bubbles: true }))
            );
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
            input.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: 'Enter', keyCode: 13 }));
            return true;
        } catch (_) { return false; }
    }

    /* ══════════════════════════════════════════
       DRAIN DE DICAS
    ══════════════════════════════════════════ */
    async function drainHints(max = 15) {
        for (let i = 0; i < max; i++) {
            const btn = $(
                '[data-testid="hint-button"], [aria-label*="hint" i], ' +
                '[aria-label*="dica" i], button[class*="hint" i]'
            );
            if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') break;
            btn.click();
            await sleep(700);
        }
        await sleep(500);
    }

    /* ══════════════════════════════════════════
       EXTRAIR RESPOSTA DO TEXTO DAS DICAS
    ══════════════════════════════════════════ */
    function extractFromHints() {
        const blocks = $$(
            '[class*="hint"] span, [class*="Hint"] span, ' +
            '[data-testid*="hint"] span, .perseus-hint-renderer span'
        ).reverse();

        for (const el of blocks) {
            const t = el.textContent.trim();
            // "= 42", "= -3,5", "= 2/3"
            const m = t.match(/=\s*([-−]?\d+[.,]?\d*(?:\/\d+)?)\s*$/);
            if (m) return m[1].replace(',', '.').replace('−', '-');
        }
        return null;
    }

    /* ══════════════════════════════════════════
       BOTÕES DO KA
    ══════════════════════════════════════════ */
    function clickCheck() {
        const btn = $(
            '[data-testid="check-answer-button"], [data-testid="submit-button"], ' +
            'button[class*="check" i], button[class*="submit" i], ' +
            '[aria-label*="Check" i], [aria-label*="Verificar" i]'
        );
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
    }

    function clickNext() {
        const btn = $(
            '[data-testid="next-button"], [data-testid="continue-button"], ' +
            'button[class*="next" i], button[class*="continue" i], ' +
            '[aria-label*="Next" i], [aria-label*="Próximo" i], [aria-label*="Continuar" i]'
        );
        if (btn) { btn.click(); return true; }
        return false;
    }

    /* ══════════════════════════════════════════
       FLUXO PRINCIPAL — CORRETA
    ══════════════════════════════════════════ */
    async function handleCorrect() {
        setStatus('Analisando...');
        refreshData();

        // ── ESTRATÉGIA 1: Múltipla escolha via Perseus fiber ──
        if (pData.radioChoices) {
            const idx = pData.radioChoices.findIndex(c => c?.correct === true);
            if (idx !== -1) {
                const els = $$(
                    '[role="radio"], [role="checkbox"], ' +
                    '[data-testid*="choice"], [class*="answer-choice"], ' +
                    '[class*="perseus-radio-option"], [class*="RadioOption"]'
                );
                const target = els[idx];
                if (target) {
                    setStatus(`Opção ${idx + 1} ✓`);
                    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await sleep(250);
                    target.click();
                    await sleep(400);
                    clickCheck();
                    setStatus('✓ Correta!');
                    return;
                }
            }
        }

        // ── ESTRATÉGIA 2: Input numérico via Perseus fiber ──
        if (pData.numericAnswer?.value !== undefined) {
            const val = pData.numericAnswer.value;
            const inputs = $$('input[type="text"], input[type="number"], [class*="perseus-input"]');
            if (inputs.length) {
                setStatus(`Digitando ${val}...`);
                fillInput(inputs[0], val);
                await sleep(500);
                clickCheck();
                setStatus('✓ Correta!');
                return;
            }
        }

        // ── ESTRATÉGIA 3: Expression widget via fiber ──
        if (pData.expressionForms?.length) {
            const form = pData.expressionForms.find(f => f.value || f.considered === 'correct');
            if (form?.value) {
                const inputs = $$('input[type="text"], [class*="expression-input"], [class*="math-input"]');
                if (inputs.length) {
                    setStatus(`Expressão: ${form.value}`);
                    fillInput(inputs[0], form.value);
                    await sleep(500);
                    clickCheck();
                    setStatus('✓ Correta!');
                    return;
                }
            }
        }

        // ── ESTRATÉGIA 4: Drain de dicas + extração ──
        setStatus('Usando dicas...');
        await drainHints();

        // Tenta preencher input com resposta extraída das dicas
        const hintVal = extractFromHints();
        const inputs = $$('input[type="text"], input[type="number"], [class*="expression-input"]');
        if (inputs.length && hintVal) {
            setStatus(`Dica: ${hintVal}`);
            fillInput(inputs[0], hintVal);
            await sleep(400);
            clickCheck();
            setStatus('✓ Enviada');
            return;
        }

        // ── ESTRATÉGIA 5: Resposta destacada pós-dicas ──
        const highlighted = $(
            '[class*="correct"], [data-correct="true"], ' +
            '[class*="answer--correct"], [class*="answerCorrect"], ' +
            '[class*="choice-correct"]'
        );
        if (highlighted) { highlighted.click(); await sleep(300); }

        clickCheck();
        setStatus('✓ Enviada');
    }

    async function handleIncorrect() {
        setStatus('Enviando errada...');
        const choices = $$('[role="radio"], [role="checkbox"], [data-testid*="choice"]');
        if (choices.length > 1) choices[choices.length - 1].click();
        else if (choices.length === 1) choices[0].click();
        await sleep(200);
        clickCheck();
        setStatus('✗ Incorreta');
    }

    async function handleNext() {
        setStatus('Próximo...');
        if (!clickNext()) { clickCheck(); await sleep(900); clickNext(); }
        setStatus('▶ Pronto');
    }

    /* ══════════════════════════════════════════
       UI
    ══════════════════════════════════════════ */
    const ID = 'ka-helper-v4';
    let statusEl = null;
    const setStatus = msg => { if (statusEl) statusEl.textContent = msg; };

    function createPanel() {
        if ($(`#${ID}`)) return;

        const style = document.createElement('style');
        style.textContent = `
            #${ID} {
                position: fixed !important; bottom: 28px !important; right: 28px !important;
                z-index: 2147483647 !important; background: #0d1117;
                border: 1px solid #21262d; border-radius: 14px; padding: 16px;
                width: 170px; display: flex !important; flex-direction: column;
                gap: 9px; box-shadow: 0 8px 40px rgba(0,0,0,.85);
                font-family: ui-sans-serif, system-ui, sans-serif; user-select: none;
            }
            #${ID}-title  { font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#484f58; text-align:center; }
            #${ID}-status { font-size:12px; color:#58a6ff; text-align:center; min-height:15px; }
            #${ID} button { border:none; border-radius:9px; padding:10px 0; font-size:13px; font-weight:600; cursor:pointer; transition:opacity .15s, transform .1s; }
            #${ID} button:hover  { opacity:.85; transform:translateY(-1px); }
            #${ID}-correct   { background:#238636; color:#fff; }
            #${ID}-incorrect { background:#b91c1c; color:#fff; }
            #${ID}-next      { background:#1d4ed8; color:#fff; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = ID;
        panel.innerHTML = `
            <div id="${ID}-title">KA Helper</div>
            <div id="${ID}-status">Pronto</div>
            <button id="${ID}-correct">✅ Correta</button>
            <button id="${ID}-incorrect">❌ Incorreta</button>
            <button id="${ID}-next">▶ Próximo</button>
        `;
        document.body.appendChild(panel);
        statusEl = $(`#${ID}-status`);
        $(`#${ID}-correct`).addEventListener('click', handleCorrect);
        $(`#${ID}-incorrect`).addEventListener('click', handleIncorrect);
        $(`#${ID}-next`).addEventListener('click', handleNext);
    }

    function removePanel() {
        const p = $(`#${ID}`);
        if (p) { p.remove(); statusEl = null; }
    }

    /* ══════════════════════════════════════════
       WATCHER
    ══════════════════════════════════════════ */
    let lastHref = location.href, scanTimer = null;

    function startScan(dur = 25000) {
        clearInterval(scanTimer);
        const end = Date.now() + dur;
        scanTimer = setInterval(() => {
            shouldShow() ? createPanel() : removePanel();
            if (Date.now() > end) clearInterval(scanTimer);
        }, 1500);
    }

    new MutationObserver(() => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            removePanel();
            startScan();
        }
    }).observe(document.body, { childList: true, subtree: true });

    [1500, 3000, 5000].forEach(d => setTimeout(() => { if (shouldShow()) createPanel(); }, d));
    startScan(25000);
})();
