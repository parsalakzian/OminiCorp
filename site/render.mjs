import { contacts, getServices, locales } from './content.mjs';
import { icon } from './icons.mjs';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const text = (value) => String(value).replace(/[&<>"']/g, (char) => entities[char]);
const serial = (index) => String(index + 1).padStart(2, '0');
const eyebrow = (value, index) => `<div class="eyebrow">${index ? `<b dir="ltr">${index}</b>` : '<span class="signal" aria-hidden="true"></span>'}${text(value)}</div>`;
const arrow = icon('arrow', 'directional');
const logo = `<img src="assets/media/logo.webp" width="41" height="30" alt="">`;
const wordmark = (copy) => `<span class="wordmark">${logo}<span><strong dir="ltr">OMINI<span>CORP</span></strong><small>${text(copy.name)}</small></span></span>`;

function header(copy, isFa) {
  return `<header class="site-header">
  <div class="shell head-row">
    <a class="brand" href="#top">${wordmark(copy)}</a>
    <nav class="main-nav" aria-label="${isFa ? 'ناوبری اصلی' : 'Main navigation'}">
      ${['services', 'about', 'contacts'].map((id, i) => `<a href="#${id}">${text(copy.nav[i])}</a>`).join('')}
    </nav>
    <div class="head-actions">
      <a class="locale" href="${isFa ? 'en.html' : 'index.html'}" hreflang="${isFa ? 'en' : 'fa'}" lang="${isFa ? 'en' : 'fa'}" aria-label="${text(copy.alternateName)}">${text(copy.alternate)}</a>
      <a class="button button-small button-outline" href="#contacts">${text(copy.consultation)}${icon('upRight')}</a>
    </div>
  </div>
</header>`;
}

function hero(copy) {
  return `<section class="hero" aria-labelledby="intro-title">
  <div class="shell hero-layout">
    <div class="hero-copy">
      ${eyebrow(copy.heroLabel)}
      <h1 id="intro-title">${text(copy.heroHeading[0])}<br><em>${text(copy.heroHeading[1])}</em></h1>
      <p>${text(copy.heroBody)}</p>
      <div class="actions">
        <a class="button button-primary" href="#services">${text(copy.explore)}${arrow}</a>
        <button class="button button-muted" type="button" data-open="guide" hidden>${icon('spark')}${text(copy.guideAction)}</button>
      </div>
    </div>
    <div class="hero-visual" aria-hidden="true" dir="ltr">
      <div class="hero-frame"><span></span><span></span><span></span><span></span></div>
      <img src="assets/media/hero.webp" alt="" width="1150" height="859" fetchpriority="high">
      <div class="visual-top"><span>OC / 01</span><span>+ &nbsp; SYSTEM VIEW</span></div>
      <div class="visual-bottom"><span>FIG. 01 <b> / </b> OMNI CORE</span><span lang="${copy.direction === 'rtl' ? 'fa' : 'en'}"><i class="signal"></i> ${text(copy.visualLabel)}</span></div>
    </div>
  </div>
</section>
<div class="domain-rail"><ul class="shell">${copy.domains.map((domain, i) => `<li><span dir="ltr">${serial(i)}</span>${text(domain)}${icon('spark')}</li>`).join('')}</ul></div>`;
}

function serviceCard([id, title, description, items], index, copy) {
  return `<article class="service-card" id="service-${id}">
  <div class="card-top"><span class="tile">${icon(id)}</span><span class="card-number" dir="ltr">/ ${serial(index)}</span></div>
  <h3>${text(title)}</h3><p>${text(description)}</p>
  <details>
    <summary aria-label="${text(`${copy.details}: ${title}`)}">${text(copy.details)}${arrow}</summary>
    <ul>${items.map((item) => `<li>${text(item)}</li>`).join('')}</ul>
  </details>
</article>`;
}

function catalog(copy, services) {
  return `<section class="shell panel-section" id="services" aria-labelledby="services-title">
  <div class="section-heading">
    <div>${eyebrow(copy.servicesLabel, '01')}<h2 id="services-title">${text(copy.servicesHeading[0])} <em>${text(copy.servicesHeading[1])}</em></h2></div>
    <p>${text(copy.servicesBody)}</p>
  </div>
  <div class="service-grid">${services.map((service, i) => serviceCard(service, i, copy)).join('\n')}</div>
  <div class="guide-banner" data-enhanced hidden>
    <span class="tile">${icon('spark')}</span>
    <div><div class="guide-kicker">${text(copy.guideLabel)}</div><h3>${text(copy.guideHeading)}</h3><p>${text(copy.guideBody)}</p></div>
    <button class="button button-outline" type="button" data-open="guide">${text(copy.guideButton)}${arrow}</button>
  </div>
</section>`;
}

function about(copy) {
  return `<section id="about" class="about-section" aria-labelledby="about-title">
  <div class="shell about-layout">
    <div>${eyebrow(copy.aboutLabel, '02')}<h2 id="about-title">${text(copy.aboutHeading)}</h2><p>${text(copy.aboutBody)}</p></div>
    <ol class="steps">${copy.steps.map(([title, body], i) => `<li><span dir="ltr">${serial(i)}</span><div><h3>${text(title)}</h3><p>${text(body)}</p></div></li>`).join('')}</ol>
  </div>
</section>`;
}

function contact(copy) {
  return `<section class="shell panel-section contact" id="contacts" aria-labelledby="contact-title">
  <div class="section-heading">
    <div>${eyebrow(copy.contactLabel, '03')}<h2 id="contact-title">${text(copy.contactHeading)}</h2></div>
    <p>${text(copy.contactBody)}</p>
  </div>
  <div class="contact-grid">${contacts.map(({ id, label, href }, i) => `<a class="contact-card" href="${text(href)}">
    <span class="tile">${icon(id)}</span><span><strong>${text(copy.contactNames[i])}</strong><bdi>${text(label)}</bdi></span>${icon('upRight', 'contact-arrow')}
  </a>`).join('\n')}</div>
  <a class="secondary-contact" href="tel:+989108681553">${text(copy.secondary)}: <bdi>+98 910 868 1553</bdi></a>
</section>`;
}

function dialog(id, title, close, content, extra = '') {
  return `<dialog id="${id}" aria-labelledby="${id}-title"${extra}>
  <div class="dialog-head"><span class="dialog-id" dir="ltr">OC // ${id.toUpperCase()}</span><form method="dialog"><button type="submit" class="icon-button" aria-label="${text(close)}" autofocus>${icon('close')}</button></form></div>
  <h2 id="${id}-title">${text(title)}</h2>
  ${content}
</dialog>`;
}

function dialogs(copy) {
  return [
    dialog('details', copy.details, copy.close, `<div class="dialog-body"></div><a class="button button-primary" href="#contacts" data-contact>${text(copy.discuss)}${arrow}</a>`),
    dialog('guide', copy.guideHeading, copy.close, `<p>${text(copy.guideBody)}</p>
  <div class="choices">${copy.goals.map((goal, i) => `<button type="button" aria-pressed="false" data-goal="${i}">${text(goal)}${arrow}</button>`).join('')}</div>
  <div class="guide-result" hidden><h3>${text(copy.recommendation)}</h3><ul></ul></div><p class="sr-only" role="status" data-guide-status></p>`),
    dialog('display', copy.tv, copy.close, `<div class="slide" aria-live="polite"></div>
  <div class="display-controls"><button class="button button-muted" type="button" data-slide="-1">${text(copy.previous)}</button><button class="button button-muted" type="button" data-play="${text(copy.play)}" data-pause="${text(copy.pause)}">${text(copy.play)}</button><button class="button button-primary" type="button" data-slide="1">${text(copy.next)}</button></div>`, ' class="display"'),
  ].join('\n');
}

export function render(language) {
  const copy = locales[language];
  const isFa = language === 'fa';
  return `<!doctype html>
<!-- Generated by node site/build.mjs. Edit site/ instead. -->
<html lang="${language}" dir="${copy.direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080d0b">
  <meta name="description" content="${text(copy.description)}">
  <title>${text(copy.title)}</title>
  <link rel="alternate" hreflang="${isFa ? 'en' : 'fa'}" href="${isFa ? 'en.html' : 'index.html'}">
  <link rel="icon" type="image/webp" href="assets/media/logo.webp">
  <link rel="stylesheet" href="assets/site.css">
  <script type="module" src="assets/site.mjs"></script>
</head>
<body id="top">
<a class="skip-link" href="#main">${text(copy.skip)}</a>
${header(copy, isFa)}
<main id="main" tabindex="-1">
${hero(copy)}
${catalog(copy, getServices(language))}
${about(copy)}
${contact(copy)}
</main>
<footer class="site-footer"><div class="shell footer-inner">
  <a class="brand" href="#top">${wordmark(copy)}</a><small><bdi>© 2026 OminiCorp.</bdi> ${text(copy.copyright)}</small>
  <button class="button button-muted button-small" type="button" data-open="display" hidden>${icon('tv')}${text(copy.tv)}</button>
</div></footer>
${dialogs(copy)}
</body>
</html>
`;
}
