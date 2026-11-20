import { recommendServices } from './service-guide.mjs';
import { activateDisplay } from './tv.mjs';

function activateCatalog() {
  const modal = document.querySelector('#details');
  const services = Array.from(document.querySelectorAll('.service-card'), (card) => {
    const title = card.querySelector('h3').textContent;
    const paragraphs = [card.querySelector('p'), card.querySelector('details ul')];
    const details = card.querySelector('details');
    const summary = details.querySelector('summary');
    const button = document.createElement('button');
    button.className = 'service-action';
    button.type = 'button';
    button.setAttribute('aria-label', summary.getAttribute('aria-label'));
    button.setAttribute('aria-haspopup', 'dialog');
    button.append(...Array.from(summary.childNodes, (node) => node.cloneNode(true)));
    button.addEventListener('click', () => {
      modal.querySelector('h2').textContent = title;
      modal.querySelector('.dialog-body').replaceChildren(...paragraphs.map((node) => node.cloneNode(true)));
      modal.showModal();
    });
    details.hidden = true;
    details.after(button);
    return { id: card.id.slice('service-'.length), title, paragraphs, button, icon: card.querySelector('.tile svg') };
  });

  modal.querySelector('[data-contact]').addEventListener('click', (event) => {
    event.preventDefault();
    modal.close();
    window.location.hash = 'contacts';
    document.querySelector('.contact-card').focus({ preventScroll: true });
  });
  return services;
}

function activateGuide(services) {
  const guide = document.querySelector('#guide');
  const choices = [...guide.querySelectorAll('[data-goal]')];
  const result = guide.querySelector('.guide-result');
  const status = guide.querySelector('[data-guide-status]');
  const byId = new Map(services.map((service) => [service.id, service]));

  for (const choice of choices) {
    choice.addEventListener('click', () => {
      choices.forEach((button) => button.setAttribute('aria-pressed', String(choice === button)));
      const matches = recommendServices(Number(choice.dataset.goal)).map((id) => byId.get(id)).filter(Boolean);
      result.querySelector('ul').replaceChildren(...matches.map(({ title, button }) => {
        const item = document.createElement('li');
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'button button-outline button-small';
        action.setAttribute('aria-haspopup', 'dialog');
        action.textContent = title;
        action.addEventListener('click', () => {
          guide.close();
          // Focusing the catalog control before opening preserves the return point.
          button.focus();
          button.click();
        });
        item.append(action);
        return item;
      }));
      result.hidden = matches.length === 0;
      status.textContent = matches.length ? `${result.querySelector('h3').textContent}: ${matches.map(({ title }) => title).join('، ')}` : '';
    });
  }
}

if (typeof document.querySelector('#guide')?.showModal === 'function') {
  const services = activateCatalog();
  activateGuide(services);
  activateDisplay(services);
  document.querySelectorAll('[data-enhanced]').forEach((element) => { element.hidden = false; });
  document.querySelectorAll('[data-open]').forEach((button) => {
    button.hidden = false;
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal());
  });
}
