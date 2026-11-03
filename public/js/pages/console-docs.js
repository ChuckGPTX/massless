for (const pre of document.querySelectorAll('pre')) {
  const button = document.createElement('button'); button.type='button'; button.className='console-copy'; button.textContent='Copy';
  const status = document.createElement('span'); status.setAttribute('role','status'); status.className='console-copy-status';
  button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.textContent); status.textContent='Copied'; } catch { status.textContent='Select the code above to copy it.'; } });
  const row=document.createElement('div'); row.className='console-copy-row'; row.append(button,status); pre.after(row);
}
for (const link of document.querySelectorAll('.console-nav nav a')) if (new URL(link.href).pathname.replace(/\/$/,'')===location.pathname.replace(/^\/console/,'').replace(/\/$/,'')) link.setAttribute('aria-current','page');
