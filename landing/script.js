// Enlaces oficiales del proyecto.
const LINKS = {
  ABIGAIL_LINKEDIN: 'https://www.linkedin.com/in/abigail-claroz-028263245/',
  DANIEL_LINKEDIN: 'https://www.linkedin.com/in/daniel--valdes/',
  JOSE_LINKEDIN: 'https://www.linkedin.com/in/jos-mi-cast-300mm1500/',
  LIZMARIE_LINKEDIN: 'https://www.linkedin.com/in/lizmarie-camacho/',
  repository: 'https://github.com/danielvaldess/mosaic',
  download: 'https://github.com/danielvaldess/mosaic/releases/latest/download/Mosaic-Setup.exe',
  // El video se reproduce en GitHub Pages. Coloca el archivo en:
  //   landing/assets/videos/demo.mp4
  // Mientras no exista, la sección muestra el aviso "próximamente".
  video: 'assets/videos/demo.mp4',
};

document.querySelectorAll('[data-linkedin]').forEach((link) => {
  const value = LINKS[link.dataset.linkedin];
  if (value?.startsWith('http')) {
    link.href = value;
    link.target = '_blank';
    link.rel = 'noreferrer';
  } else {
    link.textContent = 'LinkedIn ↗';
  }
});

const repoLink = document.getElementById('repo-link');
if (repoLink && LINKS.repository.startsWith('http')) repoLink.href = LINKS.repository;

const downloadLink = document.getElementById('download-link');
if (downloadLink && LINKS.download.startsWith('http')) downloadLink.href = LINKS.download;

/* ── Video: el reproductor se activa solo cuando el archivo existe ─────── */
const video = document.getElementById('demo-video');
const videoPending = document.getElementById('video-pending');
const videoOverlay = document.getElementById('video-overlay');
const videoPlay = document.getElementById('video-play');

async function setupVideo() {
  if (!video || !LINKS.video) return;
  const isRemote = /^https?:/i.test(LINKS.video);
  try {
    if (!isRemote) {
      const check = await fetch(LINKS.video, { method: 'HEAD' });
      if (!check.ok) return;
    }
    video.src = LINKS.video;
    video.classList.add('active');
    videoPending?.classList.add('done');
    try {
      // Autoplay con sonido: si el navegador lo bloquea, se muestra el botón.
      await video.play();
    } catch {
      videoOverlay?.classList.add('active');
    }
  } catch {
    // Sin video aún: se mantiene el aviso de "próximamente".
  }
}

video?.addEventListener('playing', () => videoOverlay?.classList.remove('active'));
videoPlay?.addEventListener('click', () => {
  videoOverlay?.classList.remove('active');
  void video?.play();
});
setupVideo();

/* ── Menú móvil ─────────────────────────────────────────────────────────── */
const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('.nav-links');
menuButton?.addEventListener('click', () => {
  const open = menu?.classList.toggle('open') ?? false;
  menuButton.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => menu?.classList.remove('open')));

/* ── Animación de aparición ─────────────────────────────────────────────── */
const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
  if (entry.isIntersecting) {
    entry.target.classList.add('visible');
    observer.unobserve(entry.target);
  }
}), { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
