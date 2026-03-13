(function () {
  function _esc(s) { if (s == null || s === undefined) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function closeProfile() { var o = document.getElementById('profile-ov'); if (o) o.classList.remove('open'); }
  function fillProfileMinimal() {
    var nav = document.getElementById('profile-nav'); var cnt = document.getElementById('profile-content'); if (!nav || !cnt) return;
    var token = localStorage.getItem('pk24_token') || '';
    var jwt = null; try { var p = String(token).split('.'); if (p.length === 3) { var b = p[1].replace(/-/g, '+').replace(/_/g, '/'); var j = decodeURIComponent(atob(b).split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')); jwt = JSON.parse(j); } } catch (e) { }
    var email = (jwt && jwt.email) || '—'; var role = (jwt && jwt.role) || 'employee'; var roleLabel = { admin: 'Администратор', techlead: 'Техлид', employee: 'Сотрудник' }[role] || role;
    nav.innerHTML = '<button type="button" class="profile-nav-item active">Профиль</button><button type="button" class="profile-nav-item">Проекты и роли</button>';
    cnt.innerHTML = '<div class="profile-pane"><div class="profile-pane-title">Профиль</div><div class="profile-pane-sub">Минимальный вид (скрипт приложения не загрузился)</div><div class="profile-cards"><div class="profile-card"><div class="profile-card-label">Email</div><div class="profile-card-value">' + _esc(email) + '</div></div><div class="profile-card"><div class="profile-card-label">Роль</div><div class="profile-card-value">' + _esc(roleLabel) + '</div></div></div><div class="profile-pane-sub" style="margin-top:12px">Обновите страницу (F5) или нажмите <button type="button" class="btn-create" style="margin:0 4px;padding:4px 12px;font-size:12px;" onclick="if(typeof window.__fillProfileContent===\'function\'){window.__fillProfileContent(\'profile\');}">Повторить загрузку</button></div></div>';
  }
  function openProfile(sectionId) {
    var o = document.getElementById('profile-ov'); if (o) o.classList.add('open');
    var cnt = document.getElementById('profile-content'); if (cnt && !cnt.innerHTML.trim()) cnt.innerHTML = '<div class="profile-pane"><div class="profile-pane-sub">Загрузка разделов…</div></div>';
    var sid = sectionId || 'profile';
    function tryFill(n) {
      if (typeof window.__fillProfileContent === 'function') { window.__fillProfileContent(sid); return; }
      if (n === 8) { var sc = document.createElement('script'); sc.src = '/frontend/js/api-bridge.js'; sc.async = false; document.body.appendChild(sc); }
      if (n === 50) fillProfileMinimal();
      if (n < 90) setTimeout(function () { tryFill(n + 1); }, 80);
    }
    tryFill(0);
  }
  if (typeof window.openProfilePanel !== 'function') window.openProfilePanel = openProfile;
  if (typeof window.closeProfilePanel !== 'function') window.closeProfilePanel = closeProfile;
  window.addEventListener('profile-bridge-ready', function () {
    var o = document.getElementById('profile-ov');
    if (o && o.classList.contains('open') && typeof window.__fillProfileContent === 'function') window.__fillProfileContent('profile');
  });
