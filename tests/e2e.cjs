// End-to-end test: real browsers, a local relay, fake cameras.
//
//   node server/relay.js --port 8787 --web web/dist &
//   node tests/e2e.cjs
//
// Checks a three-person call (video flowing, every frame sealed and opened),
// chat, the waiting room, and password-protected meetings.

const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://127.0.0.1:8787/';
const RELAY = process.env.RELAY || 'ws://127.0.0.1:8787';
const SHOTS = process.env.SHOTS || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function person(browser, name, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript(
    ([relay, name, extra]) => {
      localStorage.setItem('handshake.debug', '1');
      localStorage.setItem(
        'handshake.settings.v1',
        JSON.stringify({ relays: [relay], stun: [], name, lobby: false, ...extra }),
      );
    },
    [RELAY, name, extra],
  );
  // Headless browsers have no screen to capture: share a moving canvas instead.
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 960;
      c.height = 540;
      const g = c.getContext('2d');
      let n = 0;
      setInterval(() => {
        g.fillStyle = n++ % 2 ? '#283063' : '#e6b43d';
        g.fillRect(0, 0, 960, 540);
        g.fillStyle = '#fff';
        g.font = '48px sans-serif';
        g.fillText('Slide ' + n, 60, 120);
      }, 120);
      return c.captureStream(10);
    };
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${name}] console:`, m.text());
  });
  await page.goto(BASE);
  await page.waitForSelector('.view-home');
  return { ctx, page, name };
}

async function start(p, { password = '', lobby = false } = {}) {
  await p.page.click('text=New meeting');
  await p.page.waitForSelector('.view-prejoin');
  if (password) await p.page.fill('.pj-form input[type=password]', password);
  const box = p.page.locator('.pj-form input[role=switch]');
  if ((await box.isChecked()) !== lobby) await box.click();
  const code = (await p.page.textContent('.pj-code-text')).trim();
  await p.page.click('text=Start meeting');
  await p.page.waitForSelector('.view-call');
  return code;
}

async function join(p, code, password = '') {
  await p.page.fill('#code', code);
  await p.page.click('.join-form button[type=submit]');
  await p.page.waitForSelector('.view-prejoin');
  if (password) {
    await p.page.click('text=This meeting has a password');
    await p.page.fill('.pj-form input[type=password]', password);
  }
  await p.page.click('text=Join now');
}

async function waitTiles(p, n, timeout = 30000) {
  await p.page.waitForFunction((n) => document.querySelectorAll('.tile').length === n, n, { timeout });
}

async function remoteVideoOk(p) {
  return p.page.evaluate(async () => {
    const vids = [...document.querySelectorAll('.tile:not(.tile-self) video')];
    const before = vids.map((v) => v.currentTime);
    await new Promise((r) => setTimeout(r, 1500));
    return vids.map((v, i) => ({ w: v.videoWidth, advanced: v.currentTime > before[i], hidden: v.hidden }));
  });
}

async function frameStats(p) {
  return p.page.evaluate(() => {
    const m = window.__handshake.meeting;
    return [...m.participants.values()].map((x) => ({
      name: x.name,
      e2ee: x.e2ee,
      status: x.status,
      ...(x.peer ? x.peer.frameStats : {}),
      safety: x.safety && x.safety.join(' '),
    }));
  });
}

(async () => {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  let failures = 0;
  const check = async (title, fn) => {
    try {
      await fn();
      console.log('ok   ', title);
    } catch (err) {
      failures++;
      console.log('FAIL ', title, '\n     ', err && err.message);
    }
  };

  // --- three people, open meeting ---
  const a = await person(browser, 'Ayesha');
  const b = await person(browser, 'Bilal');
  const c = await person(browser, 'Chen');
  const mode = await a.page.evaluate(() => window.__handshake.meeting === null && (window.RTCRtpScriptTransform ? 'script' : 'legacy'));
  console.log('frame encryption API in this browser:', mode);
  if (SHOTS) await a.page.screenshot({ path: SHOTS + '/home.png' });

  const code = await start(a);
  console.log('meeting code', code);
  await join(b, code);
  await join(c, code);

  await check('everyone sees three tiles', async () => {
    await Promise.all([waitTiles(a, 3), waitTiles(b, 3), waitTiles(c, 3)]);
  });

  await check('everyone is connected to everyone', async () => {
    for (const p of [a, b, c]) {
      await p.page.waitForFunction(
        () => [...window.__handshake.meeting.participants.values()].filter((x) => x.status === 'connected').length === 2,
        null,
        { timeout: 20000 },
      );
    }
  });

  await sleep(3000);
  await check('remote video is decoding on every screen', async () => {
    for (const p of [a, b, c]) {
      const vids = await remoteVideoOk(p);
      assert.equal(vids.length, 2, `${p.name} sees ${vids.length} remote videos`);
      for (const v of vids) {
        assert.ok(v.w > 0, `${p.name}: video has no frames`);
        assert.ok(v.advanced, `${p.name}: video is not playing`);
      }
    }
  });

  await check('every connection seals and opens media frames', async () => {
    for (const p of [a, b, c]) {
      const stats = await frameStats(p);
      for (const s of stats) {
        assert.equal(s.e2ee, 'frame', `${p.name}<->${s.name} not using frame encryption`);
        assert.ok(s.sentOk > 50, `${p.name}->${s.name} sealed only ${s.sentOk}`);
        assert.ok(s.recvOk > 50, `${p.name}<-${s.name} opened only ${s.recvOk}`);
        assert.equal(s.recvFailed, 0, `${p.name}<-${s.name} rejected ${s.recvFailed}`);
      }
    }
  });

  await check('both ends of a connection show the same safety number', async () => {
    const sa = await frameStats(a);
    const sb = await frameStats(b);
    const ab = sa.find((x) => x.name === 'Bilal').safety;
    const ba = sb.find((x) => x.name === 'Ayesha').safety;
    assert.ok(ab && ab.length > 30, 'no safety number');
    assert.equal(ab, ba);
    const ac = sa.find((x) => x.name === 'Chen').safety;
    assert.notEqual(ab, ac, 'different connections should differ');
  });

  await check('chat reaches everyone', async () => {
    await a.page.click('.ctl[aria-label="Chat"]');
    await a.page.fill('.chat-input', 'Hello everyone');
    await a.page.keyboard.press('Enter');
    for (const p of [b, c]) {
      await p.page.waitForFunction(() => window.__handshake.meeting.chat.some((m) => m.text === 'Hello everyone'), null, { timeout: 5000 });
    }
  });

  await check('turning a camera off shows the avatar for others', async () => {
    await b.page.click('.ctl[aria-label^="Turn off camera"]');
    await a.page.waitForFunction(
      () => {
        const t = [...document.querySelectorAll('.tile')].find((x) => x.textContent.includes('Bilal'));
        return t && t.classList.contains('no-video');
      },
      null,
      { timeout: 5000 },
    );
    await b.page.click('.ctl[aria-label^="Turn on camera"]');
  });

  await check('screen sharing reaches everyone, sealed', async () => {
    await b.page.click('.ctl[aria-label="Share screen"]');
    for (const p of [a, c]) {
      await p.page.waitForFunction(
        () => {
          const v = document.querySelector('.tile-screen video');
          return v && !v.hidden && v.videoWidth > 0;
        },
        null,
        { timeout: 15000 },
      );
      const layout = await p.page.getAttribute('.stage', 'data-layout');
      assert.equal(layout, 'spotlight', 'presenting should switch to spotlight');
    }
    await sleep(3500);
    const stats = await a.page.evaluate(() => Object.fromEntries([...window.__frameStats].filter(([k]) => k.endsWith(':recv:screen'))));
    const vals = Object.values(stats);
    assert.ok(vals.some((v) => v.ok > 5 && v.failed === 0), 'screen frames not opened: ' + JSON.stringify(stats));
    if (SHOTS) await a.page.screenshot({ path: SHOTS + '/call-screen.png' });
    await b.page.click('.ctl[aria-label="Stop presenting"]');
    await a.page.waitForFunction(() => !document.querySelector('.tile-screen'), null, { timeout: 8000 });
  });

  await check('file sharing works peer to peer', async () => {
    await c.page.evaluate(() => {
      const f = new File([new Uint8Array(200000).map((_, i) => i % 251)], 'notes.bin', { type: 'application/octet-stream' });
      window.__handshake.meeting.shareFile(f);
    });
    await a.page.waitForFunction(() => window.__handshake.meeting.chat.some((m) => m.file && m.file.name === 'notes.bin'), null, { timeout: 5000 });
    const got = await a.page.evaluate(
      () =>
        new Promise((resolve) => {
          const m = window.__handshake.meeting;
          const msg = m.chat.find((x) => x.file && x.file.name === 'notes.bin');
          m.addEventListener('file-progress', (e) => {
            if (e.detail.done) e.detail.blob.arrayBuffer().then((buf) => {
              const u = new Uint8Array(buf);
              resolve({ size: u.length, ok: u.every((v, i) => v === i % 251) });
            });
          });
          m.requestFile(msg.file.fid, msg.from);
        }),
    );
    assert.equal(got.size, 200000);
    assert.ok(got.ok, 'file content changed in transit');
  });

  if (SHOTS) {
    await a.page.click('.secure-chip');
    await sleep(2500);
    await a.page.screenshot({ path: SHOTS + '/call-security.png' });
    await a.page.click('.panel-head .icon-btn');
    await sleep(500);
    await a.page.screenshot({ path: SHOTS + '/call-grid.png' });
  }

  await check('leaving updates everyone else', async () => {
    await c.page.click('.ctl-leave');
    try {
      await Promise.all([waitTiles(a, 2, 10000), waitTiles(b, 2, 10000)]);
    } catch (err) {
      for (const p of [a, b, c]) {
        const info = await p.page.evaluate(() => ({
          tiles: [...document.querySelectorAll('.tile')].map((t) => t.dataset.key + '=' + t.textContent.trim()),
          phase: window.__handshake.meeting && window.__handshake.meeting.phase,
          menu: !!document.querySelector('.menu'),
          view: document.getElementById('app').className,
        }));
        console.log('      ', p.name, JSON.stringify(info));
      }
      throw err;
    }
    await c.page.waitForSelector('.view-end');
  });
  await Promise.all([a.ctx.close(), b.ctx.close(), c.ctx.close()]);

  // --- waiting room ---
  const host = await person(browser, 'Host');
  const guest = await person(browser, 'Guest Two');
  const code2 = await start(host, { lobby: true });
  await join(guest, code2);
  await check('guest waits until the host lets them in', async () => {
    await guest.page.waitForSelector('text=Asking to join…', { timeout: 12000 });
    await host.page.waitForSelector('.notice-knock', { timeout: 12000 });
    if (SHOTS) await host.page.screenshot({ path: SHOTS + '/knock.png' });
    await host.page.click('.notice-knock >> text=Admit');
    await waitTiles(guest, 2, 20000);
    await waitTiles(host, 2, 20000);
  });
  await Promise.all([host.ctx.close(), guest.ctx.close()]);

  // --- password ---
  const owner = await person(browser, 'Owner');
  const visitor = await person(browser, 'Visitor');
  const code3 = await start(owner, { password: 'tea-at-four' });
  await join(visitor, code3);
  await check('joining without the password asks for it', async () => {
    await visitor.page.waitForSelector('text=This meeting has a password. Enter it to join.', { timeout: 15000 });
  });
  await check('the right password gets in, with frame encryption', async () => {
    await visitor.page.fill('.pj-form input[type=password]', 'tea-at-four');
    await visitor.page.click('text=Join now');
    await waitTiles(visitor, 2, 25000);
    await waitTiles(owner, 2, 25000);
    await sleep(2500);
    const s = await frameStats(visitor);
    assert.ok(s[0].recvOk > 20 && s[0].recvFailed === 0, JSON.stringify(s));
  });
  await Promise.all([owner.ctx.close(), visitor.ctx.close()]);

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
