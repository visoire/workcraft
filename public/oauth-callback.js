// Landing page of the Google Drive sign-in in browser mode (src/app/cloud-browser.ts). Google sends the browser back here with the access
// token in the address fragment (OAuth 2.0 for client-side web apps). The page checks the state it made, keeps the token in this browser
// (localStorage of this origin, valid for about an hour) and closes itself. Nothing is sent anywhere.
(function () {
  var title = document.getElementById('title');
  var text = document.getElementById('text');
  function say(h, p) {
    title.textContent = h;
    text.textContent = p;
  }
  var p = new URLSearchParams(location.hash.replace(/^#/, ''));
  history.replaceState(null, '', location.pathname);
  var state = null;
  try {
    state = localStorage.getItem('workcraft.cloud.state');
  } catch (e) {
    /* blocked */
  }
  if (p.get('error')) return say('Google Drive was not connected', 'Google answered: ' + p.get('error') + '. You can close this window.');
  if (!p.get('access_token') || !state || p.get('state') !== state) return say('Google Drive was not connected', 'The sign-in did not match the one WorkCraft started. Close this window and press Connect again.');
  try {
    localStorage.setItem('workcraft.cloud.google', JSON.stringify({ token: p.get('access_token'), expiresAt: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000, scope: p.get('scope') || '' }));
    localStorage.removeItem('workcraft.cloud.state');
  } catch (e) {
    return say('Google Drive was not connected', 'This browser blocks storage, so the sign-in cannot be kept.');
  }
  say('Google Drive is connected', 'You can close this window and go back to WorkCraft.');
  setTimeout(function () {
    try {
      window.close();
    } catch (e) {
      /* the opener closes it or the user does */
    }
  }, 600);
})();
