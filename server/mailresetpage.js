// Server-rendered pages for the mailbox password reset. Deliberately NOT part of the
// React SPA: the people using them are locked out, not signed in, and the SPA is behind
// auth. Two small self-contained pages, styled to match the panel, same approach as
// status.js. They talk to the public /api/mail/{forgot,reset} endpoints via fetch.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
  *{box-sizing:border-box} body{margin:0;background:#f6f7f9;color:#111827;
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;width:100%;max-width:420px;
    box-shadow:0 1px 3px rgba(0,0,0,.06)}
  h1{margin:0 0 6px;font-size:19px}
  p.sub{margin:0 0 20px;color:#6b7280;font-size:13.5px}
  label{display:block;font-size:12.5px;font-weight:600;margin:0 0 6px;color:#374151}
  input{width:100%;padding:9px 11px;font-size:14px;border:1px solid #d1d5db;border-radius:7px;
    font-family:inherit;background:#fff;color:#111827}
  input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
  button{width:100%;margin-top:16px;padding:10px;font-size:14px;font-weight:600;color:#fff;
    background:#2563eb;border:none;border-radius:7px;cursor:pointer;font-family:inherit}
  button:disabled{opacity:.55;cursor:not-allowed}
  .msg{margin-top:16px;padding:11px 13px;border-radius:7px;font-size:13.5px;display:none}
  .msg.ok{display:block;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46}
  .msg.err{display:block;background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
  .hint{margin-top:14px;font-size:12px;color:#6b7280}
  code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12.5px}
`;

const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="card">${body}</div></body></html>`;

// Step 1 — ask for the mailbox. The response is identical whether or not it exists.
export function renderForgotPage() {
  return shell("Reset your mailbox password", `
  <h1>Reset your password</h1>
  <p class="sub">Enter your email address. If we host it and you've registered a recovery
  address, we'll send a reset link there.</p>
  <form id="f" autocomplete="on">
    <label for="address">Your email address</label>
    <input id="address" name="address" type="email" required placeholder="you@yourdomain.com" autofocus>
    <button type="submit" id="b">Send reset link</button>
  </form>
  <div class="msg" id="m"></div>
  <p class="hint">Locked out with no recovery address on file? Ask whoever administers your
  email to reset it for you.</p>
  <script>
    const f=document.getElementById('f'),b=document.getElementById('b'),m=document.getElementById('m');
    f.addEventListener('submit',async(e)=>{
      e.preventDefault(); b.disabled=true; b.textContent='Sending…'; m.className='msg';
      try{
        const r=await fetch('/api/mail/forgot',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({address:document.getElementById('address').value})});
        const d=await r.json().catch(()=>({}));
        m.textContent = d.message || d.error || 'Something went wrong. Try again.';
        m.className = 'msg ' + (r.ok ? 'ok' : 'err');
      }catch(_){ m.textContent='Network error. Try again.'; m.className='msg err'; }
      b.disabled=false; b.textContent='Send reset link';
    });
  </script>`);
}

// Step 2 — set the new password. `address` is only rendered once the token has been
// validated server-side, so a bogus token discloses nothing.
export function renderResetPage({ token, address, invalid }) {
  if (invalid) {
    return shell("Reset link expired", `
    <h1>This link doesn't work</h1>
    <p class="sub">Reset links last one hour and can only be used once. This one has expired,
    been used already, or isn't valid.</p>
    <a href="/mail/forgot"><button type="button">Request a new link</button></a>`);
  }
  return shell("Set a new password", `
  <h1>Set a new password</h1>
  <p class="sub">For <code>${esc(address)}</code></p>
  <form id="f">
    <label for="pw">New password</label>
    <input id="pw" type="password" required minlength="8" placeholder="at least 8 characters" autofocus autocomplete="new-password">
    <label for="pw2" style="margin-top:12px">Confirm password</label>
    <input id="pw2" type="password" required minlength="8" autocomplete="new-password">
    <button type="submit" id="b">Set password</button>
  </form>
  <div class="msg" id="m"></div>
  <script>
    const TOKEN=${JSON.stringify(token)};
    const f=document.getElementById('f'),b=document.getElementById('b'),m=document.getElementById('m');
    f.addEventListener('submit',async(e)=>{
      e.preventDefault();
      const pw=document.getElementById('pw').value,pw2=document.getElementById('pw2').value;
      if(pw!==pw2){ m.textContent="Those passwords don't match."; m.className='msg err'; return; }
      b.disabled=true; b.textContent='Saving…'; m.className='msg';
      try{
        const r=await fetch('/api/mail/reset',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({token:TOKEN,password:pw})});
        const d=await r.json().catch(()=>({}));
        if(r.ok){
          f.style.display='none';
          m.textContent='Password updated. You can now sign in to webmail with your new password.';
          m.className='msg ok';
        }else{
          m.textContent=d.error||'Could not set the password.'; m.className='msg err';
          b.disabled=false; b.textContent='Set password';
        }
      }catch(_){ m.textContent='Network error. Try again.'; m.className='msg err';
        b.disabled=false; b.textContent='Set password'; }
    });
  </script>`);
}
