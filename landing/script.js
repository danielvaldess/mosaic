// Reemplaza cada valor cuando tengas los enlaces oficiales.
const LINKS = {
  ABIGAIL_LINKEDIN: 'https://www.linkedin.com/in/abigail-claroz-028263245/',
  DANIEL_LINKEDIN: 'https://www.linkedin.com/in/daniel--valdes/',
  JOSE_LINKEDIN: 'https://www.linkedin.com/in/jos-mi-cast-300mm1500/',
  LIZMARIE_LINKEDIN: 'https://www.linkedin.com/in/lizmarie-camacho/',
  video: 'REEMPLAZAR_URL_VIDEO',
  repository: 'REEMPLAZAR_URL_REPOSITORIO',
  appQrImage: 'REEMPLAZAR_RUTA_QR',
};

document.querySelectorAll('[data-linkedin]').forEach((link) => {
  const value = LINKS[link.dataset.linkedin];
  if (value?.startsWith('http')) { link.href = value; link.target = '_blank'; link.rel = 'noreferrer'; }
  else { link.textContent = 'LinkedIn próximamente'; }
});

function configureLink(selector, url, fallback) {
  const link = document.querySelector(selector);
  if (!link) return;
  if (url.startsWith('http')) { link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; }
  else { link.textContent = fallback; }
}
configureLink('#video-link', LINKS.video, 'Video próximamente');
configureLink('#repo-link', LINKS.repository, 'Repositorio próximamente');

if (!LINKS.appQrImage.startsWith('REEMPLAZAR')) {
  const qr = document.querySelector('#qr-placeholder');
  qr.innerHTML = `<img src="${LINKS.appQrImage}" alt="Código QR para abrir la aplicación Mosaic">`;
}

const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('.nav-links');
menuButton?.addEventListener('click', () => {
  const open = menu?.classList.toggle('open') ?? false;
  menuButton.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => menu?.classList.remove('open')));

const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
  if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
}), { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
