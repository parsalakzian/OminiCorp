const paths = {
  software: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="m10 8-2 2.5 2 2.5m4-5 2 2.5-2 2.5M8 21h8m-4-4v4"/>',
  security: '<path d="m12 22 3-1.8c4-2.4 6-5.9 6-10.2V6l-9-4-9 4v4c0 4.3 2 7.8 6 10.2z"/><path d="m8.5 12 2.3 2.3L16 9"/>',
  hardware: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  creative: '<path d="m16 3 5 5-4 9-14 4 4-14 9-4Zm-3 8L3 21m14-4-4-6m-6-4 6 4"/><circle cx="13" cy="11" r="1.6"/>',
  architecture: '<path d="M3 21h18M5 21V7l7-4v18m0-13 7 3v10M8 10v.01m0 4v.01m0 4v.01m8-4v.01m0 4v.01"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  down: '<path d="M12 4v15m-6-6 6 6 6-6"/>',
  upRight: '<path d="M6 18 18 6M8 6h10v10"/>',
  spark: '<path d="M12 2c.7 6.2 3.8 9.3 10 10-6.2.7-9.3 3.8-10 10-.7-6.2-3.8-9.3-10-10 6.2-.7 9.3-3.8 10-10Z"/>',
  phone: '<path d="M7 3H5a2 2 0 0 0-2 2 16 16 0 0 0 16 16 2 2 0 0 0 2-2v-2l-5-2-1.5 2a12 12 0 0 1-7.5-7.5L9 8z"/>',
  telegram: '<path d="m3 11 18-8-4 18-6-5-3 2v-5zM8 13l8-5m-5 8 5-8"/>',
  whatsapp: '<path d="M4 16.5a9 9 0 1 1 3.5 3.5L3 21zM9 8c0 3 2 5 5 6l1.5-1.5"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  tv: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export const icon = (id, className = '') => `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id]}</svg>`;
