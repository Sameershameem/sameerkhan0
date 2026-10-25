// The designs on the page, in order. Images live in public/work/{card-sm,card,full}/NN.webp.
// client is optional; leave it empty to hide it. aspect is height / width (1 for square posts, 1.25 for 4:5).
export const WORKS = [
  { title: 'Rose Ice Cream Shake', client: 'Iceberg Melting Desserts', type: 'Product post', aspect: 1 },
  { title: 'Taste the Best', client: 'Hot Wok', type: 'Offer post', aspect: 1 },
  { title: 'Chowpatty Kulfi', client: 'Aflatoon Falooda & Ice Cream', type: 'Product post', aspect: 1 },
  { title: 'Make Your Move', client: 'Expert Tax Consultants', type: 'Campaign post', aspect: 1 },
  { title: 'Your Order Has Been Placed', client: 'Burger Points', type: 'App promo', aspect: 1 },
  { title: 'Chicken Tandoori Momo', client: 'Crisp Fry Cafe', type: 'Menu post', aspect: 1 },
  { title: 'Galaxy Buds Case', client: 'Samsung Galaxy', type: 'Concept ad', aspect: 1 },
  { title: 'Work Hard, Dream Big', client: 'Reminder Post', type: 'Typography poster', aspect: 1 },
  { title: 'New Definition of Style', client: 'Nike', type: 'Concept ad', aspect: 1 },
  { title: 'Sir Syed Day Offers', client: 'Crisp Fry Cafe', type: 'Offer post', aspect: 1 },
  { title: 'Sculpting Elegance in Every Turn', client: '', type: 'Product showcase', aspect: 1 },
  { title: 'Build Your Brand', client: 'BrandsWay PR & Marketing', type: 'Service post', aspect: 1 },
  { title: "We're Hiring", client: 'BrandsWay PR & Marketing', type: 'Hiring post', aspect: 1 },
  { title: 'T20 Series Kicks Off', client: 'Badshahcric', type: 'Match post', aspect: 1 },
  { title: 'Happy Gandhi Jayanti', client: 'Alba Locks', type: 'Festive post', aspect: 1.25 },
  { title: 'The Sherwani Edit', client: '', type: 'Fashion post', aspect: 1.25 },
];

const pad2 = (n) => String(n).padStart(2, '0');
// paths are relative to the page, so the site works from any folder
export const workSrc = (i, size = 'card') => `work/${size}/${pad2(i + 1)}.webp`;
export const workLabel = (w) => (w.client ? `${w.title}, ${w.client}` : w.title);

// the brands she has worked for (concept ads for global brands are not client work)
export const CLIENTS = [...new Set(WORKS.filter((w) => w.client && w.type !== 'Concept ad').map((w) => w.client))];
