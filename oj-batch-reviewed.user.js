// ==UserScript==
// @name         OJ Batch Review Helper
// @namespace    https://example.local/
// @version      0.1.0
// @description  Add a one-click helper to batch-mark visible review items as reviewed on the OJ admin review page.
// @match        *://172.31.221.68/admin*
// @match        *://172.31.221.68/admin/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    pageUrlHint: /#\/contest\/review/i,
    scanDelayMs: 500,
    clickDelayMs: 650,
    settleDelayMs: 900,
    maxClicks: 200,
    listActionTexts: ['批阅'],
    detailActionTexts: ['标记为已阅'],
    pendingStatusTexts: ['未人工批阅'],
    reviewedStatusTexts: ['已阅'],
    autoNextPage: true,
    maxAutoPages: 50,
    useControllerWindow: false,
    allowHistoryBackFallback: false,
    modalConfirmPatterns: [/^确定$/, /^确认$/, /^OK$/, /^Yes$/i],
    actionSelectors: [
      'button',
      'a',
      '[role="button"]',
      'input[type="button"]',
      'input[type="submit"]',
      'span',
      'div',
    ],
  };

  if (CONFIG.pageUrlHint && !CONFIG.pageUrlHint.test(location.hash + location.href)) {
    return;
  }

  const state = {
    running: false,
    stopped: false,
    clicked: 0,
    processedKeys: new Set(),
    processedProblemKeys: new Set(),
    pagesAdvanced: 0,
    statusNode: null,
    panelNode: null,
  };

  let controllerWindow = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(node) {
    return (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function matchesAnyPattern(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function findClickableByExactText(targetTexts) {
    const nodes = [];
    const seen = new Set();

    for (const selector of CONFIG.actionSelectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (seen.has(node)) return;
        seen.add(node);
        if (!isVisible(node)) return;

        const text = normalizeText(node);
        if (!text) return;

        if (state.panelNode && state.panelNode.contains(node)) return;

        const aria = (node.getAttribute('aria-label') || '').trim();
        const title = (node.getAttribute('title') || '').trim();
        const combined = `${text} ${aria} ${title}`.trim();
        if (targetTexts.some((target) => combined === target || text === target || combined.includes(target))) {
          nodes.push(node);
        }
      });
    }

    return nodes;
  }

  function getRowKey(node) {
    const row = node?.closest?.('tr');
    if (!row) return null;

    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length === 0) return null;

    const firstCell = normalizeText(cells[0]);
    return firstCell || null;
  }

  function rowHasStatus(row, texts) {
    if (!row) return false;
    const rowText = normalizeText(row);
    return texts.some((text) => rowText.includes(text));
  }

  function getPendingRows() {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.filter((row) => rowHasStatus(row, CONFIG.pendingStatusTexts));
  }

  function findTextNodes(selectorList, targetTexts) {
    const nodes = [];
    const seen = new Set();

    for (const selector of selectorList) {
      document.querySelectorAll(selector).forEach((node) => {
        if (seen.has(node)) return;
        seen.add(node);
        if (!isVisible(node)) return;
        if (state.panelNode && state.panelNode.contains(node)) return;

        const text = normalizeText(node);
        if (!text) return;

        const aria = (node.getAttribute('aria-label') || '').trim();
        const title = (node.getAttribute('title') || '').trim();
        const combined = `${text} ${aria} ${title}`.trim();
        if (targetTexts.some((target) => combined === target || text === target || combined.includes(target))) {
          nodes.push(node);
        }
      });
    }

    return nodes;
  }

  function findListPageAction() {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    for (const row of rows) {
      if (!rowHasStatus(row, CONFIG.pendingStatusTexts)) continue;

      const btn = Array.from(row.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
        .find((node) => CONFIG.listActionTexts.some((text) => normalizeText(node).includes(text)));

      if (!btn) continue;

      const rowKey = getRowKey(btn) || normalizeText(row) || null;
      if (!rowKey) continue;
      if (state.processedKeys.has(rowKey)) continue;
      return { button: btn, rowKey };
    }

    return null;
  }

  function findNextPageButton() {
    const pager = document.querySelector('.el-pagination, .pagination, .pager') || document;
    const candidates = Array.from(pager.querySelectorAll('button, a, [role="button"]'));

    const button = candidates.find((node) => {
      const text = normalizeText(node);
      const aria = (node.getAttribute('aria-label') || '').trim();
      const title = (node.getAttribute('title') || '').trim();
      const cls = (node.className || '').toString();
      const combined = `${text} ${aria} ${title} ${cls}`.trim();
      const isNext = /下一页|next|\bnext\b|el-pagination__next|btn-next/i.test(combined);
      if (!isNext) return false;
      if (node.hasAttribute('disabled')) return false;
      if (node.getAttribute('aria-disabled') === 'true') return false;
      if ((node.classList && node.classList.contains('is-disabled')) || /disabled/.test(cls)) return false;
      return true;
    });

    return button || null;
  }

  async function gotoNextPageIfAvailable() {
    if (!CONFIG.autoNextPage) return false;
    if (state.pagesAdvanced >= CONFIG.maxAutoPages) {
      setStatus(`已达到自动翻页上限 ${CONFIG.maxAutoPages}`);
      return false;
    }

    const nextBtn = findNextPageButton();
    if (!nextBtn) return false;

    setStatus('翻到下一页...');
    await clickNode(nextBtn);
    state.pagesAdvanced += 1;
    await waitForPageState(isListPage, 12000);
    await sleep(CONFIG.settleDelayMs);
    return true;
  }

  function findDetailPageAction() {
    const buttons = findTextNodes(CONFIG.actionSelectors, CONFIG.detailActionTexts);
    return buttons[0] || null;
  }

  function findProblemHeadingText() {
    const candidates = Array.from(document.querySelectorAll('h1, h2, h3, .title, .header, .problem-title, .el-page-header__title'));
    for (const node of candidates) {
      if (!isVisible(node)) continue;
      const text = normalizeText(node);
      if (/^\d+\.\s*\[/.test(text) || /^\d+\.\s*/.test(text)) {
        return text;
      }
    }

    const bodyText = document.body ? normalizeText(document.body) : '';
    const match = bodyText.match(/(^|\s)(\d+)\.\s*\[/);
    if (match) return `${match[2]}.`;
    return '';
  }

  function getDetailUrlFromButton(button) {
    if (!button) return null;
    const row = button.closest?.('tr');
    // try anchors in row first
    const anchor = row?.querySelector?.('a[href]') || button.closest?.('a[href]') || button.querySelector?.('a[href]');
    if (anchor && anchor.href) return anchor.href;

    // try common dataset attributes
    const dataHref = button.getAttribute?.('data-href') || button.dataset?.href || button.getAttribute?.('href');
    if (dataHref) {
      try {
        return new URL(dataHref, location.href).href;
      } catch {
        return dataHref;
      }
    }

    return null;
  }

  function openControllerWindow() {
    try {
      if (controllerWindow && !controllerWindow.closed) return controllerWindow;
      // Open an empty named window so subsequent navigations reuse the same window and are allowed
      controllerWindow = window.open('', 'oj_batch_controller', 'width=1000,height=800');
      if (!controllerWindow) return null;
      controllerWindow.document.title = 'OJ 批量已阅 - 控制窗口';
      controllerWindow.document.body.innerHTML = '<div style="font-family: Arial; padding: 12px;">控制窗口已打开，等待任务...</div>';
      return controllerWindow;
    } catch (e) {
      console.error('无法打开控制窗口', e);
      return null;
    }
  }

  async function waitForChildDoc(win, timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        if (!win || win.closed) return false;
        const doc = win.document;
        if (doc && (doc.readyState === 'complete' || doc.body)) return true;
      } catch (e) {
        // cross-origin or not ready
      }
      await sleep(250);
    }
    return false;
  }

  function findTextNodesInDoc(doc, selectorList, targetTexts) {
    const nodes = [];
    const seen = new Set();
    for (const selector of selectorList) {
      try {
        doc.querySelectorAll(selector).forEach((node) => {
          if (seen.has(node)) return;
          seen.add(node);
          const style = doc.defaultView.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text) return;
          const aria = (node.getAttribute('aria-label') || '').trim();
          const title = (node.getAttribute('title') || '').trim();
          const combined = `${text} ${aria} ${title}`.trim();
          if (targetTexts.some((target) => combined === target || text === target || combined.includes(target))) {
            nodes.push(node);
          }
        });
      } catch (e) {
        // ignore
      }
    }
    return nodes;
  }

  async function processListItemViaController(button, rowKey) {
    const url = getDetailUrlFromButton(button);
    if (!url) {
      // fallback to clicking in-place (existing behavior)
      await clickNode(button);
      return await waitForPageState(isDetailPage, 12000);
    }

    const win = openControllerWindow();
    if (!win) {
      // can't open controller -> fallback
      await clickNode(button);
      return await waitForPageState(isDetailPage, 12000);
    }

    try {
      win.location.href = url;
    } catch (e) {
      try {
        win.document.location = url;
      } catch (e2) {
        console.error('无法导航控制窗口到详情页', e2);
        return false;
      }
    }

    const ready = await waitForChildDoc(win, 12000);
    if (!ready) return false;

    const doc = win.document;
    // select problem tab in child doc
    const problemIndex = (function () {
      const h = Array.from(doc.querySelectorAll('h1, h2, h3, .title, .header, .problem-title, .el-page-header__title')).map(n => (n.innerText||n.textContent||'').trim()).find(t => /^\d+\./.test(t));
      if (h) {
        const m = h.match(/^(\d+)\./);
        return m ? m[1] : '';
      }
      const bodyText = (doc.body && (doc.body.innerText||doc.body.textContent)) || '';
      const mm = bodyText.match(/(^|\s)(\d+)\.\s*\[/);
      return mm ? mm[2] : '';
    })();

    if (problemIndex) {
      // try to click matching problem tab in child doc
      const tabCandidates = findTextNodesInDoc(doc, ['button', 'a', '[role="button"]', 'div', 'span'], [problemIndex]);
      const tab = tabCandidates.find(n => ((n.innerText||n.textContent)||'').trim().startsWith(problemIndex));
      if (tab) {
        try { tab.click(); } catch { try { tab.dispatchEvent(new MouseEvent('click',{bubbles:true})); } catch {} }
        await sleep(CONFIG.settleDelayMs);
      }
    }

    // find and click 标记为已阅 in child doc
    const markBtns = findTextNodesInDoc(doc, CONFIG.actionSelectors, CONFIG.detailActionTexts);
    const markBtn = markBtns[0];
    if (!markBtn) return false;

    try { markBtn.click(); } catch { try { markBtn.dispatchEvent(new MouseEvent('click',{bubbles:true})); } catch {} }
    await sleep(500);

    // try to click confirm in child
    const confirmCandidates = Array.from(doc.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
    for (const c of confirmCandidates) {
      const txt = (c.innerText||c.textContent||'').trim();
      if (/^确定$|^确认$|^OK$|^Yes$/i.test(txt)) {
        try { c.click(); } catch { try { c.dispatchEvent(new MouseEvent('click',{bubbles:true})); } catch {} }
        break;
      }
    }

    await sleep(CONFIG.settleDelayMs);
    try { win.location.href = 'about:blank'; } catch {}
    return true;
  }

  function getCurrentProblemIndex() {
    const heading = findProblemHeadingText();
    const match = heading.match(/^(\d+)\./);
    return match ? match[1] : '';
  }

  async function selectProblemTab(problemIndex) {
    if (!problemIndex) return false;

    const candidates = findTextNodes(['button', 'a', '[role="button"]', 'div', 'span'], [problemIndex]);
    const button = candidates.find((node) => normalizeText(node) === problemIndex || normalizeText(node).startsWith(problemIndex));
    if (!button) return false;

    await clickNode(button);
    await sleep(CONFIG.settleDelayMs);
    return true;
  }

  function findConfirmNode() {
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
    return candidates.find((node) => {
      if (!isVisible(node)) return false;
      const text = normalizeText(node);
      return text && matchesAnyPattern(text, CONFIG.modalConfirmPatterns);
    }) || null;
  }

  function setStatus(message) {
    if (state.statusNode) {
      state.statusNode.textContent = message;
    }
    console.log('[OJ Batch Review Helper]', message);
  }

  async function clickNode(node) {
    if (typeof node.click === 'function') {
      node.click();
      return;
    }

    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function isDetailPage() {
    const bodyText = document.body ? normalizeText(document.body) : '';
    return Boolean(findDetailPageAction()) || /教师评语|标记为已阅/.test(bodyText);
  }

  function isListPage() {
    const bodyText = document.body ? normalizeText(document.body) : '';
    return /批阅列表|提交ID|用户ID|总分数|操作/.test(bodyText);
  }

  async function handlePossibleConfirm() {
    await sleep(250);
    const confirmNode = findConfirmNode();
    if (confirmNode) {
      await clickNode(confirmNode);
      await sleep(CONFIG.settleDelayMs);
    }
  }

  async function waitForPageState(predicate, timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (predicate()) return true;
      await sleep(200);
    }
    return false;
  }

  async function returnToListPage() {
    const beforeUrl = location.href;
    history.back();
    const navigatedBack = await waitForPageState(isListPage, 12000);
    if (navigatedBack) return;

    if (location.href === beforeUrl) {
      const backLink = Array.from(document.querySelectorAll('a, button, [role="button"]')).find((node) => {
        if (!isVisible(node)) return false;
        const text = normalizeText(node);
        return /列表|返回|回到/.test(text);
      });
      if (backLink) {
        await clickNode(backLink);
        await waitForPageState(isListPage, 12000);
      }
    }
  }

  async function processListItem() {
    const candidate = findListPageAction();
    if (!candidate) return false;

    const { button, rowKey } = candidate;
    setStatus(`打开批阅：${rowKey}`);
    let detailReady = false;
    if (CONFIG.useControllerWindow) {
      detailReady = await processListItemViaController(button, rowKey);
    }

    if (!detailReady) {
      await clickNode(button);
      detailReady = await waitForPageState(isDetailPage, 12000);
    }

    if (!detailReady) {
      setStatus(`未进入详情页：${rowKey}`);
      return false;
    }

    const problemIndex = getCurrentProblemIndex();
    if (problemIndex && !state.processedProblemKeys.has(`${rowKey}:${problemIndex}`)) {
      setStatus(`选择题号：${problemIndex}`);
      await selectProblemTab(problemIndex);
      state.processedProblemKeys.add(`${rowKey}:${problemIndex}`);
    }

    const detailButton = findDetailPageAction();
    if (!detailButton) {
      setStatus(`未找到“标记为已阅”：${rowKey}`);
      return false;
    }

    setStatus(`标记已阅：${rowKey}`);
    await clickNode(detailButton);
    await handlePossibleConfirm();
    await sleep(CONFIG.settleDelayMs);

    const detailClosed = await waitForPageState(() => !isDetailPage(), 12000);
    if (!detailClosed && CONFIG.allowHistoryBackFallback) {
      await returnToListPage();
    }

    state.processedKeys.add(rowKey);
    await sleep(CONFIG.clickDelayMs);
    return true;
  }

  async function runBatch() {
    if (state.running) return;
    state.running = true;
    state.stopped = false;
    state.clicked = 0;
    state.pagesAdvanced = 0;

    try {
      setStatus('扫描中...');
      await sleep(CONFIG.scanDelayMs);

      while (!state.stopped && state.clicked < CONFIG.maxClicks) {
        if (isListPage()) {
          const handled = await processListItem();
          if (!handled) {
            const pendingRows = getPendingRows();
            if (pendingRows.length === 0) {
              const moved = await gotoNextPageIfAvailable();
              if (moved) continue;
            }
            setStatus(`完成，已处理 ${state.clicked} 个`);
            break;
          }
          state.clicked += 1;
          continue;
        }

        if (isDetailPage()) {
          const problemIndex = getCurrentProblemIndex();
          if (problemIndex) {
            await selectProblemTab(problemIndex);
          }
          const detailButton = findDetailPageAction();
          if (detailButton) {
            await clickNode(detailButton);
            await handlePossibleConfirm();
            await sleep(CONFIG.settleDelayMs);
            continue;
          }
        }

        if (!findClickableByExactText([...CONFIG.listActionTexts, ...CONFIG.detailActionTexts]).length) {
          setStatus(`完成，已点击 ${state.clicked} 个`);
          break;
        }

        setStatus('等待页面状态变化...');
        await sleep(CONFIG.clickDelayMs);
      }

      if (state.clicked >= CONFIG.maxClicks) {
        setStatus(`已达到最大点击次数 ${CONFIG.maxClicks}`);
      }
    } catch (error) {
      console.error(error);
      setStatus(`出错：${error?.message || error}`);
    } finally {
      state.running = false;
    }
  }

  function stopBatch() {
    state.stopped = true;
    setStatus('已停止');
  }

  function createPanel() {
    if (state.panelNode) return;

    const panel = document.createElement('div');
    panel.id = 'oj-batch-review-helper-panel';
    panel.style.cssText = [
      'position: fixed',
      'right: 16px',
      'bottom: 16px',
      'z-index: 999999',
      'background: rgba(22, 24, 31, 0.96)',
      'color: #fff',
      'border: 1px solid rgba(255,255,255,0.12)',
      'border-radius: 12px',
      'padding: 12px',
      'min-width: 220px',
      'font: 13px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      'box-shadow: 0 10px 30px rgba(0,0,0,0.25)',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'OJ 批量已阅';
    title.style.cssText = 'font-weight: 700; margin-bottom: 8px;';

    const status = document.createElement('div');
    status.textContent = '等待操作';
    status.style.cssText = 'margin-bottom: 10px; color: #c9d1d9; word-break: break-all;';

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.textContent = '批量已阅本页';
    startBtn.style.cssText = buttonStyle('#2ea043');
    startBtn.addEventListener('click', runBatch);

    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.textContent = '停止';
    stopBtn.style.cssText = buttonStyle('#da3633');
    stopBtn.addEventListener('click', stopBatch);

    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.textContent = '扫描候选';
    scanBtn.style.cssText = buttonStyle('#0969da');
    scanBtn.addEventListener('click', () => {
      const pendingRows = getPendingRows();
      setStatus(`找到 ${pendingRows.length} 条待批阅`);
      console.table(pendingRows.map((row, idx) => ({
        index: idx,
        rowKey: normalizeText(row.querySelector('td')),
        rowText: normalizeText(row).slice(0, 120),
      })));
    });

    buttons.append(startBtn, stopBtn, scanBtn);
    panel.append(title, status, buttons);
    document.body.appendChild(panel);

    state.statusNode = status;
    state.panelNode = panel;
  }

  function buttonStyle(backgroundColor) {
    return [
      'border: 0',
      `background: ${backgroundColor}`,
      'color: #fff',
      'padding: 8px 10px',
      'border-radius: 8px',
      'cursor: pointer',
      'font-size: 12px',
      'line-height: 1',
    ].join(';');
  }

  function patchConfirmDialogs() {
    try {
      window.confirm = () => true;
      window.alert = () => undefined;
    } catch {
      // Some pages lock these down; ignore.
    }
  }

  function start() {
    patchConfirmDialogs();
    createPanel();
    setStatus('就绪');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  const observer = new MutationObserver(() => {
    if (!state.panelNode && document.body) {
      createPanel();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();