(function () {
  function bindProfileFallback() {
    var btn = document.getElementById('btn-profile');
    if (!btn || typeof window.openProfilePanel !== 'function') return;
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var ov = document.getElementById('profile-ov');
      if (ov && ov.classList.contains('open')) {
        if (typeof window.closeProfilePanel === 'function') window.closeProfilePanel();
      } else {
        window.openProfilePanel('profile');
      }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindProfileFallback);
  else bindProfileFallback();
