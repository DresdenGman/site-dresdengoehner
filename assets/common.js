// shared: reveal-on-scroll + reduced motion flag
window.RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');
if (window.RM) document.documentElement.classList.add('rm');
(function(){
  const els=[...document.querySelectorAll('[data-reveal]')];
  if(window.RM||!('IntersectionObserver' in window)){els.forEach(e=>e.classList.add('in'));return;}
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{threshold:.12,rootMargin:'0px 0px -6% 0px'});
  els.forEach(e=>io.observe(e));
})();
