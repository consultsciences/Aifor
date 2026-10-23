// Show the confirmation banner when the server redirects back with ?sent=1.
if (new URLSearchParams(location.search).get('sent') === '1') {
  const el = document.getElementById('sent');
  if (el) el.hidden = false;
}
