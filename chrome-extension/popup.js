const countEl = document.querySelector('[data-captured-count]');
const statusEl = document.querySelector('[data-status]');

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b42345' : '#5c6876';
}

function setCount(value) {
  countEl.textContent = String(value || 0);
}

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Request failed'));
        return;
      }

      resolve(response);
    });
  });
}

async function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function refreshStatus() {
  try {
    const [response, job] = await Promise.all([
      sendMessage('status'),
      sendMessage('captureAllStatus').catch(() => null)
    ]);
    setCount(response.totalStored || 0);

    if (job?.status === 'running') {
      setStatus('Auto-scroll capture is running in background...');
      return;
    }

    if (response.totalStored > 0) {
      setStatus('Ready to sync to dashboard.');
    } else {
      setStatus('No posts captured yet.');
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function capture() {
  setStatus('Capturing posts from current tab...');

  try {
    const response = await sendMessage('capture');
    if (response.error) {
      setStatus(`Capture script error: ${response.error}`, true);
      return;
    }

    setCount(response.totalStored || 0);
    if ((response.captured || 0) === 0 && response.diagnostics) {
      setStatus(
        `Captured 0 posts. Found ${response.diagnostics.candidateCards || 0} cards and ${response.diagnostics.anchorMatches || 0} post links on page.`,
        true
      );
      return;
    }

    setStatus(`Captured ${response.captured || 0} posts.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function captureAll() {
  setStatus('Auto-scrolling and capturing all visible history... this can take up to 45 seconds.');

  try {
    const start = await sendMessage('captureAllStart', { speedProfile: 'fast' });
    if (start.alreadyRunning) {
      setStatus('Auto-scroll capture is already running...');
    }

    const pollLimit = 120;
    for (let i = 0; i < pollLimit; i += 1) {
      await wait(1000);
      const job = await sendMessage('captureAllStatus');

      if (job.status === 'running') {
        continue;
      }

      if (job.status === 'failed') {
        setStatus(job.error || 'Auto-scroll capture failed.', true);
        return;
      }

      if (job.status !== 'completed') {
        setStatus('Auto-scroll capture ended unexpectedly.', true);
        return;
      }

      const response = job.result || {};
      if (response.error) {
        setStatus(`Capture script error: ${response.error}`, true);
        return;
      }

      setCount(response.totalStored || 0);
      if ((response.captured || 0) === 0 && response.diagnostics) {
        setStatus(
          `Captured 0 posts after ${response.diagnostics.scrollRounds || 0} rounds. Links: ${response.diagnostics.anchorMatches || 0}, final links: ${response.diagnostics.finalAnchorCount || 0}, load-more clicks: ${response.diagnostics.loadMoreClicks || 0}.`,
          true
        );
        return;
      }

      setStatus(
        `Captured ${response.captured || 0} posts with auto-scroll (${response.diagnostics?.scrollRounds || 0} rounds, final links ${response.diagnostics?.finalAnchorCount || 0}, load-more clicks ${response.diagnostics?.loadMoreClicks || 0}).`
      );
      return;
    }

    setStatus('Auto-scroll capture timed out. Try again on your activity page.', true);
  } catch (error) {
    if (String(error?.message || '').includes('message channel closed')) {
      setStatus('Capture started, but popup lost the channel. Reopen popup in ~60s to check status.', true);
      return;
    }
    setStatus(error.message, true);
  }
}

async function sync() {
  setStatus('Syncing to local dashboard...');

  try {
    const response = await sendMessage('sync');
    setStatus(
      `Synced ${response.ingested || 0} posts to dashboard (${response.endpoint.replace('http://', '')}).`
    );
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function clear() {
  setStatus('Clearing extension storage...');

  try {
    await sendMessage('clear');
    setCount(0);
    setStatus('Extension data cleared.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function download() {
  setStatus('Preparing export...');

  try {
    const response = await sendMessage('getPosts');
    const posts = Array.isArray(response.posts) ? response.posts : [];

    if (!posts.length) {
      setStatus('No posts to export.', true);
      return;
    }

    const blob = new Blob([JSON.stringify({ posts }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `linkedin-posts-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);

    setStatus(`Downloaded ${posts.length} posts as JSON.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

for (const button of document.querySelectorAll('button[data-action]')) {
  button.addEventListener('click', () => {
    const action = button.getAttribute('data-action');

    if (action === 'capture') {
      capture();
      return;
    }

    if (action === 'sync') {
      sync();
      return;
    }

    if (action === 'capture-all') {
      captureAll();
      return;
    }

    if (action === 'download') {
      download();
      return;
    }

    if (action === 'clear') {
      clear();
    }
  });
}

refreshStatus();
