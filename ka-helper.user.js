// ==UserScript==
// @name         KA Helper — Correta / Incorreta / Próximo
// @namespace    https://github.com/aetosDEV/ka-helper
// @version      3.0.0
// @description  Painel flutuante nos exercícios do Khan Academy (PT + EN)
// @author       ENI
// @match        https://*.khanacademy.org/*
// @match        https://khanacademy.org/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const $  = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /* ══════════════════════════════════════
       DETECÇÃO
    ══════════════════════════════════════ */
    function isVideo() {
        return /\/v\//.test(location.pathname);
    }

    function hasExerciseWidget() {
        return !!(
            $('[data-exercise-name]')                   ||
            $('[class*="exercise-renderer"]')           ||
            $('[data-testid*="exercise"]')              ||
            $('[class*="ExerciseCard"]')                ||
            $('[class*="perseus"]')                     ||
            $('div[class*="problem-and-hints"]')        ||
            $('div[class*="framework-perseus"]')        ||
            $('[data-testid="exercise-card-content"]')  ||
            $('div.perseus-root')
        );
    }

    function shouldShow() {
        if (isVideo()) return false;
        if (/\/e\//.test(location.pathname)) return true;
        if (hasExerciseWidget()) return true;
        return false;
    }

    /* ══════════════════════════════════════
       REACT FIBER
    ══════════════════════════════════════ */
    function getFiber(el) {
        const k = Object.keys(el).find(k =>
            k.startsWith('__reactFiber') ||
            k.startsWith('__reactInternalInstance')
        );
        return k ? el[k] : null;
    }

    function walkFiber(node, depth = 80) {
        if (!node || depth <= 0) return null;
        const p = node.memoizedProps ?? node.pendingProps ?? {};
        if (p.correct === true || p.isCorrect === true || p.checked === true) return node;
        return walkFiber(node.child, depth - 1) ?? walkFiber(node.sibling, depth - 1);
    }

    function findCorrectViaFiber() {
        const els = $$(
            '[role="radio"], [role="checkbox"], ' +
            '[data-testid*="choice"], [data-testid*="answer"], ' +
            '[class*="answer-choice"], [class*="choice-icon"], ' +
            '[class*="radio-button"]'
        );
        for (const el of els) {
            try {
                const fiber = getFiber(el);
                if (!fiber) continue;
                if (walkFiber(fiber)) return el;
            } catch (_) {}
        }
        return null;
    }

    /* ══════════════════════════════════════
       INTERAÇÃO
    ══════════════════════════════════════ */
    async function drainHints(max = 12) {
        for (let i = 0; i < max; i++) {
            const btn = $(
                '[data-testid="hint-button"], ' +
                '[aria-label*="hint" i], ' +
                '[aria-label*="dica" i], ' +
                'button[class*="hint"], button[class*="Hint"]'
            );
            if (!btn || btn.disabled) break;
            btn.click();
            await sleep(650);
        }
        await sleep(400);
    }

    function clickCheck() {
        const btn = $(
            '[data-testid="check-answer-button"], ' +
            '[data-testid="submit-button"], ' +
            'button[class*="check"], button[class*="Check"], ' +
            'button[class*="submit"], button[class*="Submit"], ' +
            '[aria-label*="Check" i], [aria-label*="Verificar" i], ' +
            '[aria-label*="Checar" i]'
        );
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
    }

    function clickNext() {
        const btn = $(
            '[data-testid="next-button"], ' +
            '[data-testid="continue-button"], ' +
            'button[class*="next"], button[class*="Next"], ' +
            'button[class*="continue"], button[class*="Continue"], ' +
            '[aria-label*="Next" i], [aria-label*="Continue" i], ' +
            '[aria-label*="Próximo" i], [aria-label*="Continuar" i]'
        );
        if (btn) { btn.click(); return true; }
        return false;
    }

    function pickWrong() {
        const choices = $$(
            '[role="radio"], [role="checkbox"], ' +
            '[data-testid*="choice"], [class*="answer-choice"]'
        );
        if (choices.length > 1) { choices[choices.length - 1].click(); return true; }
        if (choices.length === 1) { choices[0].click(); return true; }
        return false;
    }

    /* ══════════════════════════════════════
       FLUXOS
    ══════════════════════════════════════ */
    async function handleCorrect() {
        setStatus('Buscando...');

        const fiberEl = findCorrectViaFiber();
        if (fiberEl) {
            fiberEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(200);
            fiberEl.click();
            await sleep(300);
            clickCheck();
            setStatus('✓ Correta');
            return;
        }

        setStatus('Usando dicas...');
        await drainHints();

        const highlighted = $(
            '[class*="correct"], [data-correct="true"], ' +
            '[class*="answer--correct"], [class*="answerCorrect"]'
        );
        if (highlighted) { highlighted.click(); await sleep(200); }

        clickCheck();
        setStatus('✓ Enviada');
    }

    async function handleIncorrect() {
        setStatus('Enviando...');
        pickWrong();
        await sleep(200);
        clickCheck();
        setStatus('✗ Incorreta');
    }

    async function handleNext() {
        setStatus('Avançando...');
        if (!clickNext()) {
            clickCheck();
            await sleep(900);
            clickNext();
        }
        setStatus('Pronto ▶');
    }

    /* ══════════════════════════════════════
       UI
    ══════════════════════════════════════ */
    const PANEL_ID = 'ka-helper-v3';
    let statusEl = null;

    function setStatus(msg) {
        if (statusEl) statusEl.textContent = msg;
    }

    function createPanel() {
        if ($(`#${PANEL_ID}`)) return;

        const style = document.createElement('style');
        style.textContent = `
            #${PANEL_ID} {
                position: fixed !important;
                bottom: 28px !important;
                right: 28px !important;
                z-index: 2147483647 !important;
                background: #0d1117;
                border: 1px solid #21262d;
                border-radius: 14px;
                padding: 16px;
                width: 170px;
                display: flex !important;
                flex-direction: column;
                gap: 9px;
                box-shadow: 0 8px 40px rgba(0,0,0,.8);
                font-family: ui-sans-serif, system-ui, sans-serif;
                user-select: none;
            }
            #ka-h3-title {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: .1em;
                text-transform: uppercase;
                color: #484f58;
                text-align: center;
            }
            #ka-h3-status {
                font-size: 12px;
                color: #58a6ff;
                text-align: center;
                min-height: 15px;
            }
            #${PANEL_ID} button {
                border: none;
                border-radius: 9px;
                padding: 10px 0;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: opacity .15s, transform .1s;
            }
            #${PANEL_ID} button:hover  { opacity:.85; transform:translateY(-1px); }
            #${PANEL_ID} button:active { opacity:1;   transform:translateY(0);    }
            #ka-h3-correct   { background:#238636; color:#fff; }
            #ka-h3-incorrect { background:#b91c1c; color:#fff; }
            #ka-h3-next      { background:#1d4ed8; color:#fff; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div id="ka-h3-title">KA Helper</div>
            <div id="ka-h3-status">Pronto</div>
            <button id="ka-h3-correct">✅ Correta</button>
            <button id="ka-h3-incorrect">❌ Incorreta</button>
            <button id="ka-h3-next">▶ Próximo</button>
        `;
        document.body.appendChild(panel);

        statusEl = $('#ka-h3-status');
        $('#ka-h3-correct').addEventListener('click', handleCorrect);
        $('#ka-h3-incorrect').addEventListener('click', handleIncorrect);
        $('#ka-h3-next').addEventListener('click', handleNext);
    }

    function removePanel() {
        const p = $(`#${PANEL_ID}`);
        if (p) { p.remove(); statusEl = null; }
    }

    /* ══════════════════════════════════════
       WATCHER
    ══════════════════════════════════════ */
    function checkPage() {
        if (shouldShow()) createPanel();
        else removePanel();
    }

    let lastHref = location.href;
    let scanTimer = null;

    // Varre o DOM a cada 1.5s por até 15s após navegação
    function startScan(duration = 15000) {
        clearInterval(scanTimer);
        const end = Date.now() + duration;
        scanTimer = setInterval(() => {
            checkPage();
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

    // Check inicial com múltiplos delays (KA carrega lento)
    setTimeout(checkPage, 1500);
    setTimeout(checkPage, 3000);
    setTimeout(checkPage, 5000);
    startScan(20000);

})();
