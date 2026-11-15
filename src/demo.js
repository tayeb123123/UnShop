// Fictional products only. Images are generated SVG illustrations, not real product photos.
const samples = [
  ['DEMO01', 'Studio One Large Over-Ear Wireless Headphones, 60h Battery, Deep Bass', 169, 'over', '#1f2a24', '#c9f16b', 4.6, 2140],
  ['DEMO02', 'Pocket Buds Compact In-Ear Earbuds with Charging Case, Sweatproof', 49, 'buds', '#f4f1ea', '#13241b', 4.3, 880],
  ['DEMO03', 'Mini Fold Portable On-Ear Headphones, Foldable, Lightweight 140g', 69, 'on', '#e65c3a', '#fff3e8', 4.4, 512],
  ['DEMO04', 'Heavy Bass Pro Over-Ear Gaming Headset with RGB Lights and Boom Mic', 119, 'over', '#2b1d4a', '#ff4fd8', 4.1, 3301],
  ['DEMO05', 'Air Study Compact Earbuds, Noise Cancelling, 8h Battery', 79, 'buds', '#dfe9f5', '#2453a6', 4.5, 1290],
  ['DEMO06', 'Everyday Wireless Headphones', null, 'on', '#c7c2b8', '#3c3a36', 4.0, 77],
  ['DEMO07', 'Atlas Premium Noise Cancelling Over-Ear Headphones, Leather, 40h', 299, 'over', '#3a2c22', '#e3c9a6', 4.8, 4012],
  ['DEMO08', 'Trail Run Open-Ear Sport Earbuds with Ear Hooks, Waterproof IPX7', 59, 'buds', '#ffd23f', '#13241b', 4.2, 655],
  ['DEMO09', 'Glow Kids Over-Ear Headphones with LED Cat Ears, Volume Limited', 34, 'over', '#ff9bd2', '#ffffff', 3.9, 1450],
  ['DEMO10', 'Commute Slim Foldable Noise Cancelling Headphones, 30h, USB-C', 89, 'on', '#5d7a6b', '#eef4ea', 4.4, 970],
  ['DEMO11', 'Budget Basic Wired Earbuds with Mic, 3-Pack', 12, 'buds', '#ffffff', '#7b8b80', 3.6, 8800],
  ['DEMO12', 'Reference Studio Monitor Open-Back Headphones, Bulky Pro Design', 199, 'over', '#d9d9d6', '#13241b', 4.7, 702]
];
function art(kind, bg, fg) {
  const shapes = {
    over: `<path d="M60 120 Q60 50 120 50 Q180 50 180 120" fill="none" stroke="${fg}" stroke-width="12" stroke-linecap="round"/><rect x="40" y="110" width="42" height="70" rx="20" fill="${fg}"/><rect x="158" y="110" width="42" height="70" rx="20" fill="${fg}"/>`,
    on: `<path d="M74 126 Q74 66 120 66 Q166 66 166 126" fill="none" stroke="${fg}" stroke-width="9" stroke-linecap="round"/><circle cx="74" cy="140" r="22" fill="${fg}"/><circle cx="166" cy="140" r="22" fill="${fg}"/>`,
    buds: `<rect x="62" y="132" width="116" height="62" rx="30" fill="${fg}" opacity=".25"/><circle cx="96" cy="104" r="22" fill="${fg}"/><rect x="90" y="110" width="12" height="44" rx="6" fill="${fg}"/><circle cx="146" cy="104" r="22" fill="${fg}"/><rect x="140" y="110" width="12" height="44" rx="6" fill="${fg}"/>`
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="${bg}"/>${shapes[kind]}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
for (const [id, title, price, kind, bg, fg, stars, count] of samples) {
  const card = document.createElement('article');
  card.className = 'product'; card.dataset.componentType = 's-search-result'; card.dataset.asin = id;
  const media = document.createElement('div'); media.className = 'media';
  const image = document.createElement('img'); image.className = 's-image'; image.alt = ''; image.src = art(kind, bg, fg);
  media.append(image);
  const heading = document.createElement('h2'); heading.textContent = title;
  const rating = document.createElement('div'); rating.className = 'rating'; rating.textContent = `★ ${stars} (${count.toLocaleString()}) · fictional`;
  const cost = document.createElement('div'); cost.className = 'a-price price';
  const value = document.createElement('span'); value.className = 'a-offscreen'; value.textContent = price === null ? 'Price unavailable' : `$${price}.00`;
  const shown = document.createElement('span'); shown.setAttribute('aria-hidden', 'true'); shown.textContent = price === null ? 'See options' : `$${price}`;
  cost.append(value, shown); card.append(media, heading, rating, cost); document.querySelector('#products').append(card);
}
