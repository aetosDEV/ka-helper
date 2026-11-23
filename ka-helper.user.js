// ==UserScript==
// @name         KA Helper — Auto Responder
// @namespace    https://github.com/aetosDEV/ka-helper
// @version      5.0.0
// @description  Responde automaticamente exercícios do Khan Academy
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
    const isVideo   = () => /\/v\//.test(location.pathname);
    const hasWidget = () => !!(
        $('[data-exercise-name]')         ||
        $('[class*="exercise-renderer"]') ||
        $('[class*="perseus"]')           ||
        $('div.perseus-root')             ||
        $('[class*="ExerciseCard"]')      ||
        /\/e\//.test(location.pathname)
    );
    const shouldShow = () => !isVideo() && hasWidget();

    /* ══════════════════════════════════════════
       REACT FIBER
    ══════════════════════════════════════════ */
    function getRootFiber() {
        for (const c of [
            document.getElementById('root'),
            document.querySelector('[data-reactroot]'),
            document.querySelector('#app'),
            document.body
        ]) {
            if (!c) continue;
            const k = Object.keys(c).find(k =>
                k.startsWith('__reactFiber') ||
                k.startsWith('__reactInternalInstance')
            );
            if (k) return c[k];
        }
        return null;
    }

    let pData = { radioChoices: null, numericAnswer: null, expressionForms: null };

    function scanFiber(node, depth = 500) {
        if (!node || depth <= 0) return;
        try {
            const props = node.memoizedProps || {};
            if (Array.isArray(props.choices) && props.choices.some(c => c && 'correct' in c))
                pData.radioChoices = props.choices;
            if (Array.isArray(props.answers) && props.answers.some(a => a?.status === 'correct'))
                pData.numericAnswer = props.answers.find(a => a.status === 'correct');
            if (Array.isArray(props.answerForms) && props.answerForms.length)
                pData.expressionForms = props.answerForms;

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
       FILL INPUT — TRIPLA ESTRATÉGIA
       (React onChange direto + execCommand + native setter)
    ══════════════════════════════════════════ */
    async function fillInput(input, value) {
        const str = String(value).trim();

        // 1. Foca e seleciona tudo
        input.focus();
        await sleep(80);
        input.select();
        document.execCommand('selectAll', false, null);

        // 2. execCommand — mais compatível com React controlled inputs
        const ok = document.execCommand('insertText', false, str);

        // 3. Se execCommand falhou ou o valor está diferente, força via native setter
        if (!ok || input.value !== str) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, str);
            input.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
            input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        }

        // 4. Chama React onChange direto via fiber (mais confiável no React 18)
        const fk = Object.keys(input).find(k =>
            k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
        );
        if (fk) {
            let node = input[fk];
            while (node) {
                const onChange = node.memoizedProps?.onChange;
                if (onChange) {
                    try { onChange({ target: { value: str }, currentTarget: { value: str } }); }
                    catch (_) {}
                    break;
                }
                node = node.return;
            }
        }

        await sleep(150);
        return input.value === str;
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
            await sleep(750);
        }
        await sleep(600);
    }

    /* ══════════════════════════════════════════
       EXTRAIR RESPOSTA DO TEXTO DAS DICAS
    ══════════════════════════════════════════ */
    function extractFromHints() {
        // Pega todos os containers de dica, do último pro primeiro
        const containers = $$(
            '[class*="hint"], [data-testid*="hint"], ' +
            '.perseus-hint-renderer, [class*="Hint"]'
        ).reverse();

        const patterns = [
            // "= 56", "= 3,5", "= −2"
            /=\s*([-−]?\d+(?:[.,]\d+)?(?:\/\d+)?)\s*(?:cm|m|g|kg|°|%|²|³|\\u00b2|\\u00b3)?\s*$/,
            // "56 cm³" standalone no final
            /(?:^|\n|\s)([-−]?\d+(?:[.,]\d+)?)\s*(?:cm³|m³|cm²|m²|cm|m)\s*$/,
            // "resposta: 56" ou "answer: 56"
            /(?:resposta|answer|resultado|=)\s*:?\s*([-−]?\d+(?:[.,]\d+)?(?:\/\d+)?)\s*$/i,
            // qualquer número isolado no final da última dica
            /\b([-−]?\d+(?:[.,]\d+)?)\s*$/,
        ];

        for (const container of containers) {
            const text = container.textContent.trim();
            for (const pattern of patterns) {
                const m = text.match(pattern);
                if (m) {
                    const val = m[1]
                        .replace(',', '.')
                        .replace('−', '-')
                        .trim();
                    // Ignora números que são dimensões da figura (geralmente pequenos como 2,4,7)
                    if (parseFloat(val) > 0) return val;
                }
            }
        }
        return null;
    }

    /* ══════════════════════════════════════════
       DETECTAR TIPO DE QUESTÃO
    ══════════════════════════════════════════ */
    function getQuestionType() {
        if ($$('[role="radio"], [role="checkbox"], [data-testid*="choice"], [class*="answer-choice"]').length > 0)
            return 'radio';
        if ($('input[type="text"], input[type="number"], [class*="expression-input"], [class*="math-input"]'))
            return 'input';
        return 'unknown';
    }

    function getInputEl() {
        return $(
            'input[type="text"], input[type="number"], ' +
            '[class*="expression-input"], [class*="math-input"], ' +
            '[class*="perseus-input"] input, .perseus-widget-input-number input'
        );
    }

    /* ══════════════════════════════════════════
       BOTÕES DO KA
    ══════════════════════════════════════════ */
    function clickCheck() {
        const btn = $(
            '[data-testid="check-answer-button"], [data-testid="submit-button"], ' +
            'button[class*="check" i], button[class*="submit" i], ' +
            '[aria-label*="Check" i], [aria-label*="Verificar" i], [aria-label*="Checar" i]'
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
        setStatus('Detectando...');
        refreshData();

        const qType = getQuestionType();
        setStatus(`Tipo: ${qType}`);
        await sleep(300);

        /* ── MÚLTIPLA ESCOLHA ── */
        if (qType === 'radio') {
            // Estratégia A: fiber com correct:true
            if (pData.radioChoices) {
                const idx = pData.radioChoices.findIndex(c => c?.correct === true);
                if (idx !== -1) {
                    const els = $$(
                        '[role="radio"], [role="checkbox"], ' +
                        '[data-testid*="choice"], [class*="answer-choice"], ' +
                        '[class*="perseus-radio-option"], [class*="RadioOption"]'
                    );
                    if (els[idx]) {
                        setStatus(`Opção ${idx + 1} ✓`);
                        els[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
                        await sleep(250);
                        els[idx].click();
                        await sleep(400);
                        clickCheck();
                        setStatus('✓ Correta!');
                        return;
                    }
                }
            }

            // Estratégia B: drain de dicas → opção destacada pós-dica
            setStatus('Dicas (radio)...');
            await drainHints();
            const highlighted = $(
                '[class*="correct"], [data-correct="true"], ' +
                '[class*="answer--correct"], [class*="answerCorrect"]'
            );
            if (highlighted) { highlighted.click(); await sleep(300); }
            clickCheck();
            setStatus('✓ Enviada');
            return;
        }

        /* ── INPUT NUMÉRICO / EXPRESSÃO ── */
        if (qType === 'input') {
            // Estratégia A: fiber com numeric answer
            if (pData.numericAnswer?.value !== undefined) {
                const val = pData.numericAnswer.value;
                const inp = getInputEl();
                if (inp) {
                    setStatus(`Fiber: ${val}`);
                    await fillInput(inp, val);
                    await sleep(400);
                    if (inp.value === String(val)) {
                        clickCheck();
                        setStatus('✓ Correta!');
                        return;
                    }
                }
            }

            // Estratégia B: expression fiber
            if (pData.expressionForms?.length) {
                const form = pData.expressionForms.find(f => f.considered === 'correct' || f.value);
                if (form?.value) {
                    const inp = getInputEl();
                    if (inp) {
                        setStatus(`Expr: ${form.value}`);
                        await fillInput(inp, form.value);
                        await sleep(400);
                        clickCheck();
                        setStatus('✓ Correta!');
                        return;
                    }
                }
            }

            // Estratégia C: drain dicas + extrair + preencher
            setStatus('Usando dicas...');
            await drainHints();

            // Re-scan após dicas (Perseus às vezes atualiza o fiber)
            refreshData();
            if (pData.numericAnswer?.value !== undefined) {
                const val = pData.numericAnswer.value;
                const inp = getInputEl();
                if (inp) {
                    setStatus(`Pós-dica fiber: ${val}`);
                    await fillInput(inp, val);
                    await sleep(400);
                    clickCheck();
                    setStatus('✓ Correta!');
                    return;
                }
            }

            const hintVal = extractFromHints();
            const inp = getInputEl();
            if (inp && hintVal) {
                setStatus(`Dica: ${hintVal}`);
                await fillInput(inp, hintVal);
                await sleep(500);

                // Verifica se preencheu antes de submeter
                if (inp.value && inp.value.trim() !== '') {
                    clickCheck();
                    setStatus('✓ Correta!');
                    return;
                }

                // Se ainda vazio, tenta Enter no input
                inp.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', keyCode: 13, bubbles: true
                }));
                await sleep(300);
                clickCheck();
                setStatus('✓ Enviada');
                return;
            }

            // Estratégia D: input estava vazio, tenta submeter (às vezes KA pré-preenche)
            clickCheck();
            setStatus('Verificando...');
            return;
        }

        /* ── TIPO DESCONHECIDO ── */
        setStatus('Dicas (fallback)...');
        await drainHints();
        clickCheck();
        setStatus('✓ Enviada');
    }

    /* ══════════════════════════════════════════
       INCORRETA / PRÓXIMO
    ══════════════════════════════════════════ */
    async function handleIncorrect() {
        setStatus('Enviando errada...');
        const choices = $$('[role="radio"], [role="checkbox"], [data-testid*="choice"]');
        if (choices.length > 1) choices[choices.length - 1].click();
        else if (choices.length === 1) choices[0].click();
        else {
            const inp = getInputEl();
            if (inp) await fillInput(inp, '0');
        }
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
    const ID = 'ka-helper-v5';
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
                width: 175px; display: flex !important; flex-direction: column;
                gap: 9px; box-shadow: 0 8px 40px rgba(0,0,0,.85);
                font-family: ui-sans-serif, system-ui, sans-serif; user-select: none;
            }
            #${ID}-title  { font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#484f58; text-align:center; }
            #${ID}-status { font-size:11px; color:#58a6ff; text-align:center; min-height:14px; word-break:break-all; }
            #${ID} button { border:none; border-radius:9px; padding:10px 0; font-size:13px; font-weight:600; cursor:pointer; transition:opacity .15s, transform .1s; }
            #${ID} button:hover  { opacity:.85; transform:translateY(-1px); }
            #${ID} button:active { opacity:1;   transform:translateY(0);    }
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

    [1500, 3000, 5000].forEach(d =>
        setTimeout(() => { if (shouldShow()) createPanel(); }, d)
    );
    startScan(25000);
})();
