// Everything about the person behind the site lives here: change these and the whole page follows.
export const SITE = {
  name: 'Your Name',
  // the hero sets the name in two big words, one on each side of the portrait
  nameWords: ['Your', 'Name'],
  role: 'Designer & art director',
  // the short line beside the portrait in the hero
  pitch: 'Designer and art director crafting identities, campaigns and digital experiences people remember.',
  // the three small words at the top left of the hero
  motto: ['Design', 'Create', 'Inspire'],
  // the hero portrait: one cut-out (transparent background) at four sizes; width and height are the
  // smallest file's, and each srcSet entry is that file's width
  portrait: {
    src: 'model/model-1200.webp',
    srcSet: 'model/model-1200.webp 567w, model/model-1600.webp 756w, model/model-2000.webp 945w, model/model-2369.webp 1119w',
    width: 567,
    height: 1200,
    alt: 'Portrait',
  },
  about: {
    heading: [{ text: 'I design things people' }, { text: 'remember.', em: true }],
    intro:
      'Hi, I’m Your Name, a designer based in Your City. Use these lines to say what you do, who you do it for and what you care about. Keep it short: the work says the rest.',
  },
};

// Contact details shown in the footer; empty ones are left out
export const CONTACT = {
  email: 'hello@yourname.com',
  instagram: 'yourname', // handle without the @
  phone: '+00 000 000 0000',
};

// What you offer, each shown with one of the projects (an index into WORKS)
export const SERVICES = [
  { name: 'Brand identity', note: 'Logos, type and colour that hold together', work: 0 },
  { name: 'Art direction', note: 'One clear idea behind every shoot and post', work: 3 },
  { name: 'Campaigns', note: 'Launches people notice and remember', work: 1 },
  { name: 'Digital design', note: 'Websites and apps that feel effortless', work: 5 },
  { name: 'Social content', note: 'Feeds that look like a brand, not a template', work: 8 },
  { name: 'Packaging', note: 'Objects worth keeping on the shelf', work: 11 },
  { name: 'Editorial', note: 'Books, magazines and long reads, set with care', work: 7 },
  { name: 'Motion', note: 'Logos and layouts that move with purpose', work: 14 },
];
