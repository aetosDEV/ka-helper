// ==UserScript==
// @name         KA Helper — Correta / Incorreta / Próximo
// @namespace    https://github.com/SEU_USUARIO/ka-helper
// @version      2.1.0
// @description  Painel flutuante nos exercícios do Khan Academy. Vídeos ignorados automaticamente.
// @author       ENI
// @match        https://www.khanacademy.org/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* ═══════════════════════════════════════════
       UTILS
    ═══════════════════════════════════════════ */
    const $  = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /* ═══════════════════════════════════════════
       DETECÇÃO DE PÁGINA
    ═══════════════════════════════════════════ */
    function isVideo() {
        return /\/v\//.test(location.href);
    }

    function isExercise() {
        if (/\/e\//.test(location.href)) return true;
        if (/[?&]q=/.test(location.href) && location.href.includes('khanacademy')) return true;
        // Widget de exercício embutido em página de lição
        return !!$('[data-exercise-name], [class*="exercise-renderer"], [data-testid*="exercise"]');
    }

    /* ═══════════════════════════════════════════
       REACT FIBER — leitura de estado interno
    ═══════════════════════════════════════════ */
    function getFiber(el) {
        if (!el) return null;
        const k = Object.keys(el).find(k =>
            k.startsWith('__reactFiber') ||
            k.startsWith('__reactInternalInstance')
        );
        return k ? el[k] : null;
    }

    function walkFiber(node, depth = 60) {
        if (!node || depth <= 0) return null;
        const p = node.memoizedProps ?? node.pendingProps ?? {};
        if (p.correct === true || p.isCorrect === true) return node;
        return walkFiber(node.child, depth - 1)
            ?? walkFiber(node.sibling, depth - 1);
    }

    function findCorrectViaFiber() {
        const candidates = $$(
            '[role="radio"], [role="checkbox"], [data-testid*="choice"], [class*="answer-choice"], [class*="radio-button"]'
        );
        for (const el of candidates) {
            const fiber = getFiber(el);
            if (!fiber) continue;
            const hit = walkFiber(fiber);
            if (hit) return el;
        }
        return null;
    }

    /* ═══════════════════════════════════════════
       HINT CHAIN — fallback universal
    ═══════════════════════════════════════════ */
    async function drainHints(max = 10) {
        for (let i = 0; i < max; i++) {
            const btn = $(
                '[data-testid="hint-button"], ' +
                '[aria-label*="hint" i], ' +
                'button[class*="hint"], ' +
                'button[class*="Hint"]'
            );
            if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') break;
            btn.click();
            await sleep(700);
        }
        await sleep(400);
    }

    /* ═══════════════════════════════════════════
       INTERAÇÃO COM KA
    ═══════════════════════════════════════════ */
    function clickCheck() {
        const btn = $(
            '[data-testid="check-answer-button"], ' +
            'button[class*="check"], ' +
            'button[class*="Check"], ' +
            'button[class*="submit"], ' +
            '[aria-label*="Check" i], ' +
            '[aria-label*="Verificar" i]'
        );
        if (btn && !btn.disabled) { btn.click(); return true; }
        return false;
    }

    function clickNext() {
        const btn = $(
            '[data-testid="next-button"], ' +
            'button[class*="next"], ' +
            'button[class*="Next"], ' +
            'button[class*="continue"], ' +
            '[aria-label*="Next" i], ' +
            '[aria-label*="Continue" i], ' +
            '[aria-label*="Próximo" i]'
        );
        if (btn) { btn.click(); return true; }
        return false;
    }

    function pickWrongAnswer() {
        const choices = $$(
            '[role="radio"], [role="checkbox"], [data-testid*="choice"]'
        );
        // Pega o último — geralmente é errado o suficiente
        if (choices.length > 1) {
            choices[choices.length - 1].click();
            return true;
        }
        if (choices.length === 1) {
            choices[0].click();
            return true;
        }
        return false;
    }

    /* ═══════════════════════════════════════════
       FLUXOS DOS BOTÕES
    ═══════════════════════════════════════════ */
    async function handleCorrect() {
        setStatus('Buscando...');

        // Estratégia 1 — React fiber
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

        // Estratégia 2 — hint chain + checar elemento destacado pós-dica
        setStatus('Dicas...');
        await drainHints();

        const highlighted = $(
            '[class*="correct-label"], ' +
            '[data-correct="true"], ' +
            '[class*="answer--correct"], ' +
            '[aria-selected="true"][class*="answer"]'
        );
        if (highlighted) {
            highlighted.click();
            await sleep(200);
        }

        // Para inputs de expressão as dicas já preenchem — só verificar
        clickCheck();
        setStatus('✓ Enviada');
    }

    async function handleIncorrect() {
        setStatus('Enviando...');
        pickWrongAnswer();
        await sleep(200);
        clickCheck();
        setStatus('✗ Incorreta');
    }

    async function handleNext() {
        setStatus('Avançando...');
        const ok = clickNext();
        if (!ok) {
            // KA às vezes precisa verificar antes de liberar o próximo
            clickCheck();
            await sleep(900);
            clickNext();
        }
        setStatus('▶');
    }

    /* ═══════════════════════════════════════════
       UI — PAINEL FLUTUANTE
    ═══════════════════════════════════════════ */
    let statusEl = null;
    const PANEL_ID = 'ka-helper-panel';

    function setStatus(msg) {
        if (statusEl) statusEl.textContent = msg;
    }

    function injectStyles() {
        if ($('#ka-helper-styles')) return;
        const style = document.createElement('style');
        style.id = 'ka-helper-styles';
        style.textContent = `
            #${PANEL_ID} {
                position: fixed;
                bottom: 28px;
                right: 28px;
                z-index: 2147483647;
                background: #0d1117;
                border: 1px solid #21262d;
                border-radius: 14px;
                padding: 16px;
                width: 170px;
                display: flex;
                flex-direction: column;
                gap: 9px;
                box-shadow: 0 8px 40px rgba(0,0,0,.75);
                font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
                user-select: none;
            }
            #ka-helper-title {
                font-size: 10px;
                font-weight: 700;
                letter-spacing: .1em;
                text-transform: uppercase;
                color: #484f58;
                text-align: center;
            }
            #ka-helper-status {
                font-size: 12px;
                font-weight: 500;
                color: #58a6ff;
                text-align: center;
                min-height: 15px;
                transition: color .2s;
            }
            #${PANEL_ID} button {
                border: none;
                border-radius: 9px;
                padding: 10px 0;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: opacity .15s, transform .1s;
                letter-spacing: .01em;
            }
            #${PANEL_ID} button:hover  { opacity: .85; transform: translateY(-1px); }
            #${PANEL_ID} button:active { opacity: 1;   transform: translateY(0);    }
            #ka-btn-correct   { background: #238636; color: #fff; }
            #ka-btn-incorrect { background: #b91c1c; color: #fff; }
            #ka-btn-next      { background: #1d4ed8; color: #fff; }
        `;
        document.head.appendChild(style);
    }

    function createPanel() {
        if ($(`#${PANEL_ID}`)) return;
        injectStyles();

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div id="ka-helper-title">KA Helper</div>
            <div id="ka-helper-status">Pronto</div>
            <button id="ka-btn-correct">✅ Correta</button>
            <button id="ka-btn-incorrect">❌ Incorreta</button>
            <button id="ka-btn-next">▶ Próximo</button>
        `;
        document.body.appendChild(panel);

        statusEl = $('#ka-helper-status');
        $('#ka-btn-correct').addEventListener('click', handleCorrect);
        $('#ka-btn-incorrect').addEventListener('click', handleIncorrect);
        $('#ka-btn-next').addEventListener('click', handleNext);
    }

    function removePanel() {
        const p = $(`#${PANEL_ID}`);
        if (p) p.remove();
        statusEl = null;
    }

    /* ═══════════════════════════════════════════
       WATCHER — SPA NAVIGATION
    ═══════════════════════════════════════════ */
    function checkCurrentPage() {
        if (isVideo()) {
            removePanel();
            return;
        }
        if (isExercise()) {
            createPanel();
        } else {
            removePanel();
        }
    }

    let lastHref = location.href;

    new MutationObserver(() => {
        // Detecta navegação SPA
        if (location.href !== lastHref) {
            lastHref = location.href;
            removePanel();
            setTimeout(checkCurrentPage, 1600);
            return;
        }
        // Detecta widget de exercício aparecendo dinamicamente
        if (!$(`#${PANEL_ID}`) && !isVideo() && isExercise()) {
            createPanel();
        }
    }).observe(document.body, { childList: true, subtree: true });

    // Check inicial (KA carrega lento)
    setTimeout(checkCurrentPage, 2200);
})();
