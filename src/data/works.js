// The projects on the page, in order. Images live in public/work/{card-sm,card,full}/NN.webp
// (512, 768 and 1600 px wide). client is optional; leave it empty to hide it. aspect is height / width
// (1 for square, 1.25 for 4:5).
export const WORKS = [
  { title: 'Blue Hour', client: 'Northwind Studio', type: 'Brand identity', aspect: 1 },
  { title: 'Afterglow', client: 'Lumen Labs', type: 'Campaign', aspect: 1 },
  { title: 'Night Bloom', client: 'Mira Skincare', type: 'Packaging', aspect: 1 },
  { title: 'Signal', client: 'Orbit Records', type: 'Art direction', aspect: 1 },
  { title: 'Low Tide', client: 'Halcyon Hotels', type: 'Campaign', aspect: 1 },
  { title: 'Parallel', client: 'Atlas & Co.', type: 'Digital design', aspect: 1 },
  { title: 'Moonwalk', client: 'Kiro Coffee', type: 'Packaging', aspect: 1 },
  { title: 'Quiet Loud', client: '', type: 'Editorial', aspect: 1 },
  { title: 'Static', client: 'Orbit Records', type: 'Social content', aspect: 1 },
  { title: 'Undertow', client: 'Northwind Studio', type: 'Art direction', aspect: 1 },
  { title: 'Polar', client: '', type: 'Personal project', aspect: 1 },
  { title: 'Saltwater', client: 'Mira Skincare', type: 'Packaging', aspect: 1 },
  { title: 'Long Exposure', client: 'Lumen Labs', type: 'Digital design', aspect: 1 },
  { title: 'Night Shift', client: 'Halcyon Hotels', type: 'Brand identity', aspect: 1 },
  { title: 'Drift', client: 'Kiro Coffee', type: 'Motion', aspect: 1.25 },
  { title: 'Midnight Sun', client: 'Atlas & Co.', type: 'Campaign', aspect: 1.25 },
];

const pad2 = (n) => String(n).padStart(2, '0');
// paths are relative to the page, so the site works from any folder
export const workSrc = (i, size = 'card') => `work/${size}/${pad2(i + 1)}.webp`;
export const workLabel = (w) => (w.client ? `${w.title}, ${w.client}` : w.title);

// the clients in the marquee: everyone named on a project, once each
export const CLIENTS = [...new Set(WORKS.filter((w) => w.client).map((w) => w.client))];
