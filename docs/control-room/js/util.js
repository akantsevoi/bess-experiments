// Utilities: formatting and helpers
(function(){
  function formatPct(v, digits=1){ return (v ?? 0).toFixed(digits) + '%'; }
  function formatEur(v, digits=2){ return (v ?? 0).toFixed(digits) + ' EUR'; }
  function formatDate(s){ try { return new Date(s).toLocaleString(); } catch { return s; } }
  function badge(status){
    const cls = status === 'green' ? 'green' : status === 'yellow' ? 'yellow' : 'red';
    return `<span class="badge ${cls}">${status}</span>`;
  }
  function qs(name, def=null){
    const u = new URL(window.location.href);
    return u.searchParams.get(name) ?? def;
  }
  window.Util = { formatPct, formatEur, formatDate, badge, qs };
})();

