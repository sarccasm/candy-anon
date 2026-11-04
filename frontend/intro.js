const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const brand = document.querySelector('.brand');
if (brand && !reducedMotion.matches) {
  const rect = brand.getBoundingClientRect();
  const x = (window.innerWidth - rect.width) / 2 - rect.left;
  const y = window.innerHeight * .4 - rect.top - rect.height / 2;
  document.body.classList.add('intro-active');
  const intro = brand.animate([
    { transform: `translate(${x}px, ${y}px) scale(1.35)`, opacity: 0, filter: 'blur(8px)', offset: 0 },
    { transform: `translate(${x}px, ${y}px) scale(1.35)`, opacity: 1, filter: 'blur(0)', offset: .25 },
    { transform: `translate(${x}px, ${y}px) scale(1.35)`, opacity: 1, filter: 'blur(0)', offset: .42 },
    { transform: 'translate(0, 0) scale(1)', opacity: 1, filter: 'blur(0)', offset: 1 }
  ], { duration: 1250, easing: 'cubic-bezier(.22,1,.36,1)' });
  const finish = () => document.body.classList.remove('intro-active');
  intro.finished.then(finish, finish);
  reducedMotion.addEventListener('change', event => { if (event.matches) intro.cancel(); });
}
