// Monochrome house, sun and heat waves. HA supplies the grey sidebar colour.
const path = 'M7 0h2v3H7z M0 7h3v2H0z M2 2l2 2-1.4 1.4-2-2z M13 1l1.4 1.4-2 2L11 3z M1 13l2-2 1.4 1.4-2 2z M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M18 6 4 17l1.5 1.9L8 17v14h20V17l2.5 1.9L32 17z M10 15.4 18 9l8 6.4V29H10z M13 17c-2 2-2 3.8 0 5.5 1.1 1 .9 2-.2 3.5l1.5 1.1c1.8-2.2 1.9-4.3 0-5.9-1.1-1-1.1-1.8.2-3z M18 17c-2 2-2 3.8 0 5.5 1.1 1 .9 2-.2 3.5l1.5 1.1c1.8-2.2 1.9-4.3 0-5.9-1.1-1-1.1-1.8.2-3z M23 17c-2 2-2 3.8 0 5.5 1.1 1 .9 2-.2 3.5l1.5 1.1c1.8-2.2 1.9-4.3 0-5.9-1.1-1-1.1-1.8.2-3z';
async function getIcon(name) {
  return name === 'heating' ? {path, viewBox:'0 0 32 32'} : undefined;
}
window.customIcons = window.customIcons || {};
window.customIcons.heizungsmanager = {getIcon};
window.customIconsets = window.customIconsets || {};
window.customIconsets.heizungsmanager = getIcon;
