(() => {
  let locked = true, hadSession = false, expiresAt = 0, checking, pollTimer, deadlineTimer, overlay, epoch = 0;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('rhythm-auth') : null;
  const concealedElements = new Map();
  const chinese = () => { try { return localStorage.getItem('rhythm.language') === 'zh'; } catch { return false; } };
  function conceal() { document.documentElement.style.visibility = 'hidden'; }
  function navigateToLogin() {
    epoch++;
    locked = true; conceal();
    clearTimeout(pollTimer); clearTimeout(deadlineTimer);
    window.rhythmBrowser?.detach();
    location.replace('/auth');
  }
  function lockInPlace() {
    locked = true; conceal();
    window.rhythmBrowser?.suspend();
    if (overlay) return;
    overlay = document.createElement('section');
    overlay.setAttribute('role','alertdialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label',chinese() ? '日记已锁定' : 'Journal locked');
    overlay.style.cssText = 'visibility:visible;position:fixed;inset:0;z-index:2147483647;background:#0b0c0e;color:#eee;font:16px system-ui;display:grid;place-content:center;text-align:center;padding:28px;gap:18px';
    const title = document.createElement('h1'); title.textContent = chinese() ? '日记已锁定' : 'Journal locked';
    const info = document.createElement('p'); info.textContent = chinese() ? '请重新验证访问权限。未保存的更改仍保留在此标签页中，请勿关闭。' : 'Verify access to continue. Unsaved changes remain in this tab; keep it open.';
    const login = document.createElement('a'); login.href='/auth'; login.target='_blank'; login.rel='noopener'; login.textContent=chinese() ? '在新标签页登录' : 'Sign in in a new tab'; login.style.color='#ff837b';
    const retry = document.createElement('button'); retry.textContent=chinese() ? '重新验证访问权限' : 'Check access again'; retry.style.cssText='padding:14px;background:#ef5045;color:white;border:0;border-radius:8px;font:inherit;cursor:pointer';
    retry.onclick=()=>check().catch(()=>{});
    overlay.append(title,info,login,retry); document.body.appendChild(overlay); retry.focus();
    for (const element of Array.from(document.body.children ?? [])) {
      if (element === overlay) continue;
      concealedElements.set(element,{inert:element.inert,aria:element.getAttribute('aria-hidden')});
      element.inert=true; element.setAttribute('aria-hidden','true');
    }
  }
  function failedCheck() {
    if (!hadSession) { navigateToLogin(); return; }
    lockInPlace();
    clearTimeout(pollTimer);
    pollTimer=setTimeout(()=>check().catch(()=>{}),15000);
  }
  async function check() {
    if (checking) return checking;
    const controller=new AbortController();
    const startedEpoch=epoch;
    const timeout=setTimeout(()=>{ controller.abort(); failedCheck(); },8000);
    checking=(async()=>{
      try {
        const response=await fetch('/api/auth/session',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
        if (!response.ok) throw new Error();
        const state=await response.json();
        if (startedEpoch !== epoch || controller.signal.aborted || !state.authenticated || !Number.isFinite(state.expiresAt) || state.expiresAt<=Date.now()) throw new Error();
        expiresAt=state.expiresAt; hadSession=true; locked=false;
        clearTimeout(deadlineTimer); clearTimeout(pollTimer);
        // Independent of polling/fetch completion: a hung network cannot extend access.
        deadlineTimer=setTimeout(lockInPlace,Math.min(expiresAt-Date.now(),2147483647));
        pollTimer=setTimeout(()=>check().catch(()=>{}),Math.min(expiresAt-Date.now(),60000));
        overlay?.remove(); overlay=undefined;
        for (const [element,previous] of concealedElements) {
          element.inert=previous.inert;
          if (previous.aria===null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden',previous.aria);
        }
        concealedElements.clear();
        window.rhythmBrowser?.resume();
        if (!document.hidden) document.documentElement.style.visibility='visible';
        return true;
      } catch { failedCheck(); throw new Error('AUTHENTICATION_REQUIRED'); }
      finally { clearTimeout(timeout); checking=undefined; }
    })();
    return checking;
  }
  async function logout() {
    if (window.rhythmBrowser?.hasUnsaved()) {
      alert(chinese() ? '请先保存更改或导出 JSON 备份。' : 'Save your changes or export a JSON backup before signing out.');
      return;
    }
    try {
      const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-Rhythm-Request':'1'},body:'{}',signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error();
      channel?.postMessage('logout');
      try { localStorage.setItem('rhythm.auth.logout',String(Date.now())); } catch {}
      navigateToLogin();
    } catch { alert(chinese() ? '无法退出，请连接网络后重试。' : 'Could not sign out. Reconnect and try again.'); }
  }
  function remoteLogout() {
    epoch++;
    clearTimeout(pollTimer); clearTimeout(deadlineTimer);
    if (window.rhythmBrowser?.hasUnsaved()) lockInPlace(); else navigateToLogin();
  }
  window.rhythmAuth={check,logout,get active(){return !locked && expiresAt>Date.now();}};
  channel?.addEventListener('message',event=>{ if (event.data==='logout') remoteLogout(); });
  window.addEventListener('storage',event=>{ if (event.key==='rhythm.auth.logout') remoteLogout(); });
  const resume=()=>{ conceal(); check().catch(()=>{}); };
  window.addEventListener('pageshow',resume);
  window.addEventListener('focus',resume);
  window.addEventListener('pagehide',conceal);
  document.addEventListener('visibilitychange',()=>{ conceal(); if (!document.hidden) check().catch(()=>{}); });
  for (const name of ['keydown','pointerdown','click','input']) document.addEventListener(name,event=>{
    if (hadSession && Date.now()>=expiresAt) lockInPlace();
    if (locked && !overlay?.contains(event.target)) {event.preventDefault();event.stopImmediatePropagation();}
  },true);
  conceal();
  window.rhythmAuth.ready=check(); window.rhythmAuth.ready.catch(()=>{});
})();
